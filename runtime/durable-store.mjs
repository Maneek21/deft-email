import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto';
import {constants as C} from 'node:fs';
import {lstat, mkdir, open, readFile, rename, unlink, rmdir, statfs} from 'node:fs/promises';
import {isAbsolute, join, dirname, parse, resolve} from 'node:path';
import {canonical, digest, exact, fail} from './contract.mjs';

/** One independently operated writer. The process lock never expires or is stolen.
 * Each CAS fsyncs a fresh encrypted row before rename; POSIX also fsyncs its directory.
 * Windows mode is only for local restart fixtures, not a production durability claim. */
export async function createDurableStore({root, encryption_key, key_id, allow_windows_fixture = false}) {
  if (!isAbsolute(root ?? '') || resolve(root) !== root || root === parse(root).root || !(encryption_key instanceof Uint8Array) || encryption_key.byteLength !== 32 || !/^[A-Za-z0-9_-]{1,64}$/u.test(key_id ?? '') || process.platform === 'win32' && !allow_windows_fixture) fail('EMAIL_RUNTIME_STORE_CONFIG_INVALID');
  const key = Buffer.from(encryption_key), writer = join(root, '.writer'), ownerFile = join(writer, 'owner.json'), nonce = randomBytes(32).toString('hex'), pending = new Map();
  let closed = false;
  async function checkDirectory(path) {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('EMAIL_RUNTIME_STORE_PATH_INVALID');
    if (process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)) fail('EMAIL_RUNTIME_STORE_ROOT_NOT_PRIVATE');
  }
  async function ancestry() { let current = root; for (;;) { const stat = await lstat(current); if (!stat.isDirectory() || stat.isSymbolicLink()) fail('EMAIL_RUNTIME_STORE_PATH_INVALID'); const parent = dirname(current); if (parent === current) break; current = parent; } }
  async function syncDirectory() { if (process.platform === 'win32') return; const handle = await open(root, 'r'); try { await handle.sync(); } finally { await handle.close(); } }
  try { await mkdir(root, {mode: 0o700}); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await ancestry(); await checkDirectory(root);
  if (process.platform === 'linux') { const {type} = await statfs(root); if ([0x6969, 0xff534d42, 0x01021997, 0x01021994].includes(Number(type))) fail('EMAIL_RUNTIME_STORE_FILESYSTEM_UNSUPPORTED'); }
  try { await mkdir(writer, {mode: 0o700}); } catch (error) { if (error.code === 'EEXIST') fail('EMAIL_RUNTIME_WRITER_LOCKED'); throw error; }
  const lease = await open(ownerFile, 'wx', 0o600); try { await lease.writeFile(JSON.stringify({pid: process.pid, nonce})); await lease.sync(); } finally { await lease.close(); }
  await syncDirectory();
  async function fence() {
    if (closed) fail('EMAIL_RUNTIME_STORE_CLOSED');
    await ancestry(); await checkDirectory(root); await checkDirectory(writer);
    const stat = await lstat(ownerFile); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)) fail('EMAIL_RUNTIME_WRITER_FENCE_LOST');
    let owner; try { owner = JSON.parse(await readFile(ownerFile, 'utf8')); } catch { fail('EMAIL_RUNTIME_WRITER_FENCE_LOST'); }
    if (owner.nonce !== nonce || owner.pid !== process.pid) fail('EMAIL_RUNTIME_WRITER_FENCE_LOST');
  }
  const pathFor = id => join(root, digest(id) + '.json');
  // Independently versioned app data budgets; connection/custody retain their
  // original limits. Identity includes immutable org/owner/account/record pins.
  const budget = id => id.startsWith('email.runtime.graph_send.') ? 1024*1024 : id.startsWith('email.data.sync_handoff.')||id.startsWith('email.data.sync_publication.') ? 1024*1024 : id.startsWith('email.data.file.') || id.startsWith('email.data.snapshot.') ? 100 * 1024 * 1024
    : id.startsWith('email.data.draft.') || id.startsWith('email.data.draft_index.') || id.startsWith('email.data.settings_record.') || id.startsWith('email.data.record_change.') ? 1024 * 1024
    : id.startsWith('email.data.request.') ? 2 * 1024 * 1024
    : id.startsWith('email.data.mailbox.') ? 8 * 1024 * 1024 : 131072;
  const namespace = id => id.startsWith('email.data.') ? 'email.app_data.store.v1' : 'email.runtime.store.v1';
  const envelopeBudget = id => Math.ceil(budget(id) * 4 / 3) + 4096;
  async function read(id) {
    await fence(); const path = pathFor(id); let stat;
    try { stat = await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > envelopeBudget(id) || process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)) fail('EMAIL_RUNTIME_STORE_ROW_INVALID');
    try {
      const handle = await open(path, C.O_RDONLY | (C.O_NOFOLLOW ?? 0)); let row;
      try { const opened = await handle.stat(); if (!opened.isFile() || opened.nlink !== 1 || opened.size > envelopeBudget(id) || opened.ino !== stat.ino || opened.dev !== stat.dev) fail('EMAIL_RUNTIME_STORE_ROW_INVALID'); row = JSON.parse(await handle.readFile('utf8')); } finally { await handle.close(); }
      exact(row, ['revision', 'key_id', 'iv', 'tag', 'ciphertext']);
      if (!Number.isSafeInteger(row.revision) || row.revision < 1 || row.key_id !== key_id) fail('EMAIL_RUNTIME_STORE_KEY_UNAVAILABLE');
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(row.iv, 'base64url'));
      decipher.setAAD(Buffer.from(canonical({namespace: namespace(id), id, revision: row.revision, key_id})));
      decipher.setAuthTag(Buffer.from(row.tag, 'base64url'));
      const bytes = Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64url')), decipher.final()]);
      try { return {revision: row.revision, value: JSON.parse(bytes.toString('utf8'))}; } finally { bytes.fill(0); }
    } catch (error) { if (error.code === 'EMAIL_RUNTIME_STORE_KEY_UNAVAILABLE') throw error; fail('EMAIL_RUNTIME_STORE_ROW_INVALID'); }
  }
  async function cas(id, expected_revision, value) {
    const current = await read(id); if ((current?.revision ?? null) !== expected_revision) return false;
    const revision = (expected_revision ?? 0) + 1, bytes = Buffer.from(JSON.stringify(value));
    if (bytes.byteLength > budget(id) || !Number.isSafeInteger(revision)) fail('EMAIL_RUNTIME_STORE_LIMIT');
    let row;
    try { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(canonical({namespace: namespace(id), id, revision, key_id}))); row = {revision, key_id, iv: iv.toString('base64url'), tag: '', ciphertext: Buffer.concat([cipher.update(bytes), cipher.final()]).toString('base64url')}; row.tag = cipher.getAuthTag().toString('base64url'); } finally { bytes.fill(0); }
    const temporary = join(root, digest(id) + '.' + randomBytes(16).toString('hex') + '.tmp'), handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(row)); await handle.sync(); } finally { await handle.close(); }
    await fence(); await rename(temporary, pathFor(id)); await syncDirectory(); await fence(); return true;
  }
  return Object.freeze({
    async withLock({key: id}, work) {
      if (typeof id !== 'string' || id.length > 512 || !id || typeof work !== 'function') fail('EMAIL_RUNTIME_STORE_INPUT_INVALID');
      const prior = pending.get(id) ?? Promise.resolve(); let release; const next = new Promise(done => {release = done;}); pending.set(id, next);
      await prior;
      try { await fence(); return await work({read: () => read(id), compareAndSwap: ({expected_revision, value}) => cas(id, expected_revision, value)}); }
      finally { release(); if (pending.get(id) === next) pending.delete(id); }
    },
    async close() { await Promise.all([...pending.values()]); await fence(); closed = true; await unlink(ownerFile); await rmdir(writer); await syncDirectory(); key.fill(0); }
  });
}
