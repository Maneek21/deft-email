// Synthetic operator smoke only: no enrollment, provider access or private files.
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {startRuntime} from './server.mjs';
import {client, makeScope, registrationFor} from './test-support.mjs';

const parent = await mkdtemp(join(tmpdir(), 'email-artifact-startup-'));
let instance, networkCalls = 0;
try {
  const clientFile = join(parent, 'client.json');
  await writeFile(clientFile, JSON.stringify(client), {mode: 0o600});
  instance = await startRuntime({listen_port: 0, store_root: join(parent, 'state'),
    key_id: 'artifact-startup-fixture', encryption_key_hex: randomBytes(32).toString('hex'),
    runtime_auth_token: randomBytes(32).toString('base64url'), authority_token: randomBytes(32).toString('base64url'),
    authority_url: 'http://127.0.0.1:1/api/app-connection-sessions/runtime/authority',
    registration: registrationFor(makeScope()), gmail_client_file: clientFile},
  {allow_windows_fixture: process.platform === 'win32', allow_loopback_fixture: true,
    fetch: async () => {networkCalls++; throw Error('ARTIFACT_PROVIDER_NETWORK_FORBIDDEN');}, onShutdown: () => {}});
  const response = await fetch('http://127.0.0.1:' + instance.server.address().port + '/v1/connections', {method: 'POST'});
  assert.equal(response.status, 401);
  assert.equal(networkCalls, 0);
  await instance.close();
  instance = undefined;
  console.log(JSON.stringify({result: 'passed', actual_server_started: true, http_transport_denied: true,
    provider_requests: 0, private_configuration_used: false, graceful_shutdown: true}));
} finally {
  await instance?.close();
  assert.equal(dirname(parent), resolve(tmpdir()));
  assert.ok(parent.startsWith(join(resolve(tmpdir()), 'email-artifact-startup-')));
  await rm(parent, {recursive: true, force: true});
}
