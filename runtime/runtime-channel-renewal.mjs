import {setTimeout as delay} from 'node:timers/promises';
import {exact,fail,isoTime} from './contract.mjs';

const LEASE_MARGIN_MS=90000,CLAIM_LIFETIME_MS=30000,MAX_TECHNICAL_LEASE_MS=900000;
/** Static credentials stay immutable. Only an explicitly delegated technical
 * deadline changes; existing Run/attempt methods are never retried here. */
export function createRuntimeChannelRenewal({channel,runtime_client,now=Date.now,wait=delay,onDiagnostic=event=>console.info(JSON.stringify(event))}){
 exact(channel,['channel_url','credential','registration',...(Object.hasOwn(channel,'technical_renewal')?['technical_renewal']:[])]);
 exact(channel.credential,['session_id','session_token']);
 if(!Object.hasOwn(channel,'technical_renewal'))return {client:runtime_client,renewable:false};
 const metadata=channel.technical_renewal,persistent=metadata.renewal_lifetime==='until_revoked';
 exact(metadata,['expires_at','renewable_until',...(Object.hasOwn(metadata,'renewal_lifetime')?['renewal_lifetime']:[])]);
 if(!isoTime(metadata.expires_at)||(persistent?metadata.renewable_until!==null:Object.hasOwn(metadata,'renewal_lifetime')||!isoTime(metadata.renewable_until))||Date.parse(metadata.expires_at)>(persistent?Infinity:Date.parse(metadata.renewable_until))||persistent&&Date.parse(metadata.expires_at)>now()+MAX_TECHNICAL_LEASE_MS||typeof runtime_client.renew!=='function')fail('EMAIL_RUNTIME_RENEWAL_CONFIG_INVALID');
 const session_id=channel.credential.session_id,ceiling=metadata.renewable_until;
 const ceilingDeadline=persistent?Infinity:Date.parse(ceiling);
 const stopped=new AbortController();
 let expires_at=metadata.expires_at,pending=null,closed=false,denied=false,unverified=Date.parse(metadata.expires_at)<=now();
 let state=unverified?'reconciling':'live';
 const startupDeadline=Math.min(ceilingDeadline,now()+LEASE_MARGIN_MS);
 const diagnostic=(phase,reason,attempt=0)=>{try{onDiagnostic?.({event:'email_runtime_channel_renewal',phase,reason,attempt,...(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(session_id)?{session_id}:{}),remaining_ms:Math.max(0,Math.min(MAX_TECHNICAL_LEASE_MS,Date.parse(expires_at)-now()))});}catch{}};
 const valid=()=>!closed&&!denied&&state!=='expired'&&!unverified&&Date.parse(expires_at)>now();
 const reconcilable=()=>!closed&&!denied&&state!=='expired'&&unverified&&startupDeadline>now();
 const terminal=()=>closed||denied||!(unverified?reconcilable():valid());
 const expired=()=>{state='expired';diagnostic('expired','expired');return false;};
 const rateLimited=error=>['AppRuntimeClientError','ResourceSyncClientError'].includes(error?.name)&&error.status===429;
 const transport=error=>rateLimited(error)||error?.name==='ResourceSyncClientError'&&error.status===0&&error.code==='APP_RESOURCE_SYNC_TIMEOUT'||error?.status>=500&&error?.status<=599||['TimeoutError','AbortError'].includes(error?.name)||error?.name==='TypeError'&&/fetch failed|network|failed to fetch/iu.test(error.message??'');
 async function renew(signal){
  signal=AbortSignal.any([signal,stopped.signal]);signal.throwIfAborted();if(closed||denied)return false;if(!(unverified?reconcilable():valid()))return expired();if(pending)return pending;
  const startup=unverified;state=startup?'reconciling':'renewing';
  const expected=expires_at;
  pending=(async()=>{
   for(let attempt=0;attempt<3;attempt++){
    signal.throwIfAborted();if(!(startup?reconcilable():valid()))return expired();
    let deadline;
    try{
     diagnostic(startup?'startup':'renew','started',attempt+1);
     deadline=AbortSignal.timeout(Math.max(1,Math.min(15000,(startup?startupDeadline:Date.parse(expires_at))-now())));
     const reply=await runtime_client.renew({expected_expires_at:expected},AbortSignal.any([signal,deadline]));
     signal.throwIfAborted();
     // Even a valid lost-ACK response cannot resurrect an elapsed local lease.
     if(!(startup?reconcilable():valid()))return expired();
     exact(reply,['session_id','expires_at','renewable_until',...(persistent?['renewal_lifetime']:[])]);
     if(reply.session_id!==session_id||reply.renewable_until!==ceiling||persistent&&reply.renewal_lifetime!=='until_revoked'||!isoTime(reply.expires_at)||Date.parse(reply.expires_at)<Date.parse(expected)||Date.parse(reply.expires_at)>ceilingDeadline||Date.parse(reply.expires_at)<=now()||persistent&&Date.parse(reply.expires_at)>now()+MAX_TECHNICAL_LEASE_MS)fail('EMAIL_RUNTIME_RENEWAL_REPLY_DENIED');
     expires_at=reply.expires_at;unverified=false;state='live';diagnostic('live','acknowledged',attempt+1);return true;
    }catch(error){
     if(signal.aborted){state=stopped.signal.aborted?'closed':'unavailable';diagnostic('stopped','cancelled',attempt+1);throw error;}
     const reason=deadline?.aborted?'operation_deadline':rateLimited(error)?'rate_limited':error?.name==='ResourceSyncClientError'&&error.status===0&&error.code==='APP_RESOURCE_SYNC_TIMEOUT'?'sdk_timeout':error?.status>=500&&error.status<=599?'http_unavailable':transport(error)?'transport_unavailable':error?.status===401||error?.status===403?'authority_denied':error?.code==='EMAIL_RUNTIME_RENEWAL_REPLY_DENIED'?'invalid_reply':'unclassified';
     if(!(startup?reconcilable():valid()))return expired();
     if(!transport(error)){denied=true;state='denied';diagnostic('denied',reason,attempt+1);return false;}
     state='unavailable';
     if(attempt===2){diagnostic('unavailable',reason,attempt+1);return false;}
     diagnostic('retry',reason,attempt+1);
     await wait(Math.min(1000,Math.max(1,(startup?startupDeadline:Date.parse(expires_at))-now())),undefined,{signal});
    }
   }
   return false;
  })().finally(()=>{pending=null;});
  return pending;
 }
 const client=Object.freeze({...runtime_client,claim:async(...args)=>state==='live'&&valid()&&Date.parse(expires_at)-now()>=CLAIM_LIFETIME_MS?runtime_client.claim(...args):null});
 return {client,renewable:true,renew:signal=>renew(signal),get expires_at(){return expires_at;},get state(){return closed?'closed':denied?'denied':terminal()?'expired':state;},
  async run(signal){signal=AbortSignal.any([signal,stopped.signal]);let backoff=5000;try{while(!signal.aborted&&!terminal()){
   if(state==='live'&&Date.parse(expires_at)===ceilingDeadline)return;
   const waitMs=state==='live'?Math.max(0,Date.parse(expires_at)-now()-LEASE_MARGIN_MS):0;
   if(waitMs)await wait(waitMs,undefined,{signal});
   if(!await renew(signal)){
    if(terminal())break;
    await wait(Math.min(backoff,Math.max(1,(unverified?startupDeadline:Date.parse(expires_at))-now())),undefined,{signal});
    backoff=Math.min(30000,backoff*2);continue;
   }
   backoff=5000;
   // Idempotent stale-expected ACKs can retain the same expiry; avoid hot polls.
   await wait(1000,undefined,{signal});
  }if(!signal.aborted&&!closed&&!denied&&terminal())expired();}catch(error){if(!signal.aborted){denied=true;state='denied';diagnostic('denied','unclassified');}}finally{if(signal.aborted){closed=true;state='closed';diagnostic('closed','cancelled');}}},
  close(){closed=true;state='closed';stopped.abort();diagnostic('closed','cancelled');}
 };
}
