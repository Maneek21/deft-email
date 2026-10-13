import {canonical,digest,exact,fail} from './contract.mjs';
import {triageDigest} from './vendor/providers/triage-contract.mjs';
export const folderManagementOperation=key=>['create_folder','rename_folder'].includes(key);
export function prepareFolderManagement({input,record,scope,operation_id,expires_at,now=Date.now}){
 exact(input.parameters,['name']);const name=input.parameters.name;if(typeof name!=='string'||!name.isWellFormed()||!name||name.trim()!==name||name.length>128||Buffer.byteLength(name)>512||/[\u0000-\u001f\u007f-\u009f]/u.test(name))fail('EMAIL_FOLDER_MANAGE_INVALID');
 if(!folderManagementOperation(input.operation_key)||input.sources.length||input.record_sources?.length!==1||input.destination||input.labels||input.undo||!['gmail','microsoft'].includes(record.provider))fail('EMAIL_FOLDER_MANAGE_INVALID');
 const create=input.operation_key==='create_folder';if(create?!record.catalog_root:record.catalog_root||record.value.canonical_role!==null||record.value.kind==='label'&&!record.value.labels_allowed)fail('EMAIL_FOLDER_MANAGE_TARGET_DENIED');
 const logical_id='mail_'+digest(['catalog',scope,record.record_id]),request=create?{kind:'create',name}:{kind:'rename',id:record.provider_id,name,expected_name:record.value.name},plan={schema_version:'email.folder_manage_plan.v1',operation_id,binding:{scope},operation:{kind:input.operation_key},request,items:[{logical_id,before:{record_id:record.record_id,name:record.value.name}}],created_at:now(),expires_at};plan.digest=triageDigest(plan);return {plan,records:[{record_id:record.record_id,logical_message_id:logical_id,data:{subject:record.value.name}}]};
}
/** Started generic Run reservation is durable before this call. A lost writer
 * acknowledgement never permits retry; only known pre-effect rejection settles. */
export async function executeFolderManagement({plan,bridge,context,check}){
 const {digest:expected,...body}=plan;if(plan.schema_version!=='email.folder_manage_plan.v1'||triageDigest(body)!==expected||plan.items.length!==1||!folderManagementOperation(plan.operation.kind))fail('EMAIL_FOLDER_MANAGE_PLAN_DENIED');await check();
 try{const result=await bridge.nativeEmailFolderManage(plan.request,context);await check();if(result.label!==plan.request.name||plan.request.kind==='rename'&&result.id!==plan.request.id)fail('EMAIL_FOLDER_MANAGE_OUTCOME_UNKNOWN');return {items:[{logical_id:plan.items[0].logical_id,state:'succeeded'}]};}
 catch(error){const known=error.outcome==='no_effect'||['EMAIL_NATIVE_FOLDER_TARGET_CHANGED','EMAIL_NATIVE_FOLDER_INPUT_INVALID'].includes(error.code);if(known){await check();return {items:[{logical_id:plan.items[0].logical_id,state:'failed'}]};}return {items:[{logical_id:plan.items[0].logical_id,state:'unknown'}]};}
}
