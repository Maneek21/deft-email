import test from 'node:test';
import assert from 'node:assert/strict';
import {CHANNEL_INSTALL_SCHEMA, createChannelInstaller} from './installed-channels.mjs';

const org = '11111111-1111-4111-8111-111111111111', operator = '22222222-2222-4222-8222-222222222222';
const registration = {org_id: org, runtime_registration_id: '33333333-3333-4333-8333-333333333333', operator_user_id: operator,
  runtime_epoch: 1, profile_digest: 'sha256:' + 'a'.repeat(64), target_key: 'fresh_mailbox', resource_key: 'inbox'};
const registrations = [{...registration, connection_protocol: 'v2'}];
const scope = {org_id: org, runtime_registration_id: registration.runtime_registration_id, operator_user_id: operator};
const renewal = {expires_at: '2026-10-20T07:00:00.000Z', renewable_until: '2026-11-17T00:00:00.000Z'};
const action = (session = '44444444-4444-4444-8444-444444444444') => ({kind: 'action', channel: {
  channel_url: 'https://demo.example/api/app-runtime/channel', credential: {session_id: session, session_token: 'T'.repeat(43)},
  registration: {org_id: org, runtime_registration_id: '55555555-5555-4555-8555-555555555555', runtime_epoch: 1}, technical_renewal: renewal}});
const observation = () => ({kind: 'observation', channel: {
  channel_url: 'https://demo.example/api/app-resource-sync-channel/v3', observation_authority_url: 'https://demo.example/api/app-resource-observations/runtime',
  credential: {session_id: '66666666-6666-4666-8666-666666666666', session_token: 'O'.repeat(43)}, registration, technical_renewal: {...renewal, renewable_until: null, renewal_lifetime: 'until_revoked'}}});

function memoryStore() {
  let row = null;
  return {get value() { return row?.value; }, withLock: async (_key, work) => work({
    read: async () => row && structuredClone(row),
    compareAndSwap: async ({expected_revision, value}) => { if ((row?.revision ?? null) !== expected_revision) return false; row = {revision: (row?.revision ?? 0) + 1, value: structuredClone(value)}; return true; },
  })};
}
const installer = (store, overrides = {}) => {
  const activated = [];
  return {activated, installer: createChannelInstaller({store, registrations,
    verify: async () => ({renewal: {expires_at: '2026-10-20T07:10:00.000Z'}}), activate: async verified => { activated.push(...verified); }, ...overrides})};
};

test('a verified install is persisted, activated and returned without tokens', async () => {
  const store = memoryStore(), {installer: subject, activated} = installer(store);
  const result = await subject.request({schema_version: CHANNEL_INSTALL_SCHEMA, scope, channels: [action(), observation()]});
  assert.equal(activated.length, 2);
  assert.equal(JSON.stringify(result).includes('TTTT'), false);
  assert.deepEqual(result.installed.map(item => item.kind), ['action', 'observation']);
  const loaded = await subject.load();
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].channel.technical_renewal.expires_at, '2026-10-20T07:10:00.000Z');
});

test('a newer install replaces the channel for the same registration', async () => {
  const store = memoryStore(), {installer: subject} = installer(store);
  await subject.request({schema_version: CHANNEL_INSTALL_SCHEMA, scope, channels: [action()]});
  await subject.request({schema_version: CHANNEL_INSTALL_SCHEMA, scope, channels: [action('77777777-7777-4777-8777-777777777777')]});
  const loaded = await subject.load();
  assert.deepEqual(loaded.map(entry => entry.channel.credential.session_id), ['77777777-7777-4777-8777-777777777777']);
});

test('nothing is kept when the Host does not confirm a session', async () => {
  const store = memoryStore(), {installer: subject, activated} = installer(store, {verify: async () => { throw Object.assign(Error('denied'), {code: 'EMAIL_RUNTIME_CHANNEL_INSTALL_DENIED'}); }});
  await assert.rejects(subject.request({schema_version: CHANNEL_INSTALL_SCHEMA, scope, channels: [action()]}), {code: 'EMAIL_RUNTIME_CHANNEL_INSTALL_DENIED'});
  assert.equal(store.value, undefined); assert.equal(activated.length, 0);
});

test('installs are refused for other runtimes, unknown registrations and fixed leases', async () => {
  const {installer: subject} = installer(memoryStore()), request = channels => subject.request({schema_version: CHANNEL_INSTALL_SCHEMA, scope, channels});
  await assert.rejects(subject.request({schema_version: CHANNEL_INSTALL_SCHEMA, scope: {...scope, operator_user_id: org}, channels: [action()]}), {code: 'EMAIL_RUNTIME_CHANNEL_INSTALL_DENIED'});
  const unknown = observation(); unknown.channel.registration = {...registration, target_key: 'other'};
  await assert.rejects(request([unknown]), {code: 'EMAIL_RUNTIME_CHANNEL_INSTALL_DENIED'});
  const fixed = action(); delete fixed.channel.technical_renewal;
  await assert.rejects(request([fixed]), {code: 'EMAIL_RUNTIME_CHANNEL_INSTALL_DENIED'});
  const elsewhere = action(); elsewhere.channel.channel_url = 'https://demo.example/api/other';
  await assert.rejects(request([elsewhere]), {code: 'EMAIL_RUNTIME_CHANNEL_INSTALL_DENIED'});
  await assert.rejects(request([action(), action('77777777-7777-4777-8777-777777777777')]), {code: 'EMAIL_RUNTIME_CHANNEL_INSTALL_DENIED'});
});
