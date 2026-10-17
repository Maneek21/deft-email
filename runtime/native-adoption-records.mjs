import {createHash} from 'node:crypto';
import {canonical,digest,exact,fail} from './contract.mjs';
import {uuid,validateDraftContent,validateFileMetadata} from './draft-store.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const positive=value=>Number.isSafeInteger(value)&&value>=1&&value<=2147483647;
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
export function nativeScope(scope){exact(scope,['org_id','owner_user_id','account_id']);if(Object.values(scope).some(value=>typeof value!=='string'||!value||value.length>256||/[\u0000-\u001f\u007f]/u.test(value)))fail('EMAIL_NATIVE_IMPORT_SCOPE_INVALID');return structuredClone(scope);}
export async function writeNativeImportRow(store,key,value,check){return store.withLock({key},async tx=>{await check();const row=await tx.read();if(row){if(canonical(row.value)!==canonical(value))fail('EMAIL_NATIVE_IMPORT_CONFLICT');return;}if(!await tx.compareAndSwap({expected_revision:null,value}))fail('EMAIL_NATIVE_IMPORT_CONFLICT');await check();});}
export function nativeDraftRecord(rawScope,input){
 const scope=nativeScope(rawScope);exact(input,['draft','files','effect_fence']);const draft=input.draft;
 exact(draft,['draft_id','revision','content_revision','status','content','origin','last_edited_by_user_id','created_at','updated_at']);
 exact(draft.origin,['kind','created_by_user_id','originating_run_id']);
 if(!uuid(draft.draft_id)||!positive(draft.revision)||!positive(draft.content_revision)||draft.content_revision>draft.revision||!['draft','submitted','archived'].includes(draft.status)||!['human','agent'].includes(draft.origin.kind)||typeof draft.origin.created_by_user_id!=='string'||!draft.origin.created_by_user_id||typeof draft.last_edited_by_user_id!=='string'||!draft.last_edited_by_user_id||draft.origin.originating_run_id!==null&&!uuid(draft.origin.originating_run_id)||!timestamp(draft.created_at)||!timestamp(draft.updated_at)||Date.parse(draft.updated_at)<Date.parse(draft.created_at)||!Array.isArray(input.files)||input.files.length>256)fail('EMAIL_NATIVE_IMPORT_DRAFT_INVALID');
 const content=validateDraftContent(draft.content);if(canonical(content)!==canonical(draft.content))fail('EMAIL_NATIVE_IMPORT_CONTENT_CHANGED');
 const files={},fileRows=[];
 for(const file of input.files){exact(file,['metadata','bytes','native_upload_revision','detached_at']);const metadata=validateFileMetadata(file.metadata);if(!(file.bytes instanceof Uint8Array)||file.bytes.byteLength!==metadata.size_bytes||sha(file.bytes)!==metadata.sha256||!positive(file.native_upload_revision)||file.native_upload_revision>=draft.revision||file.detached_at!==null&&!timestamp(file.detached_at)||files[metadata.file_id])fail('EMAIL_NATIVE_IMPORT_FILE_INVALID');
  files[metadata.file_id]={metadata,detached:file.detached_at!==null,upload_revision:file.native_upload_revision+1,native_upload_revision:file.native_upload_revision,native_detached_at:file.detached_at};
  fileRows.push({id:draft.draft_id+':'+metadata.file_id,value:{schema_version:'email.app_draft_file.v1',scope,draft_id:draft.draft_id,metadata,state:'staged',upload_request_id:null,native_import:true,bytes:Buffer.from(file.bytes).toString('base64url')}});
 }
 const active=Object.values(files).filter(file=>!file.detached).map(file=>file.metadata);
 if(active.length!==content.attachments.length||active.some(file=>!content.attachments.some(item=>canonical(item)===canonical(file))))fail('EMAIL_NATIVE_IMPORT_FILE_INVALID');
 const fence=input.effect_fence;
 if(fence!==null){exact(fence,['operation_ids','states']);if(!Array.isArray(fence.operation_ids)||!fence.operation_ids.length||fence.operation_ids.length>256||fence.operation_ids.some(id=>!uuid(id))||new Set(fence.operation_ids).size!==fence.operation_ids.length||!Array.isArray(fence.states)||fence.states.length!==fence.operation_ids.length||fence.states.some(value=>!['reserved','started','submitting','unknown','accepted','queued','uncertain','cancelled'].includes(value)))fail('EMAIL_NATIVE_IMPORT_EFFECT_INVALID');}
 return {record:{schema_version:'email.app_draft.v1',scope,draft_id:draft.draft_id,revision:draft.revision,content_revision:draft.content_revision,status:draft.status,created_by_user_id:draft.origin.created_by_user_id,last_edited_by_user_id:draft.last_edited_by_user_id,created_at:draft.created_at,updated_at:draft.updated_at,content,content_digest:digest(content),native_origin:structuredClone(draft.origin),files,receipts:[],...(fence?{native_effect_fence:structuredClone(fence)}:{})},fileRows};
}
