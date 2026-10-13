import {createHash} from 'node:crypto';import {canonical,fail} from './contract.mjs';
import {recentAcceptedSuggestions} from './integration-recipient-projection.mjs';
import {AppIntegrationToolRuntimeAuthorityResultSchema,AppIntegrationToolRuntimeResultSchema} from '@deft/app-kit';
export {EMAIL_RECIPIENT_TOOL_DECLARATION} from '../app/recipient-tool-schema.mjs';
import {EMAIL_RECIPIENT_TOOL_DECLARATION} from '../app/recipient-tool-schema.mjs';
const hash=v=>'sha256:'+createHash('sha256').update(canonical(v)).digest('hex');
export async function executeRecipientSuggestions({outer,createDataRuntime,assertCurrent,signal,now=Date.now}){
 const {input,schema_version,...pins}=outer;if(outer.tool_key!==EMAIL_RECIPIENT_TOOL_DECLARATION.key||outer.tool_operation!=='read'||outer.store_key!=='drafts'||outer.source_refs.length||outer.prepare_expires_at||input.account_id!==outer.connection.account_ref)fail('EMAIL_RECIPIENT_INPUT_INVALID');
 const expected={schema_version:'deft.app_integration_tool_authority.v1',...pins,input_digest:hash(input),inner:null};
 const check=async()=>{signal?.throwIfAborted();if(Date.parse(outer.expires_at)<=now())fail('EMAIL_RECIPIENT_AUTHORITY_DENIED');const response=AppIntegrationToolRuntimeAuthorityResultSchema.parse(await assertCurrent(expected,signal));const {allowed,...echo}=response;if(allowed!==true||canonical(echo)!==canonical(expected))fail('EMAIL_RECIPIENT_AUTHORITY_DENIED');};
 const data={schema_version:'deft.app_data_runtime.v1',request_id:outer.request_id,scope:outer.scope,connection:outer.connection,authority:outer.authority,operation:'connection_metadata',input:{store_key:'drafts'},expires_at:outer.expires_at};
 const runtime=createDataRuntime({assertCurrent:async(child)=>{if(child.operation!==data.operation||child.request_id!==data.request_id||child.input_digest!==hash({operation:data.operation,input:data.input})||canonical(child.scope)!==canonical(data.scope)||canonical(child.connection)!==canonical(data.connection)||canonical(child.authority)!==canonical(data.authority))fail('EMAIL_RECIPIENT_AUTHORITY_DENIED');await check();return {...child,allowed:true};}});
 if(typeof runtime.withRecipientMetadataRead!=='function')fail('EMAIL_RECIPIENT_AUTHORITY_DENIED');
 await check();const value=await runtime.withRecipientMetadataRead(data,signal,async({scope,drafts,checkLocal})=>{
  if(canonical(scope)!==canonical({org_id:outer.scope.org_id,owner_user_id:outer.scope.owner_user_id,account_id:outer.connection.account_ref}))fail('EMAIL_RECIPIENT_AUTHORITY_DENIED');
  return recentAcceptedSuggestions({installation_id:outer.scope.installation_id,input:{query:input.query,limit:input.limit},readBounded:limit=>drafts.readRecentAcceptedMetadata(scope,limit,checkLocal),check:checkLocal});
 });
 return AppIntegrationToolRuntimeResultSchema.parse({schema_version:'deft.app_integration_tool_result.v1',request_id:outer.request_id,tool_key:outer.tool_key,tool_operation:'read',store_key:'drafts',input_digest:hash(input),outcome:'completed',value});
}
