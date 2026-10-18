import test from 'node:test';
import assert from 'node:assert/strict';
import {fork, spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const execute = (command, args, cwd) => {
  const result = spawnSync(command, args, {cwd, encoding: 'utf8', timeout: 120000, windowsHide: true});
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
};

async function moduleClosure(runtime) {
  const pending = [join(runtime, 'server.mjs')], seen = new Set();
  const imports = /(?:\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?|\bimport\s*\()\s*(['"])(\.{1,2}\/[^'"]+)\1/gu;
  while (pending.length) {
    const path = pending.pop();
    if (seen.has(path)) continue;
    const local = relative(runtime, path);
    assert.ok(!local.startsWith('..' + sep) && local !== '..', 'Runtime import escapes exported archive: ' + local);
    const source = await readFile(path, 'utf8');
    seen.add(path);
    for (const match of source.matchAll(imports)) pending.push(resolve(dirname(path), match[2]));
  }
  return seen.size;
}

test('exported Runtime archive has a closed module graph and starts without an App checkout', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'email-runtime-artifact-'));
  t.after(async () => {
    assert.equal(dirname(parent), resolve(tmpdir()));
    assert.ok(parent.startsWith(join(resolve(tmpdir()), 'email-runtime-artifact-')));
    await rm(parent, {recursive: true, force: true});
  });
  const runtime = join(parent, 'runtime');
  await mkdir(runtime);
  let archive = process.env.EMAIL_RUNTIME_ARTIFACT;
  if (!archive) {
    execute(process.execPath, ['scripts/package-source.mjs'], root);
    archive = join(root, 'dist', 'runtime-artifact.tgz');
  }
  // Match Dockerfile.operator's standalone extraction, including stripping runtime/.
  execute('tar', ['-xzf', archive, '--strip-components=1', '-C', runtime], root);
  await t.test('all server-reachable relative imports remain inside the exported Runtime', async () => {
    const count = await moduleClosure(runtime);
    assert.ok(count > 100, 'Expected the real provider/server module graph');
    t.diagnostic('Checked ' + count + ' local modules, including literal dynamic imports');
  });
  // This is a clean production dependency install, not a link to repository node_modules.
  const install = ['install', '--prod', '--frozen-lockfile', '--ignore-scripts'];
  execute(process.platform === 'win32' ? 'cmd.exe' : 'pnpm',
    process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm install --prod --frozen-lockfile --ignore-scripts'] : install, runtime);
  await t.test('actual exported server listens and shuts down with synthetic private configuration', async () => {
    const {client, makeScope, registrationFor} = await import(pathToFileURL(join(runtime, 'test-support.mjs')));
    const clientFile = join(parent, 'client.json'), configFile = join(parent, 'runtime.json');
    await writeFile(clientFile, JSON.stringify(client), {mode: 0o600});
    await writeFile(configFile, JSON.stringify({listen_port: 0, store_root: join(parent, 'state'),
      key_id: 'archive-startup-fixture', encryption_key_hex: randomBytes(32).toString('hex'),
      runtime_auth_token: randomBytes(32).toString('base64url'), authority_token: randomBytes(32).toString('base64url'),
      authority_url: 'http://127.0.0.1:1/api/app-connection-sessions/runtime/authority',
      registration: registrationFor(makeScope()), gmail_client_file: clientFile}), {mode: 0o600});
    let diagnostics = '', providerCalls = 0, child;
    try {
      child = fork(join(runtime, 'process-fixture.mjs'), {cwd: runtime,
        env: {...process.env, EMAIL_RUNTIME_CONFIG_FILE: configFile}, stdio: ['ignore', 'pipe', 'pipe', 'ipc']});
      child.stdout.on('data', value => {diagnostics += value;});
      child.stderr.on('data', value => {diagnostics += value;});
      const port = await new Promise((done, reject) => {
        const timer = setTimeout(() => reject(Error('Exported Runtime startup timed out\n' + diagnostics)), 20000);
        child.on('message', message => {
          if (message.event === 'provider_request') providerCalls++;
          if (Number.isInteger(message.port)) {clearTimeout(timer); done(message.port);}
        });
        child.once('error', error => {clearTimeout(timer); reject(error);});
        child.once('exit', code => {clearTimeout(timer); reject(Error('Exported Runtime exited ' + code + '\n' + diagnostics));});
      });
      const response = await fetch('http://127.0.0.1:' + port + '/v1/connections', {method: 'POST'});
      assert.equal(response.status, 401);
      assert.equal(providerCalls, 0);
      const exited = new Promise((done, reject) => {
        const timer = setTimeout(() => reject(Error('Exported Runtime shutdown timed out')), 10000);
        child.once('exit', code => {clearTimeout(timer); done(code);});
      });
      child.send('shutdown');
      assert.equal(await exited, 0, diagnostics);
      child = undefined;
    } finally {
      if (child && child.exitCode === null) {
        const exited = new Promise(done => child.once('exit', done));
        child.kill();
        await exited;
      }
    }
  });
});
