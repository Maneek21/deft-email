import {APP_DATA_LIMITS,AppDataRuntimeRequestSchema,AppIntegrationToolRuntimeRequestSchema} from '@deft/app-kit/core';
import {createHash, timingSafeEqual} from 'node:crypto';
import {fail, token} from './contract.mjs';
import {DATA_JSON_BYTES,FILE_FRAME_HEADER_BYTES,FILE_BYTES,decodeFileFrame,encodeFileFrame} from './data-contract.mjs';
import {REATTACH_VERSION,REATTACH_V2_VERSION,validateReattachRequest,reattachPhaseDeadline} from './reattach-contract.mjs';

export const MAX_HTTP_BYTES = 16384;
export function trustedUrl(value, allow_loopback_fixture = false) {
  let url; try { url = new URL(value); } catch { fail('EMAIL_RUNTIME_CONFIG_INVALID'); }
  if (url.username || url.password || url.hash || url.search || !(url.protocol === 'https:' || allow_loopback_fixture && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) fail('EMAIL_RUNTIME_CONFIG_INVALID');
  return url.href;
}
export async function boundedJson(response, signal, maximum = MAX_HTTP_BYTES) {
  if (!response.ok || !/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '') || Number(response.headers.get('content-length')) > maximum) fail('EMAIL_RUNTIME_TRANSPORT_DENIED');
  const reader = response.body?.getReader(); if (!reader) fail('EMAIL_RUNTIME_TRANSPORT_DENIED');
  const chunks = []; let size = 0;
  const aborted=()=>{void reader.cancel(signal.reason).catch(()=>{});};signal?.addEventListener('abort',aborted,{once:true});
  try { for (;;) { signal?.throwIfAborted(); const {done, value} = await reader.read(); signal?.throwIfAborted(); if (done) break; size += value.byteLength; if (size > maximum) { await reader.cancel(); fail('EMAIL_RUNTIME_TRANSPORT_LIMIT'); } chunks.push(Buffer.from(value)); } return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  finally { signal?.removeEventListener('abort',aborted);reader.releaseLock(); }
}
// The Host admits sixteen simultaneous callbacks per runtime peer. Share a
// smaller transport bound across clients/accounts and leave room for channels.
// Every queued call still obtains its own fresh response under its original clock.
const authorityHosts=new Map();
async function authoritySlot(host,signal){
 signal.throwIfAborted();
 if(host.active<8)host.active++;
 else{
  if(host.waiting.length>=128)fail('EMAIL_RUNTIME_TRANSPORT_LIMIT');
  await new Promise((resolve,reject)=>{
   const entry={signal,resolve,reject,abort:()=>{const index=host.waiting.indexOf(entry);if(index!==-1)host.waiting.splice(index,1);signal.removeEventListener('abort',entry.abort);reject(signal.reason);}};
   host.waiting.push(entry);signal.addEventListener('abort',entry.abort,{once:true});if(signal.aborted)entry.abort();
  });
 }
 return ()=>{
  host.active--;
  while(host.waiting.length){const next=host.waiting.shift();next.signal.removeEventListener('abort',next.abort);if(next.signal.aborted){next.reject(next.signal.reason);continue;}host.active++;next.resolve();break;}
 };
}
export function createAuthorityClient({authority_url, authority_token, fetch: fetchImpl = globalThis.fetch, allow_loopback_fixture = false, maximum_bytes = MAX_HTTP_BYTES, timeout_ms = 5000}) {
  if (!Number.isSafeInteger(maximum_bytes) || maximum_bytes < MAX_HTTP_BYTES || maximum_bytes > 614400) fail('EMAIL_RUNTIME_CONFIG_INVALID');
  if (!Number.isSafeInteger(timeout_ms) || timeout_ms < 1 || timeout_ms > 30000) fail('EMAIL_RUNTIME_CONFIG_INVALID');
  const url = trustedUrl(authority_url, allow_loopback_fixture), secret = token(authority_token);
  const origin=new URL(url).origin;let host=authorityHosts.get(origin);if(!host){host={active:0,waiting:[]};authorityHosts.set(origin,host);}
  return async (input, signal) => {
    const bytes = JSON.stringify(input); if (Buffer.byteLength(bytes) > maximum_bytes) fail('EMAIL_RUNTIME_TRANSPORT_LIMIT');
    const activeSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(timeout_ms)]):AbortSignal.timeout(timeout_ms),expires=typeof input?.expires_at==='string'?Date.parse(input.expires_at):Infinity;
    const check=()=>{activeSignal.throwIfAborted();if(expires<=Date.now())fail('EMAIL_RUNTIME_AUTHORITY_DENIED');};check();
    const release=await authoritySlot(host,activeSignal);
    try{check();const response=await fetchImpl(url, {method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + secret}, body: bytes, redirect: 'error', signal:activeSignal});
      // The Host can deny a once-current request while its account is being
      // checked or after access ends. Preserve that denial; a live Runtime
      // receiving HTTP 403 is not evidence of a transport outage.
      if(response.status===401||response.status===403){void response.body?.cancel().catch(()=>{});fail('EMAIL_RUNTIME_AUTHORITY_DENIED');}
      const result=await boundedJson(response,activeSignal,maximum_bytes);check();return result;}
    finally{release();}
  };
}
const sha = value => createHash('sha256').update(value).digest();
export function createHttpHandler({runtime, data_runtime, local_job_runtime, run_inspection_runtime, integration_tool_runtime, runtime_auth_token, shutdown_signal, onDenial=entry=>console.error(JSON.stringify(entry)), onFailure=entry=>console.error(JSON.stringify(entry))}) {
  const expected = sha(token(runtime_auth_token));
  return async (request, response) => {
    const send = (value, status = 200) => { response.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'}); response.end(JSON.stringify(value)); };
    const isData=request.url==='/v1/data',isLocalJob=request.url==='/v1/local-jobs',isInspection=request.url==='/v1/run-inspections',isIntegrationTool=request.url==='/v1/integration-tools';
    if (request.method !== 'POST' || !(request.url === '/v1/connections'||isData&&data_runtime||isLocalJob&&local_job_runtime||isInspection&&run_inspection_runtime||isIntegrationTool&&integration_tool_runtime)) { send({error: 'EMAIL_RUNTIME_ROUTE_DENIED'}, 404); return; }
    // These credentials authenticate the registered host transport only; the host's online authority check remains mandatory.
    const credential = request.headers.authorization;
    if (typeof credential !== 'string' || !/^Bearer [A-Za-z0-9_-]{43,256}$/u.test(credential) || !timingSafeEqual(expected, sha(credential.slice(7)))) { send({error: 'EMAIL_RUNTIME_TRANSPORT_DENIED'}, 401); return; }
    const disconnected = new AbortController();
    const aborted = () => disconnected.abort(new Error('EMAIL_RUNTIME_CALLER_DISCONNECTED'));
    const requestClosed = () => {if (!request.complete) aborted();};
    const responseClosed = () => {if (!response.writableEnded) aborted();};
    request.on('aborted', aborted); request.on('close', requestClosed); response.on('close', responseClosed);
    const deadlineAbort=new AbortController(),bodyDeadline=Date.now()+30000;let phaseTimer;
    const armDeadline=deadline=>{clearTimeout(phaseTimer);const expire=()=>deadlineAbort.abort(new DOMException('Runtime request deadline exceeded','TimeoutError'));
      if(deadline<=Date.now()){expire();return;}phaseTimer=setTimeout(expire,deadline-Date.now());phaseTimer.unref?.();};
    armDeadline(bodyDeadline);
    const signal = AbortSignal.any([disconnected.signal, deadlineAbort.signal,...(shutdown_signal?[shutdown_signal]:[])]);
    // Aborting the operation must also wake a body iterator whose peer stopped
    // sending bytes. Merely checking the signal inside the loop cannot do that.
    const cancelBody = () => request.destroy();
    signal.addEventListener('abort',cancelBody,{once:true});
    let diagnostic=null;
    try {
      signal.throwIfAborted();
      const framed=isData&&request.headers['content-type']==='application/vnd.deft.app-data-frame.v1';
      const maximum=framed?FILE_BYTES+FILE_FRAME_HEADER_BYTES+4:isData?DATA_JSON_BYTES:isIntegrationTool?614400:MAX_HTTP_BYTES;
      if ((!framed&&!/^application\/json(?:\s*;|$)/iu.test(request.headers['content-type'] ?? '')) || Number(request.headers['content-length']) > maximum) fail('EMAIL_RUNTIME_INPUT_INVALID');
      const chunks = []; let size = 0;
      for await (const chunk of request) { signal.throwIfAborted(); size += chunk.length; if (size > maximum) fail('EMAIL_RUNTIME_INPUT_INVALID'); chunks.push(chunk); }
      let input,bytes;const body=Buffer.concat(chunks);try{if(framed){const frame=decodeFileFrame(body);input=frame.header;bytes=frame.bytes;if(input.operation!=='file_upload')fail('EMAIL_DATA_INPUT_INVALID');}else input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}catch{fail('EMAIL_RUNTIME_INPUT_INVALID');}
      signal.throwIfAborted();if(Date.now()>=bodyDeadline){armDeadline(bodyDeadline);signal.throwIfAborted();}
      if(request.url==='/v1/connections'&&[REATTACH_VERSION,REATTACH_V2_VERSION].includes(input?.schema_version)){
        const retained=validateReattachRequest(input);
        // Keep body reads and every other operation at30seconds. Only an
        // authenticated, validated custody phase uses its bounded live deadline.
        const phaseDeadline=reattachPhaseDeadline(retained,Date.now());
        armDeadline(phaseDeadline);signal.throwIfAborted();
        // Node's idle socket timer is independent of the operation AbortSignal.
        // Extend only this authenticated, validated response, with1second to
        // flush an error. Absolute phase/permission timers still abort work.
        // Node restores server.timeout on keep-alive socket reuse.
        response.setTimeout(Math.max(1,phaseDeadline-Date.now())+1000);
        diagnostic={session_id:retained.session_id,operation:'reattach_'+retained.operation};
      }
      // Diagnostics contain only authenticated, schema-validated request pins.
      const parsed=isData&&input.schema_version==='deft.app_data_runtime.v1'?AppDataRuntimeRequestSchema.safeParse(input):isIntegrationTool?AppIntegrationToolRuntimeRequestSchema.safeParse(input):null;
      if(parsed?.success&&(!isIntegrationTool||parsed.data.tool_key==='email_recipient_suggestions'&&parsed.data.tool_operation==='read'))diagnostic={request_id:parsed.data.request_id,operation:isIntegrationTool?'email_recipient_suggestions':parsed.data.operation};
      let result;try{result=await (isIntegrationTool?integration_tool_runtime:isInspection?run_inspection_runtime:isLocalJob?local_job_runtime:isData?data_runtime:runtime).request(input,signal,bytes);}finally{if(framed)body.fill(0);}
      if(result.bytes){const {bytes,...metadata}=result;try{const frame=encodeFileFrame(metadata,bytes);response.writeHead(200,{'content-type':'application/vnd.deft.app-data-frame.v1','cache-control':'no-store','x-content-type-options':'nosniff'});response.end(frame);}finally{bytes.fill(0);}return;}
      if (Buffer.byteLength(JSON.stringify(result)) > (isData?APP_DATA_LIMITS.result_json_bytes:isIntegrationTool?524288:MAX_HTTP_BYTES)) fail('EMAIL_RUNTIME_TRANSPORT_LIMIT');
      send(result);
    } catch (error) {
      // Never log arbitrary provider responses, OAuth codes, state, client secrets, tokens or authorization URLs.
      const safe = new Set(['EMAIL_RUNTIME_INPUT_INVALID', 'EMAIL_RUNTIME_AUTHORITY_DENIED', 'EMAIL_RUNTIME_SESSION_DENIED', 'EMAIL_RUNTIME_ACCOUNT_DENIED', 'EMAIL_RUNTIME_CALLBACK_REPLAY', 'EMAIL_RUNTIME_CONFLICT', 'EMAIL_RUNTIME_CLIENT_REGISTRATION_CHANGED', 'EMAIL_RUNTIME_REGISTRATION_DENIED','EMAIL_DATA_INPUT_INVALID','EMAIL_DATA_AUTHORITY_DENIED','EMAIL_DATA_CONNECTION_DENIED','EMAIL_DATA_NOT_FOUND','EMAIL_DATA_CONFLICT','EMAIL_DRAFT_INVALID','EMAIL_DRAFT_CONFLICT','EMAIL_DRAFT_NOT_FOUND','EMAIL_DRAFT_FILE_DENIED','EMAIL_DRAFT_FILE_REFERENCED','EMAIL_DRAFT_FILE_INVALID','EMAIL_DRAFT_LIMIT']);
      safe.add('EMAIL_RUNTIME_CONSENT_CONTINUATION_DENIED');safe.add('EMAIL_NATIVE_SEND_PROVIDER_SIZE_UNSUPPORTED');safe.add('EMAIL_RUNTIME_UPGRADE_DENIED');safe.add('EMAIL_RUNTIME_CREDENTIAL_REPAIR_DENIED');safe.add('EMAIL_RUNTIME_CREDENTIAL_REPAIR_RESERVED');safe.add('EMAIL_RUNTIME_ACTION_DENIED');safe.add('EMAIL_RUNTIME_ACTION_UNSUPPORTED');safe.add('EMAIL_RUNTIME_REATTACH_DENIED');safe.add('EMAIL_RUNTIME_REATTACH_EFFECT_PENDING');
      for(const value of ['EMAIL_RECORD_CHANGE_INVALID','EMAIL_RECORD_CHANGE_PREPARED_DENIED','EMAIL_RECORD_CHANGE_MARKER_CHANGED','EMAIL_SETTINGS_IDENTITY_DENIED'])safe.add(value);
      for(const value of ['EMAIL_LOCAL_JOB_INVALID','EMAIL_LOCAL_JOB_CONNECTION_DENIED','EMAIL_LOCAL_JOB_CUSTODY_DENIED','EMAIL_LOCAL_JOB_SCOPE_DENIED','EMAIL_LOCAL_JOB_SOURCE_DENIED','EMAIL_LOCAL_JOB_TIME_INVALID','EMAIL_LOCAL_JOB_TIME_GAP','EMAIL_LOCAL_JOB_TIME_AMBIGUOUS','EMAIL_LOCAL_JOB_TIME_PAST','EMAIL_LOCAL_JOB_CONFLICT','EMAIL_LOCAL_JOB_UUID_CONSUMED','EMAIL_LOCAL_JOB_EXPIRED','EMAIL_LOCAL_JOB_AUTHORITY_DENIED','EMAIL_LOCAL_JOB_LIMIT','EMAIL_LOCAL_JOB_VISIBILITY_OVERFLOW'])safe.add(value);
      for(const value of ['EMAIL_INTEGRATION_TOOL_INVALID','EMAIL_INTEGRATION_TOOL_EXPIRED','EMAIL_INTEGRATION_TOOL_AUTHORITY_DENIED','EMAIL_INTEGRATION_CURSOR_INVALID'])safe.add(value);
      for(const value of ['EMAIL_NATIVE_HISTORY_DENIED','EMAIL_NATIVE_PROVIDER_RECONNECT_REQUIRED','EMAIL_RECIPIENT_INPUT_INVALID','EMAIL_RECIPIENT_AUTHORITY_DENIED','EMAIL_DATA_SOURCE_CHANGED'])safe.add(value);
      const diagnosticCodes=new Set(['EMAIL_NATIVE_HISTORY_DENIED','EMAIL_NATIVE_PROVIDER_RECONNECT_REQUIRED','EMAIL_RECIPIENT_INPUT_INVALID','EMAIL_RECIPIENT_AUTHORITY_DENIED','EMAIL_DATA_AUTHORITY_DENIED','EMAIL_DATA_CONNECTION_DENIED','EMAIL_DATA_SOURCE_CHANGED','EMAIL_INTEGRATION_TOOL_AUTHORITY_DENIED','EMAIL_INTEGRATION_TOOL_EXPIRED']);
      if(diagnostic&&diagnosticCodes.has(error?.code)){try{onDenial({event:'email_runtime_denied',...diagnostic,code:error.code});}catch{}}
      const code = safe.has(error?.code) ? error.code : 'EMAIL_RUNTIME_UNAVAILABLE';
      const status=code==='EMAIL_RUNTIME_INPUT_INVALID'?400:code==='EMAIL_RUNTIME_UNAVAILABLE'?503:403;
      // Internal failure codes are a closed list, never an arbitrary provider string.
      const failureCodes=new Set(['EMAIL_RUNTIME_TRANSPORT_DENIED','EMAIL_RUNTIME_TRANSPORT_LIMIT','EMAIL_DATA_OPERATION_UNAVAILABLE','EMAIL_DATA_RESULT_INVALID','EMAIL_OAUTH_AUTHORITY_DENIED','EMAIL_CONNECTION_AUTHORITY_DENIED','EMAIL_OAUTH_ACCOUNT_BINDING_DENIED','EMAIL_OAUTH_CUSTODY_BINDING_DENIED','EMAIL_OAUTH_CUSTODY_INVALID','EMAIL_OAUTH_CUSTODY_UNAVAILABLE','EMAIL_OAUTH_FILE_STORE_LOCK_BUSY','EMAIL_OAUTH_FILE_STORE_STALE_LOCK','EMAIL_OAUTH_FILE_STORE_FENCE_LOST','EMAIL_OAUTH_FILE_STORE_UNAVAILABLE','EMAIL_OAUTH_REAUTH_REQUIRED','EMAIL_OAUTH_PROVIDER_UNAVAILABLE','EMAIL_OAUTH_PROVIDER_REQUEST_FAILED','EMAIL_OAUTH_PROVIDER_RESPONSE_INVALID','EMAIL_OAUTH_PROVIDER_RESPONSE_LIMIT','EMAIL_PROVIDER_NETWORK_UNAVAILABLE','EMAIL_PROVIDER_PERMISSION_DENIED','EMAIL_PROVIDER_RATE_LIMITED','EMAIL_PROVIDER_REAUTH_REQUIRED','EMAIL_PROVIDER_REQUEST_FAILED','EMAIL_PROVIDER_RESPONSE_INVALID','EMAIL_PROVIDER_RESPONSE_LIMIT','EMAIL_PROVIDER_SCAN_DEADLINE','EMAIL_RUNTIME_STORE_CLOSED','EMAIL_RUNTIME_STORE_KEY_UNAVAILABLE','EMAIL_RUNTIME_STORE_LIMIT','EMAIL_RUNTIME_STORE_ROW_INVALID','EMAIL_RUNTIME_WRITER_FENCE_LOST']);
      if(diagnostic&&status===503){const failureCode=failureCodes.has(error?.code)?error.code:error?.name==='TimeoutError'?'EMAIL_RUNTIME_TIMEOUT':error?.name==='AbortError'?'EMAIL_RUNTIME_ABORTED':'EMAIL_RUNTIME_UNAVAILABLE';try{onFailure({event:'email_runtime_http_failure',...diagnostic,status,code:failureCode});}catch{}}
      if (!response.destroyed && !response.writableEnded) send({error: code}, status);
    } finally {clearTimeout(phaseTimer);signal.removeEventListener('abort',cancelBody);request.off('aborted', aborted); request.off('close', requestClosed); response.off('close', responseClosed);}
  };
}

