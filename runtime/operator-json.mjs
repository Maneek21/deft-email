import {open} from 'node:fs/promises';
import {constants as C} from 'node:fs';
import {isAbsolute} from 'node:path';
import {fail} from './contract.mjs';

// Its own module so that imap-server.mjs never imports server.mjs: server.mjs, run as the entry, awaits
// import('./imap-server.mjs') inside its top-level await, and a static import back into it never settles (exit 13).
export async function readOperatorJson(path, allow_windows_fixture = false) {
  if (typeof path !== 'string' || !isAbsolute(path) || process.platform === 'win32' && !allow_windows_fixture) fail('EMAIL_RUNTIME_SECRET_FILE_INVALID');
  const handle = await open(path, C.O_RDONLY | (C.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16384 || process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)) fail('EMAIL_RUNTIME_SECRET_FILE_INVALID');
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}
