import {canonical,digest,exact,fail,validateScope,opaque,isoTime} from './contract.mjs';
import * as Kit from '@deft/app-kit';
import {capabilitiesFor} from './purpose-set.mjs';
export const REPAIR_VERSION='deft.app_connection_credential_repair_runtime.v1';
export const repairPins=request=>Object.fromEntries(['schema_version','session_id','scope','source','transport_digest','review_expires_at','action_consents','historical_attempts','publication_continuity_digest'].map(k=>[k,request[k]]));
export const repairReviewDigest=(request,eligibility)=>'sha256:'+digest({...repairPins(request),schema_version:'deft.app_connection_credential_repair_review_pin.v1',eligibility});
export const repairReceiptDigest=(request,review,runtime_session_ref)=>'sha256:'+digest({schema_version:'deft.app_connection_credential_repair_receipt.v1',session_id:request.session_id,scope:request.scope,source:request.source,transport_digest:request.transport_digest,review_digest:review.digest,account_ref:review.account.account_ref,old_custody_generation:review.custody_generation,custody_generation:review.custody_generation+1,runtime_session_ref,fence_digest:review.fence.fence_digest,publication_continuity_digest:review.fence.publication_continuity_digest});
export const repairClosureDigest=(request,review,reason,custody_generation)=>'sha256:'+digest({...repairPins(request),schema_version:'deft.app_connection_credential_repair_closure.v1',review_digest:review.digest,fence_digest:review.fence.fence_digest,reason,custody_generation});
export const repairIntentClosureDigest=(request,intent_fence,custody_generation)=>'sha256:'+digest({...repairPins(request),schema_version:'deft.app_connection_credential_repair_intent_closure.v1',intent_fence,reason:'intent_cancelled',custody_generation});
export function validateRepairRequest(raw){
 if(!Kit.AppConnectionCredentialRepairRuntimeRequestSchema?.safeParse(raw).success)fail('EMAIL_RUNTIME_INPUT_INVALID');
 capabilitiesFor(raw.action_consents);return structuredClone(raw);
}



