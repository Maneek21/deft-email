import {canonical,digest,fail} from './contract.mjs';
const key=scope=>'email.runtime.credential_repair_reservation.'+digest([scope.org_id,scope.installation_id,scope.resource_binding_id]);
const operationKey=scope=>'email.runtime.credential_provider_operation.'+digest([scope.org_id,scope.installation_id,scope.resource_binding_id]);
export async function withCredentialProviderOperation({store,scope,repair_session_id},work){
 return store.withLock({key:operationKey(scope)},async()=>{
  const row=await store.withLock({key:key(scope)},tx=>tx.read());
  if(row&&row.value.state!=='closed'&&(!repair_session_id||row.value.pins.session_id!==repair_session_id))fail('EMAIL_RUNTIME_CREDENTIAL_REPAIR_RESERVED');
  return work();
 });
}
// nativeEmailAccount is a local custody inspection: it never renews tokens or
// calls a provider, so saved reads do not wait for an active provider operation.
export function wrapCredentialProviderBridge({bridge,store,scope,repair_session_id}){
 return Object.freeze(Object.fromEntries(Object.entries(bridge).map(([name,value])=>[name,typeof value==='function'&&name!=='nativeEmailAccount'?async(...args)=>withCredentialProviderOperation({store,scope,repair_session_id},()=>value(...args)):value])));
}
export async function drainCredentialProviderOperations({store,request,check}){
 await withCredentialProviderOperation({store,scope:request.scope,repair_session_id:request.session_id},check);
}
export async function assertNoCredentialRepair({store,scope}){
 const row=await store.withLock({key:key(scope)},tx=>tx.read());
 if(row?.value?.state!=='closed'&&row)fail('EMAIL_RUNTIME_CREDENTIAL_REPAIR_RESERVED');
}
/** Closure requires the original reservation; it must never create or reopen one. */
export async function assertCredentialRepairReservation({store,request,check}){
 return store.withLock({key:key(request.scope)},async tx=>{await check();const row=await tx.read();
  const pins={schema_version:'email.runtime.credential_repair_reservation.v1',session_id:request.session_id,source:request.source,scope:request.scope,transport_digest:request.transport_digest,review_expires_at:request.review_expires_at};
  if(!row||row.value.state!=='reserved'||canonical(row.value.pins)!==canonical(pins))fail('EMAIL_RUNTIME_CREDENTIAL_REPAIR_RESERVED');
 });
}
/** Caller holds source-session lock, serializing session-held workers. Native
 * Send/mirror calls drain separately through the full-operation gate.
 * No expiry-based takeover: only exact authenticated closure opens admission. */
export async function reserveCredentialRepair({store,request,check}){
 return store.withLock({key:key(request.scope)},async tx=>{await check();const row=await tx.read();
  const pins={schema_version:'email.runtime.credential_repair_reservation.v1',session_id:request.session_id,source:request.source,scope:request.scope,transport_digest:request.transport_digest,review_expires_at:request.review_expires_at};
  if(row&&row.value.state!=='closed'){if(canonical(row.value.pins)!==canonical(pins))fail('EMAIL_RUNTIME_CREDENTIAL_REPAIR_RESERVED');return row.value;}
  const value={pins,state:'reserved'};if(!await tx.compareAndSwap({expected_revision:row?.revision??null,value}))fail('EMAIL_RUNTIME_CONFLICT');await check();return value;
 });
}
export async function closeCredentialRepairReservation({store,request,check,receipt_digest}){
 return store.withLock({key:key(request.scope)},async tx=>{await check();const row=await tx.read();if(!row||row.value.pins.session_id!==request.session_id||canonical(row.value.pins.source)!==canonical(request.source))fail('EMAIL_RUNTIME_CREDENTIAL_REPAIR_RESERVED');if(row.value.state==='closed'){if(row.value.receipt_digest!==receipt_digest)fail('EMAIL_RUNTIME_CREDENTIAL_REPAIR_RESERVED');return;}if(!await tx.compareAndSwap({expected_revision:row.revision,value:{...row.value,state:'closed',receipt_digest}}))fail('EMAIL_RUNTIME_CONFLICT');await check();});
}
