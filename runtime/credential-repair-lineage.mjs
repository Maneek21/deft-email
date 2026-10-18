import {canonical,fail} from './contract.mjs';
import {lineageKey,continuityPins,validateLineage} from './account-lineage.mjs';
import {repairPins,repairReceiptDigest,repairClosureDigest} from './credential-repair-contract.mjs';
import {sealPurposeSet} from './purpose-set.mjs';
export async function commitCredentialRepairLineage({store,request,source,new_session,receipt_digest,review,check}){
 await check();if(receipt_digest!==repairReceiptDigest(request,review,new_session.runtime_session_ref)||canonical(source.binding)!==canonical(new_session.binding))fail('EMAIL_RUNTIME_CREDENTIAL_REPAIR_DENIED');
 return store.withLock({key:lineageKey(source.binding)},async tx=>{
  const row=await tx.read(),prior=row?.value;
  if(prior?.current.session_id===new_session.session_id){validateLineage(prior,new_session);if(prior.current.receipt_digest!==receipt_digest)fail('EMAIL_RUNTIME_CREDENTIAL_REPAIR_DENIED');return;}
  if(prior)validateLineage(prior,source);
  const initial=prior??{schema_version:'email.runtime.account_lineage.v1',pins:continuityPins(source),transport_digest:request.transport_digest,epochs:[source.binding.authority_epoch],receipts:[],base:{session_id:source.session_id,binding:source.binding,custody_generation:review.custody_generation},current:{session_id:source.session_id,binding:source.binding,custody_generation:review.custody_generation}};
  if(initial.transport_digest!==request.transport_digest||initial.current.custody_generation!==review.custody_generation)fail('EMAIL_RUNTIME_CREDENTIAL_REPAIR_DENIED');
  const receipt={kind:'credential_repair',session_id:new_session.session_id,source_session_id:source.session_id,review_digest:review.digest,receipt_digest,authority_epoch:source.binding.authority_epoch,custody_generation:review.custody_generation+1,pins:repairPins(request),review,runtime_session_ref:new_session.runtime_session_ref,prior_binding:source.binding,current_binding:source.binding,purpose_set:new_session.purpose_set};
  const next={...initial,schema_version:'email.runtime.account_lineage.v4',pins:continuityPins(new_session),receipts:[...initial.receipts,receipt],pending:null,current:{session_id:new_session.session_id,binding:source.binding,custody_generation:review.custody_generation+1,receipt_digest}};validateLineage(next,new_session);
  await check();if(!await tx.compareAndSwap({expected_revision:row?.revision??null,value:next}))fail('EMAIL_RUNTIME_CONFLICT');await check();
 });
}
/** Source session lock is already held by the repair Runtime. */
export async function commitCredentialRepairClosureLineage({store,request,source,review,closure,check,sourceTx}){
 await check();if(closure.custody_generation!==review.custody_generation+1||closure.receipt_digest!==repairClosureDigest(request,review,closure.reason,closure.custody_generation))fail('EMAIL_RUNTIME_CREDENTIAL_REPAIR_DENIED');
 return store.withLock({key:lineageKey(source.binding)},async tx=>{
  const row=await tx.read(),prior=row?.value;
  const old=prior?.closed_repairs?.find(r=>r.session_id===request.session_id);
  const receipt={kind:'credential_repair_closure',session_id:request.session_id,pins:repairPins(request),review,closure};
  if(old){if(canonical(old)!==canonical(receipt))fail('EMAIL_RUNTIME_CREDENTIAL_REPAIR_DENIED');validateLineage(prior,source);}else{
  if(prior)validateLineage(prior,source);
  const initial=prior??{pins:continuityPins(source),transport_digest:request.transport_digest,epochs:[source.binding.authority_epoch],receipts:[],base:{session_id:source.session_id,binding:source.binding,custody_generation:review.custody_generation},current:{session_id:source.session_id,binding:source.binding,custody_generation:review.custody_generation}};
  if(initial.transport_digest!==request.transport_digest||initial.current.custody_generation!==review.custody_generation)fail('EMAIL_RUNTIME_CREDENTIAL_REPAIR_DENIED');
  const next={...initial,schema_version:'email.runtime.account_lineage.v4',closed_repairs:[...(initial.closed_repairs??[]),receipt],pending:null,current:{...initial.current,custody_generation:closure.custody_generation,receipt_digest:closure.receipt_digest}};validateLineage(next,source);
  await check();if(!await tx.compareAndSwap({expected_revision:row?.revision??null,value:next}))fail('EMAIL_RUNTIME_CONFLICT');
  }
  if(!sourceTx)fail('EMAIL_RUNTIME_REPAIR_CLOSURE_PORT_REQUIRED');const sessionRow=await sourceTx.read(),session={...sessionRow.value,action_consents:request.action_consents,purpose_set:sealPurposeSet(source.binding,request.action_consents,closure.custody_generation)};delete session.action_consent;
  if(canonical(session)!==canonical(sessionRow.value)){await check();if(!await sourceTx.compareAndSwap({expected_revision:sessionRow.revision,value:session}))fail('EMAIL_RUNTIME_CONFLICT');}
 });
}
