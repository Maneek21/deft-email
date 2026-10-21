import {createHash} from 'node:crypto';
import {AppPreparedEffectReceiptSchema,canonicalAppPreparedEffectJson,parseAppPreparedEffectDetails} from '@deft/app-kit/core';
import {canonical,fail} from './contract.mjs';

export const EMAIL_SENT_COPY_EFFECT=Object.freeze({key:'sent_copy',action_key:'send_message',version:'email.sent_copy.v1',details_schema:{type:'object',additionalProperties:false,
 properties:{mode:{type:'string',maxLength:32},message_id:{type:'string',maxLength:256},mailbox:{type:'string',maxLength:2048},uidvalidity:{type:'string',maxLength:30}},required:['mode','message_id','mailbox','uidvalidity']}});
const sha=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
/** Domain checks stay here; the Host verifies only the declared bounded effect and pins. */
export function validateEmailPreparedEffect(input){
 const effect=parseAppPreparedEffectDetails(EMAIL_SENT_COPY_EFFECT,input),d=effect.details;
 if(effect.plan_digest!==sha(canonicalAppPreparedEffectJson(effect))||!['server_managed','append_exact'].includes(d.mode)
  ||!/^<[^<>\s\u0000-\u001f\u007f]+>$/u.test(d.message_id)||d.mode==='server_managed'&&(d.mailbox!==''||d.uidvalidity!=='')
  ||d.mode==='append_exact'&&(!d.mailbox||/[\u0000-\u001f\u007f]/u.test(d.mailbox)||!/^[1-9]\d{0,29}$/u.test(d.uidvalidity)))fail('EMAIL_SMTP_PLAN_INVALID');
 return effect;
}
export function publicCopyEffect(copy){
 const effect={schema_version:'deft.app_prepared_effect.v1',effect_key:'sent_copy',version:EMAIL_SENT_COPY_EFFECT.version,account_ref:copy.account_ref,custody_generation:copy.custody_generation,
  action_binding_id:copy.action_binding_id,content_digest:copy.content_digest,content_bytes:copy.content_bytes,
  details:{mode:copy.mode,message_id:copy.message_id,mailbox:copy.destination?.mailbox??'',uidvalidity:copy.destination?.uidvalidity??''},plan_digest:'sha256:'+'0'.repeat(64)};
 effect.plan_digest=sha(canonicalAppPreparedEffectJson(effect));return validateEmailPreparedEffect(effect);
}
export function publicEffectReceipt(receipt,effect){
 if(receipt===null)return null;validateEmailPreparedEffect(effect);
 if(receipt.account_ref!==effect.account_ref||receipt.custody_generation!==effect.custody_generation||receipt.content_digest!==effect.content_digest)fail('EMAIL_SMTP_RECEIPT_INVALID');
 return AppPreparedEffectReceiptSchema.parse({schema_version:'deft.app_prepared_effect_receipt.v1',operation_id:receipt.operation_id,run_id:receipt.run_id,attempt_id:receipt.attempt_id,
  effect_key:effect.effect_key,version:effect.version,account_ref:effect.account_ref,custody_generation:effect.custody_generation,action_binding_id:effect.action_binding_id,
  snapshot_digest:receipt.snapshot_digest,plan_digest:effect.plan_digest,content_digest:effect.content_digest,primary_outcome:receipt.transport_outcome,
  effect_outcome:({server_managed:'provider_managed',copied:'completed'})[receipt.copy_outcome]??receipt.copy_outcome,automatic_retry:false});
}
export function assertEmailEffectCopy(effect,copy){if(canonical(validateEmailPreparedEffect(effect))!==canonical(publicCopyEffect(copy)))fail('EMAIL_SMTP_PLAN_INVALID');}
