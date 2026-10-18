import {AppIntegrationToolRuntimeRequestSchema,AppIntegrationToolRuntimeAuthorityResultSchema,AppIntegrationToolRuntimeResultSchema,parseAppIntegrationToolDeclaredInput} from '@deft/app-kit';
import {createHash} from 'node:crypto';
import {executeRecipientSuggestions} from './integration-recipient-tool.mjs';
import {canonical,fail} from './contract.mjs';
import {dataInputDigest,validateDataRequest,validateDataResult} from './data-contract.mjs';
import {emailReadToolInput} from '../app/tool-data-input.mjs';
import {EMAIL_INTEGRATION_TOOL_DECLARATIONS} from '../app/ten-tool-schema.mjs';
const hash=value=>'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');
/** Each original invocation has its own data checker. No mutable global actor
 * context, provider executor, effect retry or second permission lifecycle. */
export function createDeclaredIntegrationToolsRuntime({createDataRuntime,assertCurrent,now=Date.now}){
 if(typeof createDataRuntime!=='function'||typeof assertCurrent!=='function')fail('EMAIL_INTEGRATION_CONFIG_INVALID');
 return Object.freeze({async request(raw,signal){
  const outer=AppIntegrationToolRuntimeRequestSchema.parse(raw),declaration=EMAIL_INTEGRATION_TOOL_DECLARATIONS.find(row=>row.key===outer.tool_key);
  if(!declaration||declaration.operation!==outer.tool_operation||declaration.store_key!==outer.store_key||Date.parse(outer.expires_at)<=now())fail('EMAIL_INTEGRATION_TOOL_INVALID');
  if(canonical(parseAppIntegrationToolDeclaredInput(declaration,outer.input))!==canonical(outer.input))fail('EMAIL_INTEGRATION_TOOL_INPUT_NOT_NORMALIZED');
  const {input,schema_version,...pins}=outer;
  const childId=tag=>{const bytes=createHash('sha256').update(outer.request_id+'\0'+tag).digest();bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=bytes.subarray(0,16).toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
  async function execute(mapped,requestId=outer.request_id){
  const data=validateDataRequest({schema_version:'deft.app_data_runtime.v1',request_id:requestId,scope:outer.scope,connection:outer.connection,authority:outer.authority,expires_at:outer.expires_at,...mapped});
  const expected={schema_version:'deft.app_integration_tool_authority.v1',...pins,input_digest:hash(input),inner:{operation:data.operation,store_key:outer.store_key,input_digest:dataInputDigest(data),input:data.input,...(data.input.action_key?{action_key:data.input.action_key}:{})}};
  async function current(checkSignal){
   checkSignal?.throwIfAborted();if(Date.parse(outer.expires_at)<=now())fail('EMAIL_INTEGRATION_TOOL_EXPIRED');
   const reply=AppIntegrationToolRuntimeAuthorityResultSchema.parse(await assertCurrent(structuredClone(expected),checkSignal));
   const {allowed,...echo}=reply;if(allowed!==true||canonical(echo)!==canonical(expected))fail('EMAIL_INTEGRATION_TOOL_AUTHORITY_DENIED');
   checkSignal?.throwIfAborted();if(Date.parse(outer.expires_at)<=now())fail('EMAIL_INTEGRATION_TOOL_EXPIRED');
  }
  const runtime=createDataRuntime({assertCurrent:async(check,checkSignal)=>{
   if(check.request_id!==data.request_id||check.operation!==data.operation||check.input_digest!==dataInputDigest(data)||canonical(check.scope)!==canonical(data.scope)||canonical(check.connection)!==canonical(data.connection)||canonical(check.authority)!==canonical(data.authority))fail('EMAIL_INTEGRATION_TOOL_AUTHORITY_DENIED');
   await current(checkSignal);return {...check,allowed:true};
  }});
  await current(signal);const result=await runtime.request(data,signal);validateDataResult(result,data);await current(signal);return result;
  }
  if(outer.tool_key==='email_recipient_suggestions')return executeRecipientSuggestions({outer,createDataRuntime,assertCurrent,signal,now});
  const store_key=outer.store_key;
  if(store_key!=='drafts'||input.account_id!==outer.connection.account_ref)fail('EMAIL_INTEGRATION_TOOL_INVALID');
  let result;
  if(outer.tool_key==='email_draft_save'||outer.tool_key==='email_send'){
   if(outer.source_refs.length)fail('EMAIL_INTEGRATION_TOOL_INVALID');
   const existing=outer.tool_key==='email_send'||input.expected_revision>0;
   if(existing){
    const read=await execute({operation:'record_read',input:{store_key,record_id:input.draft_id}},childId('record-read'));
    if(read.outcome!=='completed'||!read.record||read.record.revision!==input.expected_revision)fail('EMAIL_DRAFT_CONFLICT');
    result=await execute({operation:outer.tool_key==='email_send'?'prepare_action':'record_save',input:{store_key,record_id:input.draft_id,expected_revision:input.expected_revision,expected_content_digest:read.record.content_digest,
     ...(outer.tool_key==='email_send'?{action_key:declaration.action_key,prepare_expires_at:outer.prepare_expires_at??outer.expires_at}:{value:input.content})}});
   }else{
    if(input.expected_revision!==undefined&&input.expected_revision!==0)fail('EMAIL_DRAFT_CONFLICT');
    result=await execute({operation:'record_create',input:{store_key,record_id:input.draft_id??outer.request_id,value:input.content}});
   }
  }else if(outer.tool_key==='email_triage'){
   if(outer.source_refs.length!==input.logical_message_ids?.length||!outer.source_refs.length)fail('EMAIL_INTEGRATION_TOOL_INVALID');
   result=await execute({operation:'prepare_resource_action',input:{store_key,resource_key:outer.scope.resource_key,action_key:declaration.action_key,operation_key:input.kind,sources:outer.source_refs,prepare_expires_at:outer.prepare_expires_at??outer.expires_at}});
  }else{
   const mapped=emailReadToolInput(outer);result=await execute(mapped);
   if(mapped.operation==='resource_list'&&(input.limit??25)>25){
    const pages=[result],seen=new Set();let count=result.items?.length??0;
    while(result.outcome==='completed'&&result.next_cursor&&count<input.limit&&pages.length<4){
     if(seen.has(result.next_cursor))fail('EMAIL_INTEGRATION_CURSOR_INVALID');seen.add(result.next_cursor);
     result=await execute({...mapped,input:{...mapped.input,cursor:result.next_cursor,limit:Math.min(25,input.limit-count)}},childId('page:'+pages.length));pages.push(result);count+=result.items?.length??0;
    }
    return AppIntegrationToolRuntimeResultSchema.parse({schema_version:'deft.app_integration_tool_result.v1',request_id:outer.request_id,tool_key:outer.tool_key,tool_operation:outer.tool_operation,store_key,input_digest:hash(input),outcome:'completed',value:{pages,next_cursor:result.next_cursor??null,partial:!!result.next_cursor||pages.some(p=>p.outcome!=='completed'||p.freshness?.complete!==true)}});
   }
  }
  return AppIntegrationToolRuntimeResultSchema.parse({schema_version:'deft.app_integration_tool_result.v1',request_id:outer.request_id,tool_key:outer.tool_key,tool_operation:outer.tool_operation,store_key,input_digest:hash(input),outcome:result.outcome==='completed'?'completed':result.outcome==='indeterminate'?'indeterminate':'denied',data_result:result});
 }});
}
