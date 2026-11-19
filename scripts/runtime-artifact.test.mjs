import test from 'node:test';
import assert from 'node:assert/strict';
import {fork, spawn, spawnSync} from 'node:child_process';
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
  // The operator image runs `node server.mjs` from the extracted Runtime with only EMAIL_RUNTIME_CONFIG_FILE set
  // (runtime/Dockerfile.operator CMD). Start exactly that, once per provider mode, so a module graph that cannot
  // evaluate as the entry (an import cycle under top-level await exits 13) fails here rather than on a Host.
  // The real entry refuses operator files on Windows by design, so this runs where the image runs: Linux CI.
  const synthetic = () => ({listen_port: 0, key_id: 'entry-startup-fixture',
    encryption_key_hex: randomBytes(32).toString('hex'), runtime_auth_token: randomBytes(32).toString('base64url'),
    authority_token: randomBytes(32).toString('base64url')});
  const entryModes = {
    // The hosted workspace's form-mode settings (Host vouches for registrations; any public mail server).
    imap_smtp_form: async () => ({...synthetic(), store_root: join(parent, 'form-state'),
      form_authority_url: 'https://cell.invalid/api/app-connection-forms/runtime/authority',
      data_authority_url: 'https://cell.invalid/api/app-data/runtime/authority',
      registrations: [], registration_admission: 'host_authority',
      provider_config: {provider: 'imap_smtp', setup_origin: 'https://cell-mail.invalid', profile_digests: [],
        endpoint_policy: {mode: 'public_addresses'}}}),
    gmail_oauth: async () => {
      const {client, makeScope, registrationFor} = await import(pathToFileURL(join(runtime, 'test-support.mjs')));
      const clientFile = join(parent, 'entry-client.json');
      await writeFile(clientFile, JSON.stringify(client), {mode: 0o600});
      return {...synthetic(), store_root: join(parent, 'gmail-state'),
        authority_url: 'https://cell.invalid/api/app-connection-sessions/runtime/authority',
        registration: registrationFor(makeScope()), gmail_client_file: clientFile};
    },
  };
  for (const [mode, makeConfig] of Object.entries(entryModes)) {
    await t.test('image CMD `node server.mjs` starts as the entry point in ' + mode + ' mode',
      {skip: process.platform === 'win32' && 'server.mjs refuses operator files on Windows; runs in Linux CI'}, async () => {
        const configFile = join(parent, mode + '.json');
        await writeFile(configFile, JSON.stringify(await makeConfig()), {mode: 0o600});
        let output = '', child;
        try {
          child = spawn(process.execPath, ['server.mjs'], {cwd: runtime, windowsHide: true,
            env: {...process.env, EMAIL_RUNTIME_CONFIG_FILE: configFile}, stdio: ['ignore', 'pipe', 'pipe']});
          const port = await new Promise((done, reject) => {
            const timer = setTimeout(() => reject(Error('`node server.mjs` did not listen within 20 s\n' + output)), 20000);
            child.stdout.on('data', value => {
              output += value;
              const line = output.split('\n').find(row => row.includes('email_runtime_listening'));
              if (line) {clearTimeout(timer); done(JSON.parse(line).port);}
            });
            child.stderr.on('data', value => {output += value;});
            child.once('error', error => {clearTimeout(timer); reject(error);});
            child.once('exit', code => {clearTimeout(timer); reject(Error('`node server.mjs` exited ' + code + '\n' + output));});
          });
          if (mode === 'imap_smtp_form') {
            const setup = await fetch('http://127.0.0.1:' + port + '/setup');
            assert.equal(setup.status, 200, output);
            assert.match(await setup.text(), /<title>Authenticate mail servers<\/title>/u);
          }
          const denied = await fetch('http://127.0.0.1:' + port + '/v1/connections', {method: 'POST'});
          assert.equal(denied.status, 401);
          const exited = new Promise((done, reject) => {
            const timer = setTimeout(() => reject(Error('`node server.mjs` shutdown timed out\n' + output)), 10000);
            child.once('exit', code => {clearTimeout(timer); done(code);});
          });
          child.kill('SIGTERM');
          assert.equal(await exited, 0, output);
          child = undefined;
        } finally {
          if (child && child.exitCode === null) {
            const exited = new Promise(done => child.once('exit', done));
            child.kill('SIGKILL');
            await exited;
          }
        }
      });
  }
});
