import {canonical,digest,fail} from './contract.mjs';
const key=scope=>'email.runtime.target.'+digest(scope);
/** One nominated connection per exact current admitted scope. This local
 * fence complements the host's current-scope competition lock; an unknown
 * activation cannot be replaced by starting OAuth under another session UUID. */
export async function reserveTarget({store,request,kind,check,now=Date.now}){
 await store.withLock({key:key(request.scope)},async tx=>{await check();const row=await tx.read(),prior=row?.value;
  if(prior?.session_id===request.session_id){if(canonical(prior.scope)!==canonical(request.scope)||prior.kind!==kind)fail('EMAIL_RUNTIME_REATTACH_DENIED');return;}
  if(prior&&prior.state!=='ended'&&!(prior.state==='prepared'&&prior.review_expires_at<=now()))fail('EMAIL_RUNTIME_REATTACH_DENIED');
  const value={scope:request.scope,session_id:request.session_id,kind,state:['reattach','upgrade','consent_continuation'].includes(kind)?'prepared':'reserved',review_expires_at:['reattach','upgrade','consent_continuation'].includes(kind)?Date.parse(request.review_expires_at):null};
  if(!await tx.compareAndSwap({expected_revision:row?.revision??null,value}))fail('EMAIL_RUNTIME_CONFLICT');await check();
 });
}
/** Explicit upgrade may reserve its already-connected source's exact current
 * target. No other Begin/session can acquire it after the reservation. */
export async function reserveUpgradeTarget({store,request,check,now=Date.now}){
 await store.withLock({key:key(request.scope)},async tx=>{await check();const row=await tx.read(),prior=row?.value;
  if(prior?.session_id===request.session_id){if(prior.kind!=='upgrade'||canonical(prior.scope)!==canonical(request.scope))fail('EMAIL_RUNTIME_UPGRADE_DENIED');return;}
  const sourceOwns=prior?.session_id===request.source.session_id&&canonical(prior.scope)===canonical(request.source.scope)&&['reserved','connected'].includes(prior.state);
  if(prior&&!sourceOwns&&prior.state!=='ended'&&!(prior.state==='prepared'&&prior.review_expires_at<=now()))fail('EMAIL_RUNTIME_UPGRADE_DENIED');
  const value={scope:request.scope,session_id:request.session_id,kind:'upgrade',state:'prepared',review_expires_at:Date.parse(request.review_expires_at)};
  if(!await tx.compareAndSwap({expected_revision:row?.revision??null,value}))fail('EMAIL_RUNTIME_CONFLICT');await check();
 });
}
export async function advanceTarget({store,request,from,to,check}){await store.withLock({key:key(request.scope)},async tx=>{await check();const row=await tx.read();if(!row||row.value.session_id!==request.session_id||canonical(row.value.scope)!==canonical(request.scope)||row.value.state!==from)fail('EMAIL_RUNTIME_REATTACH_DENIED');if(!await tx.compareAndSwap({expected_revision:row.revision,value:{...row.value,state:to}}))fail('EMAIL_RUNTIME_CONFLICT');await check();});}
export async function endTarget({store,request,check}){await store.withLock({key:key(request.scope)},async tx=>{await check();const row=await tx.read();if(!row)return;if(row.value.session_id!==request.session_id||canonical(row.value.scope)!==canonical(request.scope))fail('EMAIL_RUNTIME_REATTACH_DENIED');if(!await tx.compareAndSwap({expected_revision:row.revision,value:{...row.value,state:'ended'}}))fail('EMAIL_RUNTIME_CONFLICT');await check();});}

/** Prove this original request never reserved the target. A different expired
 * prepared reattachment can remain after an earlier abandoned review. Its row
 * is preserved; an own, live or possibly activated reservation is never proof.
 * Activation advances prepared -> activating before any custody mutation. */
export async function withUnreservedTarget({store,request,check,now=Date.now},work){return store.withLock({key:key(request.scope)},async tx=>{
 await check();const prior=(await tx.read())?.value;
 if(prior&&!(typeof prior.session_id==='string'&&prior.session_id!==request.session_id
  &&prior.kind==='reattach'&&prior.state==='prepared'&&canonical(prior.scope)===canonical(request.scope)
  &&Number.isSafeInteger(prior.review_expires_at)&&prior.review_expires_at>0&&prior.review_expires_at<=now()))fail('EMAIL_RUNTIME_REATTACH_DENIED');
 return work();
});}
