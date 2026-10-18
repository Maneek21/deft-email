import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes, randomUUID} from 'node:crypto';
import {createDurableStore} from './durable-store.mjs';
import {createConnectionRuntime} from './connection-runtime.mjs';
import {createRegistrationDispatcher, validateRegistrations} from './registration-dispatch.mjs';
import {canonical} from './contract.mjs';
import {authority, beginFor, client, makeScope, nextFor, providerFixture, registrationFor} from './test-support.mjs';

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'email-runtime-e2-')), key = randomBytes(32), scope = makeScope();
  let store;
  const open = async (extra = {}) => { store = await createDurableStore({root, encryption_key: key, key_id: 'fixture-key-v1', allow_windows_fixture: true}); return createConnectionRuntime({registration: registrationFor(scope), client, store, encryption_key: key, key_id: 'fixture-key-v1', assertCurrent: authority, fetch: providerFixture, ...options, ...extra}); };
  t.after(async () => {await store?.close(); await rm(root, {recursive: true, force: true});});
  return {root, key, scope, open, store: () => store, close: async () => {await store.close(); store = null;}};
}
test('fresh Gmail begin/callback, connected account and ciphertext survive restart then disconnect', async t => {
  const f = await fixture(t); let runtime = await f.open(); const begin = beginFor(f.scope), begun = await runtime.request(begin);
  assert.equal(begun.state, 'awaiting_callback'); const url = new URL(begun.authorization_url);
  assert.equal(url.origin, 'https://accounts.google.com'); assert.equal(url.searchParams.get('state'), begin.callback_state);
  assert.equal(url.searchParams.get('scope'), 'openid email https://www.googleapis.com/auth/gmail.readonly'); assert.doesNotMatch(url.searchParams.get('scope'), /gmail\.(send|modify)/u);
  await f.store().withLock({key: 'email.runtime.session.' + begin.session_id}, async tx => {const row = await tx.read(); assert.deepEqual(row.value.binding.capabilities, ['read', 'search', 'thread']); assert.equal(row.value.binding.action_binding_id, null);});
  const connected = await runtime.request(nextFor(begin, begun, 'callback'), AbortSignal.timeout(5000)); assert.equal(connected.state, 'connected');
  assert.equal(connected.account.label, 'fixture@example.test');
  await f.close(); runtime = await f.open(); assert.deepEqual(await runtime.request(nextFor(begin, begun, 'status', connected.account)), connected);
  const bytes = (await Promise.all((await readdir(f.root)).filter(name => name.endsWith('.json')).map(name => readFile(join(f.root, name), 'utf8')))).join('\n');
  for (const secret of ['fixture-only-access-secret', 'fixture-only-refresh-secret', 'fixture-only-code', 'fixture@example.test', begin.callback_state]) assert.equal(bytes.includes(secret), false);
  await assert.rejects(runtime.request(nextFor(begin, begun, 'callback')), {code: 'EMAIL_RUNTIME_CALLBACK_REPLAY'});
  assert.equal((await runtime.request(nextFor(begin, begun, 'disconnect', connected.account))).state, 'disconnected');
  await f.close(); runtime = await f.open(); assert.deepEqual(await runtime.request(nextFor(begin, begun, 'status')), {state: 'disconnected'});
});
test('every exact authority pin, epoch, expiry and extra field fails closed before provider I/O', async t => {
  let calls = 0; const f = await fixture(t, {fetch: async (...args) => {calls++; return providerFixture(...args);}, assertCurrent: async input => ({...input, allowed: canonical(input.scope) === canonical(f.scope)})});
  const runtime = await f.open(), begin = beginFor(f.scope), begun = await runtime.request(begin);
  for (const field of Object.keys(f.scope)) {
    const request = nextFor(begin, begun, 'callback');
    request.scope[field] = field.endsWith('_epoch') ? request.scope[field] + 1 : field.endsWith('_id') ? randomUUID() : field.endsWith('_digest') ? 'sha256:' + 'd'.repeat(64) : field === 'consent_expires_at' ? new Date(Date.now() - 1000).toISOString() : 'foreign_key';
    await assert.rejects(runtime.request(request));
  }
  const expired = nextFor(begin, begun, 'callback'); expired.expires_at = new Date(Date.now() - 1).toISOString(); await assert.rejects(runtime.request(expired));
  await assert.rejects(runtime.request({...nextFor(begin, begun, 'callback'), client_secret: 'forbidden'}), {code: 'EMAIL_RUNTIME_INPUT_INVALID'});
  assert.equal(calls, 0);
});
test('callback provider uncertainty is durable and never exchanged twice after restart', async t => {
  let exchange = 0; const f = await fixture(t, {fetch: async url => {if (url.includes('/token')) exchange++; throw Error('simulated-lost-provider-response');}});
  let runtime = await f.open(); const begin = beginFor(f.scope), begun = await runtime.request(begin);
  await assert.rejects(runtime.request(nextFor(begin, begun, 'callback'))); assert.equal(exchange, 1);
  await f.close(); runtime = await f.open();
  assert.deepEqual(await runtime.request(nextFor(begin, begun, 'status')), {state: 'indeterminate'});
  assert.deepEqual(await runtime.request(nextFor(begin, begun, 'callback')), {state: 'indeterminate'});
  assert.equal(exchange, 1);
});
test('started callback marker survives process boundary and status performs no OAuth I/O', async t => {
  const f = await fixture(t); let runtime = await f.open(); const begin = beginFor(f.scope), begun = await runtime.request(begin);
  await f.store().withLock({key: 'email.runtime.session.' + begin.session_id}, async tx => {const row = await tx.read(); assert.equal(await tx.compareAndSwap({expected_revision: row.revision, value: {...row.value, state: 'callback_started'}}), true);});
  await f.close(); let calls = 0; runtime = await f.open({fetch: () => {calls++; throw Error('no-replay');}});
  assert.deepEqual(await runtime.request(nextFor(begin, begun, 'status')), {state: 'indeterminate'});
  assert.deepEqual(await runtime.request(nextFor(begin, begun, 'callback')), {state: 'indeterminate'}); assert.equal(calls, 0);
});
test('authority drift after token exchange refuses identity provider request', async t => {
  let allowed = true, calls = 0; const f = await fixture(t, {assertCurrent: async input => ({...input, allowed}), fetch: async url => {calls++; const result = await providerFixture(url); allowed = false; return result;}});
  const runtime = await f.open(), begin = beginFor(f.scope), begun = await runtime.request(begin);
  await assert.rejects(runtime.request(nextFor(begin, begun, 'callback'))); assert.equal(calls, 1);
});
test('foreign account handle and denied callback replay are rejected', async t => {
  const f = await fixture(t); const runtime = await f.open(), begin = beginFor(f.scope), begun = await runtime.request(begin);
  await assert.rejects(runtime.request(nextFor(begin, begun, 'status', {account_ref: randomUUID()})), {code: 'EMAIL_RUNTIME_ACCOUNT_DENIED'});
  const callback = nextFor(begin, begun, 'callback'); callback.callback = {outcome: 'denied'};
  assert.deepEqual(await runtime.request(callback), {state: 'not_connected'});
  await assert.rejects(runtime.request(callback), {code: 'EMAIL_RUNTIME_CALLBACK_REPLAY'});
});
test('store exclusive writer, CAS conflict and ciphertext authentication fail closed', async t => {
  const f = await fixture(t); await f.open();
  await assert.rejects(createDurableStore({root: f.root, encryption_key: f.key, key_id: 'fixture-key-v1', allow_windows_fixture: true}), {code: 'EMAIL_RUNTIME_WRITER_LOCKED'});
  await f.store().withLock({key: 'row'}, async tx => {assert.equal(await tx.compareAndSwap({expected_revision: null, value: {hello: 'secret'}}), true); assert.equal(await tx.compareAndSwap({expected_revision: null, value: {hello: 'replacement'}}), false);});
  const name = (await readdir(f.root)).find(name => name.endsWith('.json')), path = join(f.root, name), row = JSON.parse(await readFile(path, 'utf8')); row.ciphertext = 'b' + row.ciphertext.slice(1); await writeFile(path, JSON.stringify(row));
  await assert.rejects(f.store().withLock({key: 'row'}, tx => tx.read()), {code: 'EMAIL_RUNTIME_STORE_ROW_INVALID'});
});
test('introspection response cannot substitute session/operation/schema or extend an authority deadline', async t => {
  const f = await fixture(t);
  for (const alter of [input => ({...input, session_id: randomUUID()}), input => ({...input, operation: 'disconnect'}), input => ({...input, schema_version: 'foreign.schema.v1'}), input => ({...input, expires_at: new Date(Date.parse(input.expires_at) + 1).toISOString()}), input => ({...input, unexpected: true})]) {
    const runtime = await f.open({assertCurrent: async input => ({...alter(input), allowed: true})});
    await assert.rejects(runtime.request(beginFor(f.scope)));
    await f.close();
  }
});
test('changed provider client identity or redirect fences retained connected state before disclosure or I/O', async t => {
  for (const changed of [{...client, client_id: 'changed-client'}, {...client, redirect_uri: 'https://host.example/different-callback'}]) {
    const f = await fixture(t); let runtime = await f.open(); const begin = beginFor(f.scope), begun = await runtime.request(begin);
    const connected = await runtime.request(nextFor(begin, begun, 'callback')); await f.close();
    let calls = 0; runtime = await f.open({client: changed, fetch: () => {calls++; throw Error('must-not-call-provider');}});
    assert.deepEqual(await runtime.request(nextFor(begin, begun, 'status', connected.account)), {state: 'indeterminate'});
    assert.deepEqual(await runtime.request(nextFor(begin, begun, 'disconnect', connected.account)), {state: 'indeterminate'});
    assert.deepEqual(await runtime.request(nextFor(begin, begun, 'callback')), {state: 'indeterminate'}); assert.equal(calls, 0);
    await f.store().withLock({key: 'email.runtime.session.' + begin.session_id}, async tx => {const row = await tx.read(); assert.deepEqual(row.value.account, connected.account); assert.equal(row.value.state, 'indeterminate');});
    await f.close();
  }
});
test('legacy journal missing client fingerprint stays indeterminate with custody preserved', async t => {
  const f = await fixture(t); let runtime = await f.open(); const begin = beginFor(f.scope), begun = await runtime.request(begin), connected = await runtime.request(nextFor(begin, begun, 'callback'));
  await f.store().withLock({key: 'email.runtime.session.' + begin.session_id}, async tx => {const row = await tx.read(); const {client_fingerprint, ...legacy} = row.value; await tx.compareAndSwap({expected_revision: row.revision, value: legacy});});
  await f.close(); runtime = await f.open({fetch: () => {throw Error('must-not-auto-reconnect');}});
  assert.deepEqual(await runtime.request(nextFor(begin, begun, 'status', connected.account)), {state: 'indeterminate'});
  await f.store().withLock({key: 'email.runtime.session.' + begin.session_id}, async tx => {const row = await tx.read(); assert.deepEqual(row.value.account, connected.account); assert.equal(row.value.provider_state, null); assert.equal(row.value.client_fingerprint, undefined);});
});
test('authority narrowed to 150ms aborts a 300ms provider exchange and keeps callback indeterminate', async () => {
  const rows = new Map(), store = {async withLock({key}, work) {return work({async read() {return structuredClone(rows.get(key) ?? null);}, async compareAndSwap({expected_revision, value}) {const prior = rows.get(key); if ((prior?.revision ?? null) !== expected_revision) return false; rows.set(key, {revision: (expected_revision ?? 0) + 1, value: structuredClone(value)}); return true;}});}};
  const scope = makeScope(); let narrowed = true, callbackDeadline, providerStarted = false, providerCompleted = false, providerAborted = false;
  const runtime = createConnectionRuntime({registration: registrationFor(scope), client, store, encryption_key: randomBytes(32), key_id: 'fixture-key-v1', assertCurrent: async input => {
    if (input.operation === 'callback' && narrowed) {callbackDeadline ??= Date.now() + 150; return {...input, expires_at: new Date(Math.min(callbackDeadline, Date.parse(input.expires_at))).toISOString(), allowed: true};}
    return {...input, allowed: true};
  }, fetch: (url, options) => {
    providerStarted = true;
    return new Promise((resolve, reject) => {const timer = setTimeout(() => {providerCompleted = true; resolve(providerFixture(url));}, 300); options.signal.addEventListener('abort', () => {providerAborted = true; clearTimeout(timer); reject(options.signal.reason);}, {once: true});});
  }});
  const begin = beginFor(scope), begun = await runtime.request(begin);
  await assert.rejects(runtime.request(nextFor(begin, begun, 'callback'), AbortSignal.timeout(5000)));
  assert.equal(providerStarted, true); assert.equal(providerAborted, true); assert.equal(providerCompleted, false);
  narrowed = false; assert.deepEqual(await runtime.request(nextFor(begin, begun, 'status')), {state: 'indeterminate'});
});
test('registration client fingerprint survives restart and fences new session IDs until new reviewed registration or epoch', async t => {
  const f = await fixture(t); let runtime = await f.open(); const begin = beginFor(f.scope), begun = await runtime.request(begin), connected = await runtime.request(nextFor(begin, begun, 'callback'));
  await f.close(); let providerCalls = 0;
  const changedClient = {...client, client_id: 'changed-client', redirect_uri: 'https://host.example/changed-callback'}, blockedFetch = () => {providerCalls++; throw Error('must-not-call-provider');};
  runtime = await f.open({client: changedClient, fetch: blockedFetch});
  await assert.rejects(runtime.request(beginFor(f.scope)), {code: 'EMAIL_RUNTIME_CLIENT_REGISTRATION_CHANGED'});
  assert.deepEqual(await runtime.request(nextFor(begin, begun, 'status', connected.account)), {state: 'indeterminate'});
  assert.equal(providerCalls, 0);
  await f.close(); runtime = await f.open({client: changedClient, fetch: blockedFetch});
  await assert.rejects(runtime.request(beginFor(f.scope)), {code: 'EMAIL_RUNTIME_CLIENT_REGISTRATION_CHANGED'});
  await f.close(); runtime = await f.open(); await assert.rejects(runtime.request(beginFor(f.scope)),{code:'EMAIL_RUNTIME_REATTACH_DENIED'}); // Retained uncertain custody cannot become a second current-scope account.
  await f.close();
  for (const reviewedScope of [{...f.scope, runtime_epoch: f.scope.runtime_epoch + 1}, {...f.scope, runtime_registration_id: randomUUID()}]) {
    runtime = await f.open({registration: registrationFor(reviewedScope), client: changedClient, fetch: blockedFetch});
    assert.equal((await runtime.request(beginFor(reviewedScope))).state, 'awaiting_callback');
    await f.close();
  }
  assert.equal(providerCalls, 0);
});
test('explicit registration dispatch rejects empty, duplicate, oversized and unknown/drifted registration before authority or provider I/O', async () => {
  const scope = makeScope(), registration = registrationFor(scope);
  for (const registrations of [[], [registration, registration], Array.from({length: 33}, () => ({...registration, runtime_registration_id: randomUUID()}))]) assert.throws(() => validateRegistrations(registrations), {code: 'EMAIL_RUNTIME_CONFIG_INVALID'});
  let calls = 0;
  const runtime = createRegistrationDispatcher({registrations: [registration], client, store: {withLock() {calls++; throw Error('must-not-open-store');}}, encryption_key: randomBytes(32), key_id: 'fixture-key-v1', assertCurrent() {calls++; throw Error('must-not-introspect');}, fetch() {calls++; throw Error('must-not-fetch');}});
  for (const mutation of [{runtime_registration_id: randomUUID()}, {runtime_epoch: scope.runtime_epoch + 1}, {operator_user_id: randomUUID()}, {profile_digest: 'sha256:' + 'd'.repeat(64)}, {resource_key: 'other_resource'}]) {
    await assert.rejects(runtime.request(beginFor({...scope, ...mutation})), {code: 'EMAIL_RUNTIME_REGISTRATION_DENIED'});
  }
  assert.equal(calls, 0);
});
