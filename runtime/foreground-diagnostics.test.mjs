import test from 'node:test';
import assert from 'node:assert/strict';
import {createForegroundDiagnostics} from './foreground-diagnostics.mjs';

test('foreground timings preserve the first failure phase without private error strings', async () => {
  let now = 0; const events = [], error = Object.assign(new Error('private@example.test Bearer private-secret'), {code: 'private-secret'});
  const trace = createForegroundDiagnostics({request_id: 'synthetic-request', operation: 'resource_list', clock: () => now, onDiagnostic: event => events.push(event)});
  await assert.rejects(trace.span('execution', () => trace.span('authority', async () => { now = 12; throw error; })), value => value === error);
  trace.finish(error); trace.finish(error);
  assert.equal(events.length, 1); assert.equal(events[0].failure.phase, 'authority');
  assert.equal(events[0].timings.authority.elapsed_ms, 12); assert.equal(events[0].failure.code, 'OPAQUE_ERROR');
  assert.ok(!JSON.stringify(events).includes('private'));
});

test('foreground timing reports queue separately and a broken sink cannot change success', async () => {
  let now = 0; const trace = createForegroundDiagnostics({request_id: 'synthetic-request', operation: 'resource_read_image', clock: () => now, onDiagnostic() { throw Error('sink'); }});
  const queued = trace.start('session_queue'); now = 14; queued(); queued();
  assert.equal(await trace.span('provider_http', async () => { now = 19; return 'result'; }), 'result');
  assert.doesNotThrow(() => trace.finish());
});
