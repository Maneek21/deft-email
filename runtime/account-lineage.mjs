import {continuationReviewDigest,continuationReceiptDigest,validateContinuationRequest,CONTINUATION_VERSION} from './consent-continuation-contract.mjs';
import {repairReviewDigest,repairReceiptDigest,repairClosureDigest} from './credential-repair-contract.mjs';
import {resolveNativeOwnedSource} from './native-adoption-identity.mjs';
import {canonical,digest,fail} from './contract.mjs';
import {resolveProviderSource,providerSourceForParent} from './vendor/providers/provider-browser.mjs';
import {resourceUuid} from './mailbox-store.mjs';
import {reviewDigest,receiptDigest} from './reattach-contract.mjs';
import {upgradeReviewDigest,upgradeReceiptDigest,upgradeClosureDigest} from './upgrade-contract.mjs';
import {sealPurposeSet,credentialAnchor,capabilitiesFor} from './purpose-set.mjs';
export const lineageKey=binding=>'email.runtime.account_lineage.'+digest([binding.scope,binding.account_id,binding.provider,binding.connection_target]);
export const continuityPins=session=>({principal:session.binding.scope,account_id:session.binding.account_id,provider:session.binding.provider,target_key:session.scope.target_key,resource_key:session.scope.resource_key,operator_user_id:session.scope.operator_user_id,profile_digest:session.scope.profile_digest,client_fingerprint:session.client_fingerprint});
const lineageVersions=['email.runtime.account_lineage.v1','email.runtime.account_lineage.v2','email.runtime.account_lineage.v3','email.runtime.account_lineage.v4'];
const receiptVersions={oauth_upgrade:1,retained_reattach_v2:1,consent_continuation:2,credential_repair:3};
/** Old v2 writers could lower a v4 header while retaining its authenticated
 * receipts. Infer only known history; validateLineage still verifies the full
 * corresponding chain before returning. This never edits a persisted row. */
export function lineageVersion(lineage,minimum=lineageVersions[0]){
 let rank=lineageVersions.indexOf(lineage?.schema_version),required=0;const floor=lineageVersions.indexOf(minimum);
 if(rank<0||floor<0||!Array.isArray(lineage.receipts)||lineage.receipts.length>1024)fail('EMAIL_DATA_SOURCE_CHANGED');
 for(const receipt of lineage.receipts){if(!receipt||typeof receipt!=='object'||Array.isArray(receipt))fail('EMAIL_DATA_SOURCE_CHANGED');if(receipt.kind!==undefined){if(!Object.hasOwn(receiptVersions,receipt.kind))fail('EMAIL_DATA_SOURCE_CHANGED');required=Math.max(required,receiptVersions[receipt.kind]);}}
 const closures=Object.hasOwn(lineage,'closed_repairs')?lineage.closed_repairs:[];if(!Array.isArray(closures)||closures.length>1024||closures.some(receipt=>receipt?.kind!=='credential_repair_closure'))fail('EMAIL_DATA_SOURCE_CHANGED');
 if(closures.length)required=3;
 // The faulty writers emitted v2/v3, never a v1 header with newer receipts.
 if(rank===0&&required>0)fail('EMAIL_DATA_SOURCE_CHANGED');
 return lineageVersions[Math.max(rank,required,floor)];
}
// A Begin consumes a setup generation even if its callback never arrives.
// Expiry receipts bridge only those gaps; successful custody/epoch receipts
// keep their original ordering and contents.
function expiredGenerations(lineage){
 const expiredRows=lineage.expired_upgrades??[],closures=lineage.closed_repairs??[];if(!Array.isArray(expiredRows)||!Array.isArray(closures)||expiredRows.length+closures.length>1024)fail('EMAIL_DATA_SOURCE_CHANGED');const rows=[...expiredRows,...closures].sort((a,b)=>a.review?.custody_generation-b.review?.custody_generation);let used=0,lastReceipt=null;
 return {advance(session_id,generation,binding,expectedScope){
  while(used<rows.length&&rows[used].review?.custody_generation===generation){
   const row=rows[used++],pin=row.pins,review=row.review,closure=row.closure,{digest:review_digest,...eligibility}=review;
   const stable=s=>s.org_id===lineage.pins.principal.org_id&&s.owner_user_id===lineage.pins.principal.owner_id&&s.installation_id===lineage.pins.principal.installation_id&&s.target_key===lineage.pins.target_key&&s.resource_key===lineage.pins.resource_key&&s.operator_user_id===lineage.pins.operator_user_id;
   if(row.kind==='credential_repair_closure'){
    if(lineage.schema_version!=='email.runtime.account_lineage.v4'||row.session_id!==pin.session_id||pin.source.session_id!==session_id||pin.source.account_ref!==lineage.pins.account_id||review.account.account_ref!==lineage.pins.account_id||!stable(pin.scope)||canonical(pin.scope)!==canonical(pin.source.scope)||(!binding||pin.scope.resource_binding_id!==binding.resource_binding_id)||!expectedScope||canonical(pin.scope)!==canonical(expectedScope)||pin.transport_digest!==lineage.transport_digest||repairReviewDigest(pin,eligibility)!==review_digest||!['provider_denied','callback_expired','exchange_abandoned'].includes(closure.reason)||closure.custody_generation!==generation+1||closure.receipt_digest!==repairClosureDigest(pin,review,closure.reason,closure.custody_generation))fail('EMAIL_DATA_SOURCE_CHANGED');
    generation++;lastReceipt=closure.receipt_digest;continue;
   }
   if(row.session_id!==pin.session_id||pin.source.session_id!==session_id||pin.source.account_ref!==lineage.pins.account_id||review.account.account_ref!==lineage.pins.account_id
    ||!stable(pin.scope)||!stable(pin.source.scope)||pin.transport_digest!==lineage.transport_digest||upgradeReviewDigest(pin,eligibility)!==review_digest
    ||closure.reason!=='callback_expired'||closure.custody_generation!==generation+1||closure.receipt_digest!==upgradeClosureDigest(pin,review))fail('EMAIL_DATA_SOURCE_CHANGED');
   generation++;
  }return generation;
 },finish(){if(used!==rows.length)fail('EMAIL_DATA_SOURCE_CHANGED');},afterReceipt(){lastReceipt=null;},get lastReceipt(){return lastReceipt;}};
}
export function validateLineage(lineage,session){
 const version=lineageVersion(lineage);if(version!==lineage.schema_version)lineage={...lineage,schema_version:version};
 if(['email.runtime.account_lineage.v2','email.runtime.account_lineage.v3','email.runtime.account_lineage.v4'].includes(lineage?.schema_version))return validateUpgradeLineage(lineage,session);
 if(!lineage||lineage.schema_version!=='email.runtime.account_lineage.v1'||lineage.pending||canonical(lineage.pins)!==canonical(continuityPins(session))||canonical(lineage.current.binding)!==canonical(session.binding)||lineage.current.session_id!==session.session_id||!Array.isArray(lineage.epochs)||!lineage.epochs.length||lineage.epochs.length>1025||!Array.isArray(lineage.receipts)||lineage.receipts.length!==lineage.epochs.length-1||lineage.epochs.some((epoch,index)=>epoch!==lineage.base.binding.authority_epoch+index)||lineage.epochs.at(-1)!==session.binding.authority_epoch)fail('EMAIL_DATA_SOURCE_CHANGED');
 if(!lineage.receipts.length&&canonical(lineage.base.binding)!==canonical(session.binding))fail('EMAIL_DATA_SOURCE_CHANGED');
 let previous=lineage.base.session_id,generation=lineage.base.custody_generation;const expired=expiredGenerations(lineage);
 for(const [index,receipt] of lineage.receipts.entries()){generation=expired.advance(previous,generation);const {digest:review_digest,...eligibility}=receipt.review;const stable=s=>s.org_id===lineage.pins.principal.org_id&&s.owner_user_id===lineage.pins.principal.owner_id&&s.installation_id===lineage.pins.principal.installation_id&&s.target_key===lineage.pins.target_key&&s.resource_key===lineage.pins.resource_key&&s.operator_user_id===lineage.pins.operator_user_id;if(receipt.source_session_id!==previous||receipt.pins.source.session_id!==previous||receipt.pins.session_id!==receipt.session_id||receipt.pins.source.account_ref!==session.binding.account_id||receipt.review.account.account_ref!==session.binding.account_id||!stable(receipt.pins.scope)||!stable(receipt.pins.source.scope)||receipt.authority_epoch!==lineage.epochs[index+1]||receipt.review_digest!==review_digest||reviewDigest(receipt.pins,eligibility)!==review_digest||receiptDigest(receipt.pins,receipt.review,receipt.runtime_session_ref)!==receipt.receipt_digest||receipt.review.custody_generation!==generation||receipt.custody_generation!==generation+1||receipt.pins.transport_digest!==lineage.transport_digest)fail('EMAIL_DATA_SOURCE_CHANGED');previous=receipt.session_id;generation++;}
 generation=expired.advance(previous,generation);expired.finish();
 if(previous!==lineage.current.session_id||generation!==lineage.current.custody_generation||lineage.receipts.at(-1)?.receipt_digest!==lineage.current.receipt_digest||lineage.receipts.length>0&&(canonical(lineage.receipts.at(-1).pins.scope)!==canonical(session.scope)||lineage.receipts.at(-1).runtime_session_ref!==session.runtime_session_ref))fail('EMAIL_DATA_SOURCE_CHANGED');return lineage;
}
function validateUpgradeLineage(lineage,session){
 if(lineage.pending||canonical(lineage.pins)!==canonical(continuityPins(session))||canonical(lineage.current.binding)!==canonical(session.binding)||lineage.current.session_id!==session.session_id||!Array.isArray(lineage.epochs)||!lineage.epochs.length||lineage.epochs.length>1025||!Array.isArray(lineage.receipts)||lineage.receipts.filter(r=>!['consent_continuation','credential_repair'].includes(r.kind)).length!==lineage.epochs.length-1||lineage.receipts.length>1024||lineage.epochs.some((epoch,index)=>epoch!==lineage.base.binding.authority_epoch+index)||lineage.epochs.at(-1)!==session.binding.authority_epoch)fail('EMAIL_DATA_SOURCE_CHANGED');
 const stable=s=>s.org_id===lineage.pins.principal.org_id&&s.owner_user_id===lineage.pins.principal.owner_id&&s.installation_id===lineage.pins.principal.installation_id&&s.target_key===lineage.pins.target_key&&s.resource_key===lineage.pins.resource_key&&s.operator_user_id===lineage.pins.operator_user_id;
 let previous=lineage.base.session_id,generation=lineage.base.custody_generation,binding=lineage.base.binding,expectedScope=lineage.base.scope??lineage.receipts[0]?.pins.source.scope??session.scope;const expired=expiredGenerations(lineage);let epochIndex=0;
 for(const [index,receipt]of lineage.receipts.entries()){
  generation=expired.advance(previous,generation,binding,expectedScope);
  if(receipt.kind==='credential_repair'){
   const pin=receipt.pins,{digest:review_digest,...eligibility}=receipt.review;
   if(lineage.schema_version!=='email.runtime.account_lineage.v4'||receipt.source_session_id!==previous||pin.source.session_id!==previous||pin.session_id!==receipt.session_id||pin.source.account_ref!==session.binding.account_id||receipt.review.account.account_ref!==session.binding.account_id||!stable(pin.scope)||!stable(pin.source.scope)||canonical(pin.scope)!==canonical(pin.source.scope)||canonical(pin.scope)!==canonical(expectedScope)||pin.scope.resource_binding_id!==binding.resource_binding_id||receipt.authority_epoch!==binding.authority_epoch||receipt.review_digest!==review_digest||repairReviewDigest(pin,eligibility)!==review_digest||repairReceiptDigest(pin,receipt.review,receipt.runtime_session_ref)!==receipt.receipt_digest||receipt.review.custody_generation!==generation||receipt.custody_generation!==generation+1||pin.transport_digest!==lineage.transport_digest||canonical(receipt.prior_binding)!==canonical(binding)||canonical(receipt.current_binding)!==canonical(binding)||canonical(receipt.purpose_set)!==canonical(sealPurposeSet(binding,pin.action_consents,generation+1)))fail('EMAIL_DATA_SOURCE_CHANGED');
   previous=receipt.session_id;generation++;expectedScope=pin.scope;expired.afterReceipt();continue;
  }
  if(receipt.kind==='consent_continuation'){
   if(!['email.runtime.account_lineage.v3','email.runtime.account_lineage.v4'].includes(lineage.schema_version))fail('EMAIL_DATA_SOURCE_CHANGED');
   const pin=receipt.pins,{digest:review_digest,...eligibility}=receipt.review;
   validateContinuationRequest({schema_version:CONTINUATION_VERSION,operation:'activate',expires_at:pin.review_expires_at,...pin,review:receipt.review});
   if(receipt.source_session_id!==previous||pin.source.session_id!==previous||pin.session_id!==receipt.session_id||pin.source.account_ref!==session.binding.account_id||receipt.review.account.account_ref!==session.binding.account_id||!stable(pin.scope)||!stable(pin.source.scope)||pin.scope.resource_binding_id!==binding.resource_binding_id||receipt.authority_epoch!==binding.authority_epoch||receipt.review_digest!==review_digest||continuationReviewDigest(pin,eligibility)!==review_digest||continuationReceiptDigest(pin,receipt.review,receipt.runtime_session_ref)!==receipt.receipt_digest||receipt.review.custody_generation!==generation||receipt.custody_generation!==generation||pin.transport_digest!==lineage.transport_digest||canonical(receipt.prior_binding)!==canonical(binding)||canonical(receipt.current_binding)!==canonical(binding)||canonical(receipt.purpose_set)!==canonical(sealPurposeSet(binding,pin.action_consents,generation)))fail('EMAIL_DATA_SOURCE_CHANGED');
   previous=receipt.session_id;expectedScope=pin.scope;expired.afterReceipt();continue;
  }
  epochIndex++;
  const {digest:review_digest,...eligibility}=receipt.review,upgrade=receipt.kind==='oauth_upgrade',digestReview=upgrade?upgradeReviewDigest:reviewDigest,digestReceipt=upgrade?upgradeReceiptDigest:receiptDigest;
  if(receipt.source_session_id!==previous||receipt.pins.source.session_id!==previous||receipt.pins.session_id!==receipt.session_id||receipt.pins.source.account_ref!==session.binding.account_id||receipt.review.account.account_ref!==session.binding.account_id||!stable(receipt.pins.scope)||!stable(receipt.pins.source.scope)||receipt.authority_epoch!==lineage.epochs[epochIndex]||receipt.review_digest!==review_digest||digestReview(receipt.pins,eligibility)!==review_digest||digestReceipt(receipt.pins,receipt.review,receipt.runtime_session_ref)!==receipt.receipt_digest||receipt.review.custody_generation!==generation||receipt.custody_generation!==generation+1||receipt.pins.transport_digest!==lineage.transport_digest)fail('EMAIL_DATA_SOURCE_CHANGED');
  if(upgrade||receipt.kind==='retained_reattach_v2'){if(!upgrade&&(receipt.pins.schema_version!=='deft.app_connection_reattach_runtime.v2'||receipt.pins.scope.profile_digest!==receipt.pins.source.scope.profile_digest))fail('EMAIL_DATA_SOURCE_CHANGED');const next=receipt.current_binding,anchor=receipt.pins.action_consents.length?credentialAnchor(binding.account_id,binding.action_binding_id):binding.action_binding_id;if(canonical(receipt.prior_binding)!==canonical(binding)||canonical(next.scope)!==canonical(binding.scope)||next.account_id!==binding.account_id||next.provider!==binding.provider||next.connection_target!==binding.connection_target||next.resource_binding_id!==receipt.pins.scope.resource_binding_id||next.authority_epoch!==binding.authority_epoch+1||next.action_binding_id!==anchor||canonical(next.capabilities)!==canonical(capabilitiesFor(receipt.pins.action_consents))||canonical(receipt.purpose_set)!==canonical(sealPurposeSet(next,receipt.pins.action_consents,receipt.custody_generation)))fail('EMAIL_DATA_SOURCE_CHANGED');binding=next;}
  else{if(receipt.pins.scope.profile_digest!==receipt.pins.source.scope.profile_digest)fail('EMAIL_DATA_SOURCE_CHANGED');binding={...binding,resource_binding_id:receipt.pins.scope.resource_binding_id,action_binding_id:receipt.pins.action_consent?.action_binding_id??null,authority_epoch:receipt.authority_epoch,capabilities:['read','search','thread',...(receipt.pins.action_consent?['send']:[])]};}
  previous=receipt.session_id;generation++;expectedScope=receipt.pins.scope;expired.afterReceipt();
 }
 generation=expired.advance(previous,generation,binding,expectedScope);expired.finish();
 if(previous!==lineage.current.session_id||generation!==lineage.current.custody_generation||canonical(binding)!==canonical(session.binding)||(expired.lastReceipt??lineage.receipts.at(-1)?.receipt_digest)!==lineage.current.receipt_digest||lineage.receipts.length>0&&(canonical(lineage.receipts.at(-1).pins.scope)!==canonical(session.scope)||lineage.receipts.at(-1).runtime_session_ref!==session.runtime_session_ref))fail('EMAIL_DATA_SOURCE_CHANGED');return lineage;
}
/** Only runtime-owned cached rows reach this adapter. Browser envelopes remain
 * strict-current in the frozen bridge; old locator envelopes are never accepted. */
export function createOwnedSourceResolver({store,session,scope,check}){
 return async record=>{
  await check();const source=record?.provider_source;
  if(!source||canonical(record.scope)!==canonical(scope)||record.logical_message_id!==source.logical_message_id||record.record_id!==resourceUuid(scope,record.logical_message_id))fail('EMAIL_DATA_SOURCE_CHANGED');
  const adopted=await resolveNativeOwnedSource({store,scope,session,binding:session.binding,record,check});if(adopted)return adopted;
  if(source.authority_epoch!==session.binding.authority_epoch){
   const lineage=(await store.withLock({key:lineageKey(session.binding)},tx=>tx.read()))?.value;
   validateLineage(lineage,session);if(!lineage.epochs.includes(source.authority_epoch))fail('EMAIL_DATA_SOURCE_CHANGED');
  }
  // Frozen validation recomputes both logical and conversation identity from
  // the locator at its original generation before nominating current custody.
  const parent=resolveProviderSource({scope:session.binding.scope,account:{account_id:session.binding.account_id,provider:session.binding.provider,authority_epoch:source.authority_epoch},source});
  await check();return providerSourceForParent(session.binding,parent);
 };
}



