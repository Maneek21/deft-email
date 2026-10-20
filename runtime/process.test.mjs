import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp, writeFile, rm, unlink, rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {beginFor, client, makeScope, nextFor, registrationFor} from './test-support.mjs';
import {canonical} from './contract.mjs';

test('separate HTTP runtime process validates transport + host introspection and survives account restart', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'email-runtime-process-')), root = join(parent, 'state'), configFile = join(parent, 'runtime.json'), clientFile = join(parent, 'google.json'), runtimeToken = randomBytes(32).toString('base64url'), authorityToken = randomBytes(32).toString('base64url');
  const scope = makeScope(); let introspections = 0, revoked = false;
  const host = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, 'Bearer ' + authorityToken);
    if(request.url==='/api/app-connection-sessions/runtime/background-access'){response.writeHead(403,{'content-type':'application/json'});response.end('{}');return;}
    assert.equal(request.url, '/api/app-connection-sessions/runtime/authority');
    const chunks = []; for await (const chunk of request) chunks.push(chunk); const input = JSON.parse(Buffer.concat(chunks).toString('utf8')); introspections++;
    response.writeHead(200, {'content-type': 'application/json'}); response.end(JSON.stringify({...input, allowed: !revoked}));
  });
  await new Promise(done => host.listen(0, '127.0.0.1', done));
  await writeFile(clientFile, JSON.stringify(client), {mode: 0o600});
  await writeFile(configFile, JSON.stringify({listen_port: 0, store_root: root, key_id: 'fixture-key-v1', encryption_key_hex: randomBytes(32).toString('hex'), runtime_auth_token: runtimeToken, authority_token: authorityToken, authority_url: 'http://127.0.0.1:' + host.address().port + '/api/app-connection-sessions/runtime/authority', registration: registrationFor(scope), gmail_client_file: clientFile}), {mode: 0o600});
  let child;
  async function boot() {child = fork(fileURLToPath(new URL('./process-fixture.mjs', import.meta.url)), {env: {...process.env, EMAIL_RUNTIME_CONFIG_FILE: configFile}, stdio: ['ignore', 'pipe', 'pipe', 'ipc']}); return new Promise((done, reject) => {child.once('message', done); child.once('exit', code => reject(Error('fixture startup exit:' + code)));});}
  async function stop() { const current = child; child = null; const exit = new Promise(done => current.once('exit', done)); current.send('shutdown'); await exit; }
  t.after(async () => {if (child) await stop(); await new Promise(done => host.close(done)); await rm(parent, {recursive: true, force: true});});
  const post = async (port, input, credential = runtimeToken) => {const result = await fetch('http://127.0.0.1:' + port + '/v1/connections', {method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + credential}, body: JSON.stringify(input)}); return {status: result.status, body: await result.json()};};
  let {port} = await boot(); const begin = beginFor(scope);
  assert.equal((await post(port, begin, randomBytes(32).toString('base64url'))).status, 401); assert.equal(introspections, 0);
  const begun = (await post(port, begin)).body; assert.equal(begun.state, 'awaiting_callback');
  const connected = (await post(port, nextFor(begin, begun, 'callback'))).body; assert.equal(connected.state, 'connected');
  await stop(); ({port} = await boot());
  assert.deepEqual((await post(port, nextFor(begin, begun, 'status', connected.account))).body, connected);
  revoked = true; assert.equal((await post(port, nextFor(begin, begun, 'status', connected.account))).status, 403);
  revoked = false; assert.equal((await post(port, nextFor(begin, begun, 'disconnect', connected.account))).body.state, 'disconnected');
  assert.ok(introspections >= 12);
});
test('process killed during callback restarts automatically and preserves uncertain exchange fencing; no provider replay', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'email-runtime-crash-')), root = join(parent, 'state'), configFile = join(parent, 'runtime.json'), clientFile = join(parent, 'google.json'), runtimeToken = randomBytes(32).toString('base64url'), authorityToken = randomBytes(32).toString('base64url'), scope = makeScope();
  const host = createServer(async (request, response) => {assert.equal(request.headers.authorization, 'Bearer ' + authorityToken); const chunks = []; for await (const chunk of request) chunks.push(chunk); response.writeHead(200, {'content-type': 'application/json'}); response.end(JSON.stringify({...JSON.parse(Buffer.concat(chunks).toString('utf8')), allowed: true}));});
  await new Promise(done => host.listen(0, '127.0.0.1', done));
  await writeFile(clientFile, JSON.stringify(client), {mode: 0o600});
  await writeFile(configFile, JSON.stringify({listen_port: 0, store_root: root, key_id: 'fixture-key-v1', encryption_key_hex: randomBytes(32).toString('hex'), runtime_auth_token: runtimeToken, authority_token: authorityToken, authority_url: 'http://127.0.0.1:' + host.address().port + '/api/app-connection-sessions/runtime/authority', registration: registrationFor(scope), gmail_client_file: clientFile}), {mode: 0o600});
  let child, providerRequests = 0;
  const boot = async mode => {child = fork(fileURLToPath(new URL('./process-fixture.mjs', import.meta.url)), {env: {...process.env, EMAIL_RUNTIME_CONFIG_FILE: configFile, EMAIL_RUNTIME_FIXTURE_MODE: mode}, stdio: ['ignore', 'pipe', 'pipe', 'ipc']}); child.on('message', message => {if (message.event === 'provider_request') providerRequests++;}); return new Promise((done, reject) => {child.once('message', done); child.once('exit', code => reject(Error('fixture startup exit:' + code)));});};
  t.after(async () => {if (child) {const exited = new Promise(done => child.once('exit', done)); child.send('shutdown'); await exited;} await new Promise(done => host.close(done)); await rm(parent, {recursive: true, force: true});});
  const post = async (port, input) => {const response = await fetch('http://127.0.0.1:' + port + '/v1/connections', {method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + runtimeToken}, body: JSON.stringify(input)}); return response.json();};
  let {port} = await boot('hang-token'); const begin = beginFor(scope), begun = await post(port, begin);
  const exchange = new Promise(done => child.on('message', message => {if (message.event === 'exchange_started') done();}));
  const callbackResponse = post(port, nextFor(begin, begun, 'callback')).catch(() => null); await exchange;
  const exited = new Promise(done => child.once('exit', done)); child.kill('SIGKILL'); await exited; child = null; await callbackResponse;
  assert.equal(providerRequests, 1);
  // The OS releases writer ownership on crash; application effect fences remain.
  ({port} = await boot('normal'));
  assert.deepEqual(await post(port, nextFor(begin, begun, 'status')), {state: 'indeterminate'});
  assert.deepEqual(await post(port, nextFor(begin, begun, 'callback')), {state: 'indeterminate'});
  assert.equal(providerRequests, 1);
});
test('one HTTP process/store connects two registrations and preserves isolated accounts across restart', async t => {
  const parent = await mkdtemp(join(tmpdir(), 'email-runtime-multiple-')), root = join(parent, 'state'), configFile = join(parent, 'runtime.json'), clientFile = join(parent, 'google.json'), runtimeToken = randomBytes(32).toString('base64url'), authorityToken = randomBytes(32).toString('base64url');
  const firstScope = makeScope(), secondScope = {...makeScope(), org_id: firstScope.org_id, operator_user_id: firstScope.operator_user_id};
  const scopes = [firstScope, secondScope]; let introspections = 0, providerRequests = 0;
  const host = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, 'Bearer ' + authorityToken); const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8')); introspections++;
    response.writeHead(200, {'content-type': 'application/json'}); response.end(JSON.stringify({...input, allowed: scopes.some(scope => canonical(scope) === canonical(input.scope))}));
  });
  await new Promise(done => host.listen(0, '127.0.0.1', done));
  await writeFile(clientFile, JSON.stringify(client), {mode: 0o600});
  await writeFile(configFile, JSON.stringify({listen_port: 0, store_root: root, key_id: 'fixture-key-v1', encryption_key_hex: randomBytes(32).toString('hex'), runtime_auth_token: runtimeToken, authority_token: authorityToken, authority_url: 'http://127.0.0.1:' + host.address().port + '/api/app-connection-sessions/runtime/authority', registrations: scopes.map(registrationFor), gmail_client_file: clientFile}), {mode: 0o600});
  let child;
  const boot = async () => {child = fork(fileURLToPath(new URL('./process-fixture.mjs', import.meta.url)), {env: {...process.env, EMAIL_RUNTIME_CONFIG_FILE: configFile, EMAIL_RUNTIME_FIXTURE_MODE: 'two-accounts'}, stdio: ['ignore', 'pipe', 'pipe', 'ipc']}); child.on('message', message => {if (message.event === 'provider_request') providerRequests++;}); return new Promise((done, reject) => {child.once('message', done); child.once('exit', code => reject(Error('fixture startup exit:' + code)));});};
  const stop = async () => {const current = child; child = null; const exited = new Promise(done => current.once('exit', done)); current.send('shutdown'); await exited;};
  t.after(async () => {if (child) await stop(); await new Promise(done => host.close(done)); await rm(parent, {recursive: true, force: true});});
  const post = async (port, input) => {const response = await fetch('http://127.0.0.1:' + port + '/v1/connections', {method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + runtimeToken}, body: JSON.stringify(input)}); return {status: response.status, body: await response.json()};};
  let {port} = await boot(); const begins = scopes.map(beginFor), begun = [], connected = [];
  for (const begin of begins) {const result = await post(port, begin); assert.equal(result.status, 200); begun.push(result.body);}
  for (let index = 0; index < 2; index++) {const callback = nextFor(begins[index], begun[index], 'callback'); callback.callback.code = index === 0 ? 'fixture-first-account' : 'fixture-second-account'; const result = await post(port, callback); assert.equal(result.status, 200); assert.equal(result.body.state, 'connected'); connected.push(result.body);}
  assert.notEqual(connected[0].account.account_ref, connected[1].account.account_ref); assert.equal(providerRequests, 6);
  assert.equal(connected[0].account.label, 'first@example.test'); assert.equal(connected[1].account.label, 'second@example.test');
  const calls = introspections;
  assert.equal((await post(port, beginFor({...firstScope, runtime_registration_id: '11111111-1111-4111-8111-111111111111'}))).status, 403);
  assert.equal((await post(port, beginFor({...firstScope, runtime_epoch: firstScope.runtime_epoch + 1}))).status, 403);
  assert.equal(introspections, calls); // registration selection denies before online authority/engine access
  assert.equal((await post(port, {...nextFor(begins[0], begun[0], 'status', connected[0].account), scope: secondScope})).status, 403);
  assert.equal((await post(port, nextFor(begins[1], begun[1], 'status', connected[0].account))).status, 403);
  await stop(); ({port} = await boot());
  for (let index = 0; index < 2; index++) assert.deepEqual((await post(port, nextFor(begins[index], begun[index], 'status', connected[index].account))).body, connected[index]);
  assert.equal((await post(port, nextFor(begins[0], begun[0], 'disconnect', connected[0].account))).body.state, 'disconnected');
  assert.deepEqual((await post(port, nextFor(begins[1], begun[1], 'status', connected[1].account))).body, connected[1]);
  assert.equal(providerRequests, 6);
});
