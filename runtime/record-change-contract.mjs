import {canonical,digest,exact,fail,isoTime,opaque,validateScope} from './contract.mjs';
import {uuid} from './draft-store.mjs';
import {AppDataRecordSchema,AppPreparedRecordChangeSchema,AppRecordChangeParametersSchema} from '@deft/app-kit';
import {validateDraftContent} from './draft-store.mjs';
const hash=value=>typeof value==='string'&&/^sha256:[a-f0-9]{64}$/u.test(value);
const key=value=>typeof value==='string'&&/^[a-z][a-z0-9_]{0,47}$/u.test(value)&&!['constructor','prototype','__proto__'].includes(value);
const revision=value=>Number.isSafeInteger(value)&&value>=1&&value<=2147483646;
export const changeInputDigest=request=>'sha256:'+digest({operation:request.operation,input:request.input});
export const changeAuthorizationDigest=request=>'sha256:'+digest({scope:request.scope,connection:request.connection,record_authorities:request.record_authorities});
export const preparedChangeDigest=({prepared_digest,...value})=>'sha256:'+digest(value);
export function validateChangeResult(result,request){
 const base=['schema_version','request_id','operation','input_digest','outcome'];
 if(result.schema_version!=='deft.app_data_result.v1'||result.request_id!==request.request_id||result.operation!==request.operation||result.input_digest!==changeInputDigest(request)||!['completed','conflict','not_found','indeterminate'].includes(result.outcome)||Buffer.byteLength(JSON.stringify(result))>2*1024*1024)fail('EMAIL_DATA_RESULT_INVALID');
 if(result.outcome!=='completed'){exact(result,base);return result;}
 if(request.operation==='record_apply_change'){exact(result,[...base,'record']);if(!AppDataRecordSchema.safeParse(result.record).success)fail('EMAIL_DATA_RESULT_INVALID');return result;}
 exact(result,[...base,'prepared_change']);const plan=result.prepared_change;
 exact(plan,['schema_version','prepared_id','prepared_digest',...(Object.hasOwn(plan,'invocation_mode')?['invocation_mode']:[]),...(plan.schema_version==='deft.app_prepared_record_change.v2'?['parameters','parameter_fields']:[]),'operation_key','account_ref','destination','source','authorization_digest','value','preview','expires_at']);validateInvocation(plan);changeReference(plan.destination);changeReference(plan.source);exact(plan.preview,['title','description','warnings']);
 if(!AppPreparedRecordChangeSchema.safeParse(plan).success||plan.schema_version!==(Object.hasOwn(request.input,'parameters')?'deft.app_prepared_record_change.v2':'deft.app_prepared_record_change.v1')||plan.schema_version==='deft.app_prepared_record_change.v2'&&canonical(plan.parameters)!==canonical(request.input.parameters)||!uuid(plan.prepared_id)||plan.prepared_digest!==preparedChangeDigest(plan)||plan.authorization_digest!==changeAuthorizationDigest(request)||!opaque(plan.account_ref)||!key(plan.operation_key)||!isoTime(plan.expires_at)||typeof plan.preview.title!=='string'||!plan.preview.title.length||plan.preview.title.length>512||typeof plan.preview.description!=='string'||plan.preview.description.length>2048||!Array.isArray(plan.preview.warnings)||plan.preview.warnings.length>8||plan.preview.warnings.some(value=>typeof value!=='string'||!value.length||value.length>512)||Buffer.byteLength(canonical(plan.value))>491520||canonical(validateDraftContent(plan.value))!==canonical(plan.value))fail('EMAIL_DATA_RESULT_INVALID');return result;
}
export function validateChangeReceiptStatus(result){
 const status=result.request_status;if(!status||!['record_apply_change','record_prepare_change'].includes(status.operation))return false;
 exact(result,['schema_version','request_id','operation','input_digest','outcome','request_status']);exact(status,['request_id','operation','input_digest','state',...(['record_id','revision','content_digest'].filter(key=>Object.hasOwn(status,key)))]);
 if(result.schema_version!=='deft.app_data_result.v1'||result.operation!=='request_status'||result.outcome!=='completed'||!uuid(result.request_id)||!hash(result.input_digest)||!uuid(status.request_id)||!hash(status.input_digest)||!['completed','indeterminate'].includes(status.state)||Object.hasOwn(status,'record_id')&&(!uuid(status.record_id)||!Number.isSafeInteger(status.revision)||status.revision<1||!hash(status.content_digest))||['revision','content_digest'].some(key=>Object.hasOwn(status,key)!==Object.hasOwn(status,'record_id')))fail('EMAIL_DATA_RESULT_INVALID');return true;
}
export function changeReference(value){exact(value,['store_key','record_id','expected_revision','expected_content_digest']);if(!key(value.store_key)||!uuid(value.record_id)||!revision(value.expected_revision)||!hash(value.expected_content_digest))fail('EMAIL_DATA_INPUT_INVALID');return structuredClone(value);}
export function validateInvocation(value){if(Object.hasOwn(value,'parameters')&&(!AppRecordChangeParametersSchema.safeParse(value.parameters).success||value.invocation_mode!==undefined||!['template_append','template_replace'].includes(value.operation_key)))fail('EMAIL_TEMPLATE_PARAMETERS_INVALID');if(Object.hasOwn(value,'invocation_mode')&&(value.invocation_mode!=='initial'||value.operation_key!=='signature_default')||value.operation_key==='signature_default'&&value.invocation_mode!=='initial')fail('EMAIL_RECORD_CHANGE_INVALID');}
export function validateChangeRequest(raw){
 exact(raw,['schema_version','request_id','scope','connection','record_authorities','operation','expires_at','input']);
 if(raw.schema_version!=='deft.app_data_runtime.v2'||!uuid(raw.request_id)||!['record_prepare_change','record_apply_change'].includes(raw.operation)||!isoTime(raw.expires_at)||Buffer.byteLength(JSON.stringify(raw))>524288)fail('EMAIL_DATA_INPUT_INVALID');
 validateScope(raw.scope);exact(raw.connection,['session_id','session_revision','runtime_session_ref','account_ref']);
 if(!uuid(raw.connection.session_id)||!revision(raw.connection.session_revision)||!opaque(raw.connection.runtime_session_ref)||!opaque(raw.connection.account_ref))fail('EMAIL_DATA_INPUT_INVALID');
 const input=raw.input;exact(input,['store_key','record_id','expected_revision','expected_content_digest','operation_key','source',...(Object.hasOwn(input,'invocation_mode')?['invocation_mode']:[]),...(Object.hasOwn(input,'parameters')?['parameters']:[]),...(raw.operation==='record_apply_change'?['prepared_id','prepared_digest']:[])]);
 validateInvocation(input);changeReference({store_key:input.store_key,record_id:input.record_id,expected_revision:input.expected_revision,expected_content_digest:input.expected_content_digest});changeReference(input.source);
 if(!key(input.operation_key)||input.store_key===input.source.store_key||raw.operation==='record_apply_change'&&(!uuid(input.prepared_id)||!hash(input.prepared_digest)))fail('EMAIL_DATA_INPUT_INVALID');
 if(!Array.isArray(raw.record_authorities)||raw.record_authorities.length!==2)fail('EMAIL_DATA_INPUT_INVALID');
 raw.record_authorities.forEach((proof,index)=>{exact(proof,['role','store_key','consent_id','consent_digest','data_policy_digest','consent_expires_at']);if(proof.role!==['destination','source'][index]||proof.store_key!==[input.store_key,input.source.store_key][index]||!key(proof.store_key)||!uuid(proof.consent_id)||!hash(proof.consent_digest)||!hash(proof.data_policy_digest)||!isoTime(proof.consent_expires_at))fail('EMAIL_DATA_INPUT_INVALID');});
 if(Date.parse(raw.expires_at)>Math.min(Date.parse(raw.scope.consent_expires_at),...raw.record_authorities.map(proof=>Date.parse(proof.consent_expires_at))))fail('EMAIL_DATA_INPUT_INVALID');
 return structuredClone(raw);
}
export function createChangeChecker({request,assertCurrent,signal,now=Date.now}){
 let deadline=Math.min(Date.parse(request.expires_at),Date.parse(request.scope.consent_expires_at),...request.record_authorities.map(proof=>Date.parse(proof.consent_expires_at)),now()+30000);
 const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal].filter(Boolean));let timer;
 const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(new Error('EMAIL_DATA_AUTHORITY_EXPIRED')),Math.max(0,deadline-now()));timer.unref();};arm();
 const checkLocal=()=>{combined.throwIfAborted();if(deadline<=now())fail('EMAIL_DATA_AUTHORITY_DENIED');};
 const check=async()=>{checkLocal();const expected={schema_version:'deft.app_data_authority.v2',request_id:request.request_id,scope:request.scope,connection:request.connection,record_authorities:request.record_authorities,operation:request.operation,input_digest:changeInputDigest(request),expires_at:new Date(deadline).toISOString()},reply=await assertCurrent(expected,combined);exact(reply,[...Object.keys(expected),'allowed']);const {expires_at,allowed,...pins}=reply,{expires_at:ignored,...wanted}=expected;
  if(allowed!==true||canonical(pins)!==canonical(wanted)||!isoTime(expires_at)||Date.parse(expires_at)>deadline||Date.parse(expires_at)<=now())fail('EMAIL_DATA_AUTHORITY_DENIED');deadline=Math.min(deadline,Date.parse(expires_at));arm();checkLocal();};
 return {check,checkLocal,signal:combined,get expires_at(){return deadline;},dispose(){clearTimeout(timer);}};
}
