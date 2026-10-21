import {setTimeout as delay} from 'node:timers/promises';
import {trustedUrl} from './http.mjs';
import {canonical,exact,fail} from './contract.mjs';

/** Reconcile only operator-configured registrations. The Host pushes secrets to
 * its reviewed endpoint; this request receives acknowledgements, never tokens.
 * No Run, Send, start or result operation is retried by this supervisor. */
export function createBackgroundAccessReconciler({registrations,getRegistrations=()=>registrations,authority_url,authority_token,fetch:fetchImpl=globalThis.fetch,
 needsReconcile,acknowledged,now=Date.now,random=Math.random,wait=delay,allow_loopback_fixture=false,
 onDiagnostic=event=>console.info(JSON.stringify(event))}){
 const base=new URL(trustedUrl(authority_url,allow_loopback_fixture));
 const url=new URL('/api/app-connection-sessions/runtime/background-access',base.origin).href;
 const states=new Map();
 const key=r=>canonical([r.org_id,r.runtime_registration_id]);
 const emit=(registration,phase,reason)=>{try{onDiagnostic({event:'email_runtime_background_access',runtime_registration_id:registration.runtime_registration_id,phase,reason});}catch{}};
 const reset=registration=>states.delete(key(registration));
 async function runOnce(signal){
  for(const {connection_protocol,...registration} of getRegistrations()){
   signal.throwIfAborted();
   if(!needsReconcile(registration)){reset(registration);continue;}
   const id=key(registration),prior=states.get(id);
   if(prior?.state==='reconnect_required'||prior?.next_retry_at>now())continue;
   try{
    const response=await fetchImpl(url,{method:'POST',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(35000)]),
     headers:{authorization:'Bearer '+authority_token,'content-type':'application/json',accept:'application/json'},body:JSON.stringify({registration})});
    if(!response.ok){await response.body?.cancel();throw Object.assign(Error('background_access_unavailable'),{status:response.status});}
    if(response.redirected||!/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type')??''))fail('EMAIL_RUNTIME_BACKGROUND_REPLY_INVALID');
    const reader=response.body?.getReader();if(!reader)fail('EMAIL_RUNTIME_BACKGROUND_REPLY_INVALID');
    let size=0;const chunks=[];
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>16384){await reader.cancel();fail('EMAIL_RUNTIME_BACKGROUND_REPLY_INVALID');}chunks.push(value);}}finally{reader.releaseLock();}
    const reply=JSON.parse(Buffer.concat(chunks).toString('utf8'));exact(reply,['installed','skipped']);
    if(!Array.isArray(reply.installed)||!reply.installed.length||reply.installed.length>16||!await acknowledged(registration,reply.installed))fail('EMAIL_RUNTIME_BACKGROUND_REPLY_INVALID');
    reset(registration);emit(registration,'live','installed');
   }catch(error){
    if(signal.aborted)throw error;
    // Lease denial alone is not a grant revocation. Only the independently
    // authenticated service fetch can declare owner intervention necessary.
    if([400,401,403,422].includes(error?.status)){
     states.set(id,{state:'reconnect_required'});emit(registration,'reconnect_required','authority_denied');
    }else{
     const attempt=Math.min(20,(prior?.attempt??0)+1),delayMs=Math.min(300000,1000*2**(attempt-1));
     states.set(id,{state:'unavailable',attempt,next_retry_at:now()+Math.ceil(delayMs*(0.5+random()*0.5))});
     emit(registration,'retry','transport_unavailable');
    }
   }
  }
 }
 return {reset,runOnce,state:registration=>states.get(key(registration))?.state??'live',async run(signal){
  try{while(!signal.aborted){await runOnce(signal);await wait(1000,undefined,{signal});}}catch(error){if(!signal.aborted)throw error;}
 }};
}
