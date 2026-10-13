import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer, request as httpRequest} from 'node:http';
import {randomBytes} from 'node:crypto';
import {createHttpHandler} from './http.mjs';

test('completed HTTP request body keeps runtime alive; caller socket close aborts outstanding I/O', async t => {
  const token = randomBytes(32).toString('base64url'); let signal, entered, aborted;
  const ready = new Promise(done => {entered = done;}), cancelled = new Promise(done => {aborted = done;});
  const server = createServer(createHttpHandler({runtime_auth_token: token, runtime: {async request(input, currentSignal) {
    signal = currentSignal; entered();
    await new Promise((resolve, reject) => {signal.addEventListener('abort', () => {aborted(); reject(signal.reason);}, {once: true});});
  }}}));
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => server.close(done)));
  const request = httpRequest({hostname: '127.0.0.1', port: server.address().port, path: '/v1/connections', method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + token}}, () => {});
  request.on('error', () => {}); request.end('{}');
  await ready; assert.equal(signal.aborted, false);
  request.destroy(); await cancelled; assert.equal(signal.aborted, true);
});
