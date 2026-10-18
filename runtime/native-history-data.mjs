import {digest,exact,fail} from './contract.mjs';
import {createNativeHistoryStore} from './native-adoption-history.mjs';
import {createNativeHistoryIndex,nativeHistoryId} from './native-history-index.mjs';
import {readNativeIdentity} from './native-adoption-identity.mjs';
const epoch='1970-01-01T00:00:00.000Z';
export function nativeHistoryProjection(scope,row){
 const record_id=nativeHistoryId(scope,row),value={original_kind:row.kind,original_receipt_id:row.id,original_revision:row.revision,original_state:row.state,effect_policy:'inspect_only',mime_available:!!row.mime&&row.mime.bytes.length<=25*1024*1024};
 const scalar=field=>row.value?.[field]??row.value?.original_row?.[field];
 for(const field of ['operation_id','run_id','original_operation_id','original_run_id','origin_run_id','originating_run_id','draft_id','transport_outcome','sent_copy_outcome'])if(typeof scalar(field)==='string'&&scalar(field).length<=256)value[field]=scalar(field);
 value.original_created_at=typeof scalar('created_at')==='string'&&Number.isFinite(Date.parse(scalar('created_at')))?scalar('created_at'):null;
 value.original_updated_at=typeof scalar('updated_at')==='string'&&Number.isFinite(Date.parse(scalar('updated_at')))?scalar('updated_at'):null;
 value.mime_notice=value.mime_available?'Original MIME available':row.mime?'Original MIME exceeds the 25 MiB viewer limit':'Original MIME was not retained';
 const files=value.mime_available?[{file_id:record_id,filename:'original-message.eml',media_type:'message/rfc822',size_bytes:row.mime.bytes.length,sha256:'sha256:'+row.mime.sha256,upload_revision:1}]:[];
 Object.assign(value,{body:'Original kind: '+row.kind+'\nOriginal revision: '+row.revision+'\nOriginal state: '+row.state+'\nOriginal time: '+(value.original_created_at??'Not retained')+'\n'+value.mime_notice+'\nInspection only. This record cannot execute or retry an effect.',body_html:'',attachments:files.map(({upload_revision,...file})=>({...file,sha256:file.sha256.slice(7)}))});
 return {schema_version:'deft.app_record.v1',store_key:'native_history',record_id,revision:1,content_revision:1,content_digest:'sha256:'+digest(value),status:'submitted',value,files,summary:{kind:row.kind,receipt_id:row.id,state:row.state,effect_policy:'inspect_only',mime_available:value.mime_available},created_at:epoch,updated_at:epoch};
}
export async function nativeHistoryData({store,scope,session,request,base,check,checkLocal=check}){
 if(request.input.store_key!=='native_history'||request.authority.consent_id===null||!['record_list','record_read','file_read'].includes(request.operation))fail('EMAIL_NATIVE_HISTORY_DENIED');
 const localGuarded=async()=>{await checkLocal();if(!await readNativeIdentity(store,scope,session.binding,checkLocal,session))fail('EMAIL_NATIVE_HISTORY_DENIED');await checkLocal();};
 const guarded=async()=>{await check();await localGuarded();await check();};
 await guarded();const history=createNativeHistoryStore({store}),index=createNativeHistoryIndex({store}),input=request.input;
 const load=async id=>{const ref=await index.lookup(scope,id,localGuarded);return history.read(scope,ref,localGuarded);};
 if(request.operation==='record_list'){exact(input,['store_key','cursor','limit']);const page=await index.list(scope,input,localGuarded),items=[];for(const ref of page.entries){const row=await load(ref.record_id);try{const {value,files,...meta}=nativeHistoryProjection(scope,row);items.push(meta);}finally{row.mime?.bytes.fill(0);}}await guarded();return {...base,items,next_cursor:page.next_cursor};}
 if(request.operation==='record_read'){exact(input,['store_key','record_id']);const row=await load(input.record_id);try{const record=nativeHistoryProjection(scope,row);await guarded();return {...base,record,identities:[]};}finally{row.mime?.bytes.fill(0);}}
 exact(input,['store_key','record_id','file_id','upload_revision','sha256']);const row=await load(input.record_id);try{const file=nativeHistoryProjection(scope,row).files[0];if(!file||input.file_id!==file.file_id||input.upload_revision!==1||input.sha256!==file.sha256)fail('EMAIL_NATIVE_HISTORY_DENIED');await guarded();return {schema_version:'deft.app_data_binary.v1',request_id:request.request_id,operation:request.operation,input_digest:base.input_digest,record_id:input.record_id,...file,bytes:Buffer.from(row.mime.bytes)};}finally{row.mime?.bytes.fill(0);}
}
