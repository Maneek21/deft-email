import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID, randomBytes} from 'node:crypto';
import {startRuntime} from './server.mjs';
import {CHANNEL_INSTALL_SCHEMA} from './installed-channels.mjs';
import {makeScope, registrationFor, client} from './test-support.mjs';

test('actual Runtime installs Host-delivered sessions, starts them and keeps them across restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'email-channel-install-')), scope = makeScope(), initial = Date.now();
  let instance;
  t.after(async () => { if (instance) await instance.close(); await rm(directory, {recursive: true, force: true}); });
  const ceiling = new Date(initial + 3600000).toISOString();
  const registration = {org_id: scope.org_id, runtime_registration_id: scope.runtime_registration_id, runtime_epoch: scope.runtime_epoch};
  const stale = {session_id: randomUUID(), session_token: randomBytes(32).toString('base64url')};
  const fresh = {session_id: randomUUID(), session_token: randomBytes(32).toString('base64url')};
  const clientFile = join(directory, 'client.json'), channelFile = join(directory, 'channel.json');
  await writeFile(clientFile, JSON.stringify(client), {mode: 0o600});
  await writeFile(channelFile, JSON.stringify({channel_url: 'https://fixture.invalid/api/app-runtime/channel', credential: stale, registration,
    technical_renewal: {expires_at: new Date(initial - 60000).toISOString(), renewable_until: ceiling}}), {mode: 0o600});
  const config = {listen_port: 0, store_root: join(directory, 'state'), key_id: 'channel-install', encryption_key_hex: randomBytes(32).toString('hex'),
    runtime_auth_token: randomBytes(32).toString('base64url'), authority_token: randomBytes(32).toString('base64url'),
    authority_url: 'https://fixture.invalid/api/app-connection-sessions/runtime/authority', data_authority_url: 'https://fixture.invalid/api/app-data/runtime/authority',
    registrations: [registrationFor(scope)], gmail_client_file: clientFile, runtime_channel_files: [channelFile]};
  const calls = {staleRenew: 0, freshRenew: 0, freshClaim: 0};
  const json = (value, status = 200) => new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json'}});
  const options = {allow_windows_fixture: process.platform === 'win32', fetch: async () => { throw Error('Unexpected provider'); },
    channelFetch: async (url, request) => {
      const body = JSON.parse(request.body), renew = new URL(url).pathname.endsWith('/renew');
      if (body.session_id === stale.session_id) { if (renew) calls.staleRenew++; return json({error: 'Runtime session renewal unavailable', code: 'APP_RUNTIME_ACCESS_DENIED'}, 403); }
      assert.equal(body.session_id, fresh.session_id);
      assert.equal(request.headers.authorization, 'AppRuntime ' + fresh.session_token);
      if (renew) { calls.freshRenew++; return json({renewed: {session_id: fresh.session_id, expires_at: new Date(Date.now() + 900000).toISOString(), renewable_until: ceiling}}); }
      calls.freshClaim++; return json({claim: null});
    }};
  const settle = async predicate => { for (let i = 0; i < 200 && !predicate(); i++) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(predicate(), 'Synthetic lifecycle deadline'); };
  const install = (body, token = config.runtime_auth_token) => fetch('http://127.0.0.1:' + instance.server.address().port + '/v1/connections', {method: 'POST',
    headers: {'content-type': 'application/json', authorization: 'Bearer ' + token}, body: JSON.stringify(body)});
  const request = {schema_version: CHANNEL_INSTALL_SCHEMA, scope: {org_id: scope.org_id, runtime_registration_id: scope.runtime_registration_id, operator_user_id: scope.operator_user_id},
    channels: [{kind: 'action', channel: {channel_url: 'https://fixture.invalid/api/app-runtime/channel', credential: fresh, registration,
      technical_renewal: {expires_at: new Date(initial + 60000).toISOString(), renewable_until: ceiling}}}]};

  instance = await startRuntime(config, options);
  const forged = await install(request, randomBytes(32).toString('base64url'));
  assert.equal(forged.status, 401); await forged.body.cancel();
  const response = await install(request);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.equal(text.includes(fresh.session_token), false);
  assert.deepEqual(JSON.parse(text).installed.map(item => item.session_id), [fresh.session_id]);
  await settle(() => calls.freshRenew >= 1 && calls.freshClaim >= 1);
  await instance.close(); instance = null;

  // After restart the installed session replaces the stale operator-file channel.
  // Its persisted lease is still live, so it resumes claiming without an early renewal.
  const staleBefore = calls.staleRenew, claimsBefore = calls.freshClaim;
  instance = await startRuntime(config, options);
  await settle(() => calls.freshClaim > claimsBefore);
  assert.equal(calls.staleRenew, staleBefore);
});
