import {canonical,digest,exact,fail,isoTime,opaque,validateScope,hostUuid} from './contract.mjs';
import {uuid} from './draft-store.mjs';
import {APP_DATA_LIMITS,AppDataRuntimeRequestSchema,AppDataResultSchema,AppDataBinaryMetadataSchema,canonicalAppDataJson} from '@deft/app-kit';
import {createHash} from 'node:crypto';
import {validateChangeReceiptStatus} from './record-change-contract.mjs';

export const DATA_JSON_BYTES=524288,FILE_FRAME_HEADER_BYTES=16384,FILE_BYTES=25*1024*1024,SOURCE_BYTES=35*1024*1024;
export const DATA_OPERATIONS=Object.freeze(['record_list','record_read','record_create','record_save','record_archive','file_upload','file_copy','file_read','file_detach','resource_list','resource_read_metadata','resource_read_presentation','resource_read_source','resource_list_files','resource_read_file','resource_read_image','resource_refresh','connection_metadata','request_status','prepare_action','read_prepared','prepare_resource_action','read_prepared_resource_action','prepared_action_commit','prepared_action_restore']);
export function validateDataRequest(raw){
  if(!AppDataRuntimeRequestSchema.safeParse(raw).success)fail('EMAIL_DATA_INPUT_INVALID');
  exact(raw,['schema_version','request_id','scope','connection','authority','operation','expires_at','input']);
  if(raw.schema_version!=='deft.app_data_runtime.v1'||!uuid(raw.request_id)||!DATA_OPERATIONS.includes(raw.operation)||!isoTime(raw.expires_at)||!raw.input||typeof raw.input!=='object'||Array.isArray(raw.input))fail('EMAIL_DATA_INPUT_INVALID');
  validateScope(raw.scope);exact(raw.connection,['session_id','session_revision','runtime_session_ref','account_ref']);
  if(!hostUuid(raw.connection.session_id)||!opaque(raw.connection.account_ref)||!opaque(raw.connection.runtime_session_ref)||!Number.isSafeInteger(raw.connection.session_revision)||raw.connection.session_revision<1)fail('EMAIL_DATA_INPUT_INVALID');
  exact(raw.authority,['consent_id','consent_digest','data_policy_digest']);
  if((raw.authority.consent_id===null)!==(raw.authority.consent_digest===null)||raw.authority.consent_id!==null&&(!uuid(raw.authority.consent_id)||!/^sha256:[a-f0-9]{64}$/u.test(raw.authority.consent_digest??''))||!/^sha256:[a-f0-9]{64}$/u.test(raw.authority.data_policy_digest??''))fail('EMAIL_DATA_INPUT_INVALID');
  if(Buffer.byteLength(JSON.stringify(raw))>DATA_JSON_BYTES)fail('EMAIL_DATA_INPUT_INVALID');return structuredClone(raw);
}
export const dataInputDigest=request=>'sha256:'+createHash('sha256').update(canonicalAppDataJson({operation:request.operation,input:request.input})).digest('hex');
const resultFields={connection_metadata:['identities'],record_list:['items','next_cursor'],record_read:['record','identities'],record_create:['record','identities'],record_save:['record','identities'],record_archive:['record','identities'],file_upload:['record','identities'],file_copy:['record','identities'],file_detach:['record','identities'],resource_list:['items','next_cursor','freshness'],resource_read_metadata:['resource'],resource_read_presentation:['resource','files','presentation'],resource_list_files:['files'],resource_refresh:['freshness'],request_status:['request_status'],prepare_action:['prepared'],read_prepared:['prepared'],prepare_resource_action:['prepared_resource'],read_prepared_resource_action:['prepared_resource'],prepared_action_commit:['prepared_action_receipt'],prepared_action_restore:['prepared_action_receipt']};
export function validateDataResult(result,request){
  if(result.request_id!==request.request_id||result.operation!==request.operation||result.input_digest!==dataInputDigest(request))fail('EMAIL_DATA_RESULT_INVALID');
  if(result.bytes){const {bytes,...header}=result;if(!AppDataBinaryMetadataSchema.safeParse(header).success||!(bytes instanceof Uint8Array)||bytes.length!==header.size_bytes||'sha256:'+createHash('sha256').update(bytes).digest('hex')!==header.sha256)fail('EMAIL_DATA_RESULT_INVALID');return result;}
  // The Kit verifies a generic principal. Email additionally requires a mailbox identity.
  if(result.identities?.some(identity=>typeof identity.address!=='string'||identity.address.length>320||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(identity.address)||/[\u0000-\u001f\u007f-\u009f]/u.test(identity.address)))fail('EMAIL_DATA_RESULT_INVALID');
  const legacy={...result};delete legacy.primary_identity;delete legacy.document_policy;
  if(Object.hasOwn(result,'primary_identity')){const identity=result.primary_identity;if(!['connection_metadata','record_read'].includes(request.operation)||identity!==null&&(!Array.isArray(result.identities)||!result.identities.some(row=>canonical(row)===canonical(identity))))fail('EMAIL_DATA_RESULT_INVALID');}
  if(Object.hasOwn(result,'document_policy')){exact(result.document_policy,['schema_version','field','automatic_value']);if(request.operation!=='record_read'||request.input.store_key!=='preferences'||result.record?.store_key!=='preferences'||result.document_policy.schema_version!=='deft.app_record_document_policy.v1'||result.document_policy.field!=='external_images'||result.document_policy.automatic_value!=='always')fail('EMAIL_DATA_RESULT_INVALID');}
  if((!AppDataResultSchema.safeParse(legacy).success&&!validateChangeReceiptStatus(result))||Buffer.byteLength(JSON.stringify(result))>APP_DATA_LIMITS.result_json_bytes)fail('EMAIL_DATA_RESULT_INVALID');
  const allowed=result.outcome==='completed'?[...(resultFields[request.operation]??[])]:[];
  if(Object.hasOwn(result,'record_seed_value')){if(request.operation!=='connection_metadata'||!request.input.seed)fail('EMAIL_DATA_RESULT_INVALID');allowed.push('record_seed_value');}if(Object.hasOwn(result,'primary_identity'))allowed.push('primary_identity');if(Object.hasOwn(result,'document_policy'))allowed.push('document_policy');
  const search=Object.hasOwn(result,'search');if(search&&request.operation==='resource_list'&&result.outcome==='completed')allowed.push('search');
  for(const field of Object.keys(result))if(!['schema_version','request_id','operation','input_digest','outcome',...allowed].includes(field))fail('EMAIL_DATA_RESULT_INVALID');
  if(result.outcome==='completed'&&allowed.some(field=>!Object.hasOwn(result,field)&&!(field==='freshness'&&search&&result.search.status==='unsupported')))fail('EMAIL_DATA_RESULT_INVALID');
  return result;
}
export function dataAuthorityRequest(request,expires_at){return {schema_version:'deft.app_data_authority.v1',request_id:request.request_id,scope:request.scope,connection:request.connection,authority:request.authority,operation:request.operation,input_digest:dataInputDigest(request),expires_at};}
/** A response must repeat every authority pin; only its deadline can shrink. */
export function createDataChecker({request,assertCurrent,signal,now=Date.now}){
  let deadline=Math.min(Date.parse(request.expires_at),Date.parse(request.scope.consent_expires_at),now()+30000);const expiry=new AbortController(),combined=AbortSignal.any([signal,expiry.signal].filter(Boolean));let timer;
  const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>expiry.abort(new Error('EMAIL_DATA_AUTHORITY_EXPIRED')),Math.max(0,deadline-now()));timer.unref();};arm();
  const check=async()=>{combined.throwIfAborted();if(deadline<=now())fail('EMAIL_DATA_AUTHORITY_DENIED');const expected=dataAuthorityRequest(request,new Date(deadline).toISOString()),response=await assertCurrent(expected,combined);exact(response,[...Object.keys(expected),'allowed']);const {expires_at,allowed,...pins}=response,{expires_at:ignored,...expectedPins}=expected;if(allowed!==true||canonical(pins)!==canonical(expectedPins)||!isoTime(expires_at)||Date.parse(expires_at)<=now()||Date.parse(expires_at)>deadline)fail('EMAIL_DATA_AUTHORITY_DENIED');deadline=Math.min(deadline,Date.parse(expires_at));arm();combined.throwIfAborted();return deadline;};
  const checkLocal=()=>{combined.throwIfAborted();if(deadline<=now())fail('EMAIL_DATA_AUTHORITY_DENIED');};
  return {check,checkLocal,signal:combined,get expires_at(){return deadline;},dispose(){clearTimeout(timer);}};
}
export function encodeFileFrame(header,bytes){const metadata=Buffer.from(JSON.stringify(header)),limit=header.operation==='resource_read_source'?SOURCE_BYTES:FILE_BYTES;if(metadata.length>FILE_FRAME_HEADER_BYTES||!(bytes instanceof Uint8Array)||bytes.byteLength>limit)fail('EMAIL_DATA_FRAME_LIMIT');const prefix=Buffer.alloc(4);prefix.writeUInt32BE(metadata.length);return Buffer.concat([prefix,metadata,bytes]);}
export function decodeFileFrame(frame){if(!(frame instanceof Uint8Array)||frame.length<4||frame.length>FILE_BYTES+FILE_FRAME_HEADER_BYTES+4)fail('EMAIL_DATA_FRAME_INVALID');const bytes=Buffer.from(frame),length=bytes.readUInt32BE();if(length<2||length>FILE_FRAME_HEADER_BYTES||bytes.length<4+length)fail('EMAIL_DATA_FRAME_INVALID');let header;try{header=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(4,4+length)));}catch{fail('EMAIL_DATA_FRAME_INVALID');}return {header,bytes:bytes.subarray(4+length)};}
