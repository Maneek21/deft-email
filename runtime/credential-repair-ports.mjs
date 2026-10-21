import {canonical,digest,fail} from './contract.mjs';
import {lineageKey,validateLineage} from './account-lineage.mjs';
import {commitCredentialRepairLineage,commitCredentialRepairClosureLineage} from './credential-repair-lineage.mjs';
import {createRepairPublicationContinuity,repairPublicationDigest} from './credential-repair-continuity.mjs';
import {repairPins} from './credential-repair-contract.mjs';
import {parseResourceSyncStartForClaimV3} from '@deft/app-kit/core';
const same=(a,b)=>canonical(a)===canonical(b),deny=()=>fail('EMAIL_RUNTIME_CREDENTIAL_REPAIR_DENIED');
const proofKey=id=>'email.runtime.credential_repair_publication_proof.'+id;
const publicationKey=(scope,consumer)=>'email.data.sync_publication.'+digest([scope,digest(consumer)]);
/** These pins come only from authenticated historical attempts and encrypted
 * Runtime journals. No public caller supplies a consumer, cursor or descriptor. */
export function createCredentialRepairPorts({store,registration,assertCurrent}){
 const continuity=createRepairPublicationContinuity({store,assertRepairReceipt:async value=>{
  // The source-session lock is already held by the caller. Reading repair's
  // journal here would invert repair journal -> source; verify immutable
  // lineage receipts using the ordinary source -> lineage order instead.
  const lineage=(await store.withLock({key:lineageKeyFromReceipt(value)},tx=>tx.read()))?.value;
  const closed=value.receipt_kind==='closure'?lineage?.closed_repairs?.find(r=>r.session_id===value.repair_session_id&&r.closure.receipt_digest===value.repair_receipt_digest):null;
  const receipt=closed?{...closed,session_id:closed.pins.source.session_id,source_session_id:closed.pins.source.session_id,current_binding:value.binding,runtime_session_ref:closed.pins.source.runtime_session_ref,custody_generation:closed.closure.custody_generation}:lineage?.receipts?.find(r=>r.kind==='credential_repair'&&r.session_id===value.session_id&&r.session_id===value.repair_session_id&&r.receipt_digest===value.repair_receipt_digest);
  if(!receipt||!same(receipt.current_binding,value.binding)||!same(receipt.pins.scope,value.current_producer.scope)||receipt.source_session_id!==value.source_session_id||receipt.runtime_session_ref!==value.runtime_session_ref||receipt.custody_generation!==value.current_producer.custody_generation||receipt.pins.source.account_ref!==value.account_ref||receipt.review.fence.publication_continuity_digest!==value.publication_continuity_digest)deny();
  validateLineage(lineage,{scope:receipt.pins.scope,binding:receipt.current_binding,session_id:receipt.session_id,runtime_session_ref:receipt.runtime_session_ref,client_fingerprint:value.current_producer.client_fingerprint});
  verifyConsumedGaps(lineage,receipt,value.prior_producer.custody_generation);
 }});
 // Binding fields are sealed separately in the receipt. Do not infer a
 // provider or connection target from user-visible mailbox identifiers.
 function lineageKeyFromReceipt(value){return lineageKey(value.binding);}
 function verifyConsumedGaps(lineage,receipt,generation){
  while(generation<receipt.review.custody_generation){
   const closed=lineage.closed_repairs?.find(r=>r.review.custody_generation===generation);
   if(!closed||closed.pins.source.session_id!==receipt.source_session_id||!same(closed.pins.scope,receipt.pins.scope)||!same(closed.pins.action_consents,receipt.pins.action_consents)||closed.pins.transport_digest!==receipt.pins.transport_digest||closed.review.fence.identity_digest!==receipt.review.fence.identity_digest||closed.closure.custody_generation!==generation+1)deny();generation++;
  }
  if(generation!==receipt.review.custody_generation)deny();
 }
 async function inspectHistoricalAttempts({request,check}){
  const publications=[],missing=[];
  for(const attempt of request.historical_attempts){
   await check();const key='email.data.request.'+digest(['email.observation.v1',registration,attempt.run_id]);
   const row=await store.withLock({key},tx=>tx.read()),journal=row?.value,pins=journal?.pins;
   // Host authenticates each exact UNKNOWN attempt; absence is retained evidence,
   // never proof of no provider effect or permission to replay that attempt.
   if(!row){missing.push({...attempt,journal_key:key});continue;}
   if(!journal||journal.schema_version!=='email.app_observation_run.v1'||!['started','indeterminate'].includes(journal.state)||!pins?.claim||!pins.started||!pins.snapshot?.connection||pins.claim.run_id!==attempt.run_id||pins.claim.attempt_id!==attempt.attempt_id||!same(pins.snapshot.scope,request.scope)||pins.snapshot.connection.session_id!==request.source.session_id||pins.snapshot.connection.runtime_session_ref!==request.source.runtime_session_ref||pins.snapshot.connection.account_ref!==request.source.account_ref||pins.consent_digest!=='sha256:'+digest(pins.snapshot)||!Number.isSafeInteger(journal.custody_generation)||journal.custody_generation<1)deny();
   try{await parseResourceSyncStartForClaimV3(pins.claim,pins.started);}catch{deny();}
   const consumer={snapshot:pins.snapshot,consent_digest:pins.consent_digest,descriptor_digest:pins.claim.descriptor_digest,custody_generation:journal.custody_generation,client_fingerprint:null,max_items:pins.started.input.max_items};
   publications.push({consumer,journal_key:key,journal_revision:row.revision,journal_digest:'sha256:'+digest(journal)});
  }
  // An authenticated empty UNKNOWN list seals an empty proof, not synthetic history.
  await store.withLock({key:proofKey(request.session_id)},async tx=>{await check();const row=await tx.read(),value={pins:repairPins(request),publications,...(missing.length?{missing_journals:missing}:{})};if(row&&(!same(row.value.pins,value.pins)||!same(row.value.publications,publications)||!same(row.value.missing_journals??[],missing)))deny();if(!row&&!await tx.compareAndSwap({expected_revision:null,value}))deny();});return true;
 }
 async function inspectPublication({request,source,check}){
  return store.withLock({key:proofKey(request.session_id)},async tx=>{
   const row=await tx.read();if(!row||!same(row.value.pins,repairPins(request)))deny();const publications=[],absent=[];
   for(const item of row.value.publications){
    const consumer={...item.consumer,client_fingerprint:source.client_fingerprint},scope={org_id:request.scope.org_id,owner_user_id:request.scope.owner_user_id,account_id:request.source.account_ref},producer={scope:request.scope,session_id:source.session_id,runtime_session_ref:source.runtime_session_ref,custody_generation:consumer.custody_generation,client_fingerprint:source.client_fingerprint};
    await store.withLock({key:publicationKey(scope,consumer)},async ptx=>{await check();const published=await ptx.read();if(!published){absent.push({scope,consumer,producer});return;}if(!same(published.value.consumer,consumer)||!same(published.value.producer,producer)||published.value.result_digest!=='sha256:'+digest(published.value.result))deny();publications.push({scope,consumer,producer,publication_revision:published.revision,publication_digest:'sha256:'+digest(published.value)});});
   }
   const unique=[...new Map(publications.map(p=>[digest(p.consumer),p])).values()],publication_continuity_digest='sha256:'+digest(absent.length||row.value.missing_journals?.length?{publications:unique,absent_publications:absent,missing_journals:row.value.missing_journals??[]}:unique);
   const value={...row.value,sealed_publications:unique,...(absent.length?{absent_publications:absent}:{}),publication_continuity_digest};await check();if(!same(row.value,value)&&!await tx.compareAndSwap({expected_revision:row.revision,value}))deny();return publication_continuity_digest;
  });
 }
 async function commitAliases(input,closure){
  const {request,source,new_session,review,receipt_digest,check}=input,proof=(await store.withLock({key:proofKey(request.session_id)},tx=>tx.read()))?.value;
  if(!proof||proof.publication_continuity_digest!==review.fence.publication_continuity_digest)deny();
  for(const p of proof.absent_publications??[])await store.withLock({key:publicationKey(p.scope,p.consumer)},async tx=>{await check();if(await tx.read())deny();});
  if(!closure)await commitCredentialRepairLineage({...input,store});
  for(const p of proof.sealed_publications){
   const lineage=(await store.withLock({key:lineageKey(source.binding)},tx=>tx.read()))?.value;
   const receipt=closure?{pins:request,review,source_session_id:source.session_id}:lineage?.receipts.find(r=>r.session_id===new_session.session_id);if(!receipt)deny();verifyConsumedGaps(lineage,receipt,p.producer.custody_generation);
   const snapshot=structuredClone(p.consumer.snapshot);snapshot.connection={session_id:new_session.session_id,runtime_session_ref:new_session.runtime_session_ref,account_ref:request.source.account_ref,expected_custody_generation:review.custody_generation+1,receipt_digest};
   const pins={schema_version:'email.runtime.credential_repair_publication_receipt.v1',scope:p.scope,binding:source.binding,repair_session_id:request.session_id,receipt_kind:closure?'closure':'success',account_ref:request.source.account_ref,source_session_id:source.session_id,session_id:new_session.session_id,runtime_session_ref:new_session.runtime_session_ref,repair_receipt_digest:receipt_digest,publication_continuity_digest:proof.publication_continuity_digest,prior_consumer:p.consumer,current_consumer:{...p.consumer,snapshot,consent_digest:'sha256:'+digest(snapshot),custody_generation:review.custody_generation+1},prior_producer:p.producer,current_producer:{...p.producer,session_id:new_session.session_id,runtime_session_ref:new_session.runtime_session_ref,custody_generation:review.custody_generation+1}};
   await continuity.commit({...pins,receipt_digest:repairPublicationDigest(pins)},check);
  }
 }
 return {repairContinuity:continuity,inspectHistoricalAttempts,inspectPublication,commitRepair:input=>commitAliases(input,false),commitClosure:async input=>{await commitCredentialRepairClosureLineage({...input,store});await commitAliases({...input,new_session:input.source,receipt_digest:input.closure.receipt_digest},true);},assertHostAcknowledgement:async({request,check})=>{if(!request.acknowledged_receipt&&!request.acknowledged_closure)deny();await check();}};
}
