import {exact,fail} from '../contract.mjs';
import {uuid} from '../draft-store.mjs';
const deny=()=>fail('EMAIL_INTEGRATION_TOOL_INVALID');
/** Email naming and argument mapping stay in the signed App. Source refs have
 * already been resolved by Host from opaque logical IDs under current grants. */
export function emailReadToolInput(request){
 const {input,tool_key,source_refs,store_key,scope,connection}=request;
 if(store_key!=='drafts'||input.account_id!==connection.account_ref)deny();
 const base={store_key,resource_key:scope.resource_key};
 const page=()=>{if(input.limit!==undefined&&(!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>100))deny();return {...base,cursor:input.cursor??null,limit:Math.min(input.limit??25,25)};};
 if(tool_key==='email_list'){
  exact(input,['account_id',...(Object.hasOwn(input,'folder')?['folder']:[]),...(Object.hasOwn(input,'cursor')?['cursor']:[]),...(Object.hasOwn(input,'limit')?['limit']:[])]);
  if(source_refs.length)deny();const folder=input.folder??'inbox';if(typeof folder!=='string'||!folder.length||folder.length>256||/[\r\n\0]/u.test(folder))deny();
  return {operation:'resource_list',input:{...page(),query:'in:'+folder}};
 }
 if(tool_key==='email_search'){
  exact(input,['account_id','query',...(Object.hasOwn(input,'cursor')?['cursor']:[]),...(Object.hasOwn(input,'limit')?['limit']:[])]);
  if(source_refs.length||typeof input.query!=='string'||!input.query.length||input.query.length>2048)deny();
  return {operation:'resource_list',input:{...page(),query:input.query}};
 }
 if(tool_key==='email_read'||tool_key==='email_thread'){
  exact(input,['account_id','logical_message_id',...(tool_key==='email_thread'&&Object.hasOwn(input,'cursor')?['cursor']:[]),...(tool_key==='email_thread'&&Object.hasOwn(input,'limit')?['limit']:[])]);
  if(!/^mail_[a-f0-9]{64}$/u.test(input.logical_message_id)||source_refs.length!==1||source_refs[0].resource_key!==scope.resource_key)deny();
  return tool_key==='email_read'?{operation:'resource_read_presentation',input:{store_key,...source_refs[0]}}:
   {operation:'resource_list',input:{...page(),anchor_record_id:source_refs[0].record_id}};
 }
 if(tool_key==='email_draft_get'){
  exact(input,['account_id','draft_id']);if(source_refs.length||!uuid(input.draft_id))deny();
  return {operation:'record_read',input:{store_key,record_id:input.draft_id}};
 }
 deny();
}
