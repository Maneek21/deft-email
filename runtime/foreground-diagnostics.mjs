const phases = new Set(['authority', 'visibility', 'session_queue', 'session_hold', 'pre_provider', 'provider_http', 'execution', 'disclosure']);
const codes = new Set(['EMAIL_DATA_AUTHORITY_DENIED', 'EMAIL_DATA_AUTHORITY_EXPIRED', 'EMAIL_DATA_CONNECTION_DENIED', 'EMAIL_DATA_SOURCE_CHANGED', 'EMAIL_RUNTIME_STORE_CLOSED', 'EMAIL_NATIVE_PROVIDER_RECONNECT_REQUIRED', 'EMAIL_RUNTIME_CREDENTIAL_REPAIR_RESERVED', 'EMAIL_PROVIDER_NETWORK_UNAVAILABLE']);

/** Bounded, content-free timings for one already validated data request. The
 * first failing phase survives outer provider error translation. Diagnostics
 * never participate in authorization or change the request outcome. */
export function createForegroundDiagnostics({request_id, operation, onDiagnostic, clock = () => performance.now()}) {
  const began = clock(), timings = Object.create(null);
  let failure, finished = false;
  const duration = start => Math.max(0, Math.round((clock() - start) * 100) / 100);
  const failed = (phase, error) => {
    if (!failure) failure = {phase, code: codes.has(error?.code) ? error.code : error?.name === 'TimeoutError' ? 'TIMEOUT' : error?.name === 'AbortError' ? 'ABORTED' : 'OPAQUE_ERROR'};
  };
  function start(phase) {
    if (!phases.has(phase)) throw new Error('EMAIL_DIAGNOSTIC_PHASE_INVALID');
    const began = clock(); let ended = false;
    return error => {
      if (ended) return; ended = true;
      const row = timings[phase] ??= {calls: 0, elapsed_ms: 0};
      row.calls++; row.elapsed_ms = Math.round((row.elapsed_ms + duration(began)) * 100) / 100;
      if (error) failed(phase, error);
    };
  }
  return {
    start,
    async span(phase, work) { const end = start(phase); try { const value = await work(); end(); return value; } catch (error) { end(error); throw error; } },
    finish(error) {
      if (finished) return; finished = true;
      if (error && !failure) failed('execution', error);
      const elapsed_ms = duration(began);
      const event = {event: 'email_foreground_timing', request_id, operation, outcome: error ? 'failed' : 'completed', elapsed_ms, timings, ...(failure ? {failure} : {})};
      try { if (onDiagnostic) onDiagnostic(event); else if (error || elapsed_ms >= 250) console.info(JSON.stringify(event)); } catch {}
    }
  };
}
