import {setTimeout as delay} from 'node:timers/promises';
import {exact,fail,isoTime} from './contract.mjs';

const LEASE_MARGIN_MS=90000,CLAIM_LIFETIME_MS=30000;
/** Static credentials stay immutable. Only an explicitly delegated technical
 * deadline changes; existing Run/attempt methods are never retried here. */
export function createRuntimeChannelRenewal({channel,runtime_client,now=Date.now,wait=delay}){
 exact(channel,['channel_url','credential','registration',...(Object.hasOwn(channel,'technical_renewal')?['technical_renewal']:[])]);
 exact(channel.credential,['session_id','session_token']);
 if(!Object.hasOwn(channel,'technical_renewal'))return {client:runtime_client,renewable:false};
 const metadata=channel.technical_renewal;exact(metadata,['expires_at','renewable_until']);
 if(!isoTime(metadata.expires_at)||!isoTime(metadata.renewable_until)||Date.parse(metadata.expires_at)>Date.parse(metadata.renewable_until)||typeof runtime_client.renew!=='function')fail('EMAIL_RUNTIME_RENEWAL_CONFIG_INVALID');
 const session_id=channel.credential.session_id,ceiling=metadata.renewable_until;
 const stopped=new AbortController();
 let expires_at=metadata.expires_at,pending=null,closed=false,denied=false,unverified=Date.parse(metadata.expires_at)<=now();
 const valid=()=>!closed&&!denied&&!unverified&&Date.parse(expires_at)>now();
 const reconcilable=()=>!closed&&!denied&&unverified&&Date.parse(ceiling)>now();
 const transport=error=>error?.status>=500&&error?.status<=599||['TimeoutError','AbortError'].includes(error?.name)||error?.name==='TypeError'&&/fetch failed|network|failed to fetch/iu.test(error.message??'');
 async function renew(signal,startup=false){
  signal=AbortSignal.any([signal,stopped.signal]);signal.throwIfAborted();if(!(startup?reconcilable():valid()))return false;if(pending)return pending;
  const expected=expires_at;
  pending=(async()=>{
   for(let attempt=0;attempt<(startup?1:3);attempt++){
    signal.throwIfAborted();if(!(startup?reconcilable():valid()))return false;
    try{
     const deadline=AbortSignal.timeout(Math.max(1,Math.min(15000,Date.parse(startup?ceiling:expires_at)-now())));
     const reply=await runtime_client.renew({expected_expires_at:expected},AbortSignal.any([signal,deadline]));
     signal.throwIfAborted();
     // Even a valid lost-ACK response cannot resurrect an elapsed local lease.
     if(!(startup?reconcilable():valid()))return false;
     exact(reply,['session_id','expires_at','renewable_until']);
     if(reply.session_id!==session_id||reply.renewable_until!==ceiling||!isoTime(reply.expires_at)||Date.parse(reply.expires_at)<Date.parse(expected)||Date.parse(reply.expires_at)>Date.parse(ceiling)||Date.parse(reply.expires_at)<=now())fail('EMAIL_RUNTIME_RENEWAL_REPLY_DENIED');
     expires_at=reply.expires_at;unverified=false;return true;
    }catch(error){
     if(signal.aborted)throw error;
     if(startup||!transport(error)||!valid()||attempt===2){denied=true;return false;}
     await wait(Math.min(1000,Math.max(1,Date.parse(expires_at)-now())),undefined,{signal});
    }
   }
   return false;
  })().finally(()=>{pending=null;});
  return pending;
 }
 const client=Object.freeze({...runtime_client,claim:async(...args)=>valid()&&Date.parse(expires_at)-now()>=CLAIM_LIFETIME_MS?runtime_client.claim(...args):null});
 return {client,renewable:true,renew:signal=>renew(signal),get expires_at(){return expires_at;},
  async run(signal){signal=AbortSignal.any([signal,stopped.signal]);try{if(unverified&&!await renew(signal,true))return;while(!signal.aborted&&valid()){
   if(Date.parse(expires_at)===Date.parse(ceiling))return;
   const waitMs=Math.max(0,Date.parse(expires_at)-now()-LEASE_MARGIN_MS);
   if(waitMs)await wait(waitMs,undefined,{signal});
   if(!await renew(signal))return;
   // Idempotent stale-expected ACKs can retain the same expiry; avoid hot polls.
   await wait(1000,undefined,{signal});
  }}catch(error){if(!signal.aborted)denied=true;}finally{if(signal.aborted)closed=true;}},
  close(){closed=true;stopped.abort();}
 };
}
