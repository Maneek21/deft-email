import * as Kit from '@deft/app-kit';
import {consentFields,consentDeadline,canonical,digest,exact,fail,isoTime,opaque,validateScope} from './contract.mjs';
const id=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(v);
const hash=v=>typeof v==='string'&&/^sha256:[a-f0-9]{64}$/u.test(v);
const generation=v=>Number.isInteger(v)&&v>0&&v<=2147483646;
export const REATTACH_VERSION='deft.app_connection_reattach_runtime.v1',REATTACH_V2_VERSION='deft.app_connection_reattach_runtime.v2';
// Multi-purpose custody moves revalidate live Host authority at every durable
// boundary. This is a phase ceiling, never an extension of reviewed authority.
export const REATTACH_PHASE_MS=120000;
export const reattachPhaseDeadline=(request,now)=>Math.min(Date.parse(request.expires_at),consentDeadline(request.scope,'consent_expires_at'),request.operation==='status'?Infinity:Date.parse(request.review_expires_at),request.operation!=='status'&&request.action_consent?consentDeadline(request.action_consent):Infinity,...(request.operation==='status'?[]:(request.action_consents??[]).map(consent=>consentDeadline(consent))),now+REATTACH_PHASE_MS);
export function validateReattachRequest(raw){
 if(raw?.schema_version===REATTACH_V2_VERSION){if(!Kit.AppConnectionReattachV2RuntimeRequestSchema?.safeParse(raw).success)fail('EMAIL_RUNTIME_INPUT_INVALID');return structuredClone(raw);}
 const input=structuredClone(raw),extras={prepare:[],activate:['review'],status:['review']}[input?.operation];
 if(!extras)fail('EMAIL_RUNTIME_INPUT_INVALID');
 exact(input,['schema_version','session_id','scope','source','transport_digest','review_expires_at','expires_at','operation',...extras,...(Object.hasOwn(input,'action_consent')?['action_consent']:[])]);
 if(input.schema_version!==REATTACH_VERSION||!id(input.session_id)||!hash(input.transport_digest)||!isoTime(input.expires_at)||!isoTime(input.review_expires_at))fail('EMAIL_RUNTIME_INPUT_INVALID');
 validateScope(input.scope);exact(input.source,['session_id','session_revision','scope','runtime_session_ref','account_ref']);validateScope(input.source.scope);
 if(!id(input.source.session_id)||input.session_id===input.source.session_id||!generation(input.source.session_revision)||!opaque(input.source.runtime_session_ref)||!opaque(input.source.account_ref))fail('EMAIL_RUNTIME_INPUT_INVALID');
 if(Date.parse(input.expires_at)>consentDeadline(input.scope,'consent_expires_at')||input.operation!=='status'&&Date.parse(input.expires_at)>Date.parse(input.review_expires_at))fail('EMAIL_RUNTIME_INPUT_INVALID');
 if(input.review!==undefined&&input.review!==null){exact(input.review,['digest','account','custody_generation','custody_digest']);exact(input.review.account,['account_ref','label']);if(!hash(input.review.digest)||!hash(input.review.custody_digest)||!generation(input.review.custody_generation)||input.review.account.account_ref!==input.source.account_ref||typeof input.review.account.label!=='string'||!input.review.account.label.length||input.review.account.label.length>320||/[\u0000-\u001f\u007f]/u.test(input.review.account.label))fail('EMAIL_RUNTIME_INPUT_INVALID');}
 if(input.operation==='activate'&&!input.review)fail('EMAIL_RUNTIME_INPUT_INVALID');
 if(input.action_consent){const a=input.action_consent;exact(a,['action_binding_id','action_key','authority_epoch','consent_id','consent_digest','expires_at',...consentFields(a)]);if(!id(a.action_binding_id)||!id(a.consent_id)||a.action_key!=='send_message'||!Number.isInteger(a.authority_epoch)||a.authority_epoch<0||!hash(a.consent_digest)||consentDeadline(a)>consentDeadline(input.scope,'consent_expires_at'))fail('EMAIL_RUNTIME_INPUT_INVALID');}
 return input;
}
export const reattachPins=request=>Object.fromEntries(['schema_version','session_id','scope','source','transport_digest','review_expires_at',...(request.action_consents!==undefined?['action_consents']:request.action_consent?['action_consent']:[])].map(k=>[k,request[k]]));
export const reviewDigest=(request,eligibility)=>'sha256:'+digest({...reattachPins(request),schema_version:request.action_consents!==undefined?'deft.app_connection_reattach_review_pin.v2':'deft.app_connection_reattach_review_pin.v1',eligibility});
export const receiptDigest=(request,review,runtime_session_ref)=>'sha256:'+digest({schema_version:request.action_consents!==undefined?'deft.app_connection_reattach_receipt.v2':'deft.app_connection_reattach_receipt.v1',session_id:request.session_id,scope:request.scope,source:request.source,transport_digest:request.transport_digest,review_digest:review.digest,account_ref:review.account.account_ref,custody_generation:review.custody_generation+1,runtime_session_ref});
export function createReattachChecker({request,registration,assertCurrent,signal,now}){
 if(typeof assertCurrent!=='function')fail('EMAIL_RUNTIME_AUTHORITY_PORT_REQUIRED');
 let deadline=reattachPhaseDeadline(request,now());
 const expiry=new AbortController(),combined=AbortSignal.any([signal,expiry.signal].filter(Boolean));let timer;
 const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>expiry.abort(new Error('EMAIL_RUNTIME_AUTHORITY_EXPIRED')),Math.max(0,deadline-now()));timer.unref();};arm();
 return {signal:combined,dispose:()=>clearTimeout(timer),async check(){combined.throwIfAborted();if(deadline<=now()||Object.keys(registration).some(k=>registration[k]!==request.scope[k]))fail('EMAIL_RUNTIME_AUTHORITY_DENIED');const expected={...request,expires_at:new Date(deadline).toISOString()},response=await assertCurrent(expected,combined);exact(response,[...Object.keys(expected),'allowed']);const {expires_at,allowed,...pins}=response,{expires_at:ignored,...wanted}=expected;if(allowed!==true||canonical(pins)!==canonical(wanted)||!isoTime(expires_at)||Date.parse(expires_at)<=now()||Date.parse(expires_at)>deadline)fail('EMAIL_RUNTIME_AUTHORITY_DENIED');deadline=Date.parse(expires_at);arm();combined.throwIfAborted();}};
}
