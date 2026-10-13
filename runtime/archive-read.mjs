import {canonical,digest,fail,exact} from './contract.mjs';
import {createEmailOAuth} from './vendor/providers/oauth-account.mjs';
import {createGmailAdapter} from './vendor/providers/gmail.mjs';
import {validateOAuthClient,oauthClientFingerprint} from './vendor/providers/oauth-provider.mjs';
import {encodeCursor,decodeCursor} from './vendor/providers/contract.mjs';
import {LogicalMailIndex} from './vendor/logical-mail-index.mjs';
import {projectEmailMetadata} from './vendor/metadata-resource.mjs';
import {providerSourceForParent} from './vendor/providers/provider-browser.mjs';
import {gmailMessageFolders} from './vendor/providers/native-folder-identity.mjs';
const excluded=['INBOX','SENT','DRAFT','TRASH','SPAM'];
export const ARCHIVE_QUERY='-in:inbox -in:sent -in:drafts -in:trash -in:spam';
/** Explicit canonical Gmail Archive read. This is not a compiler bypass for
 * arbitrary human search: exactly one app-owned selector reaches the adapter. */
export async function readArchive({identityScopeFor,input,binding,client,custody,accountFromRecord,check,fetch:fetchImpl,signal,expiresAt,now=Date.now}){
 exact(input,['query','cursor','limit']);if(input.query!=='in:archive'||!Number.isInteger(input.limit)||input.limit<1||input.limit>25||input.cursor!==null&&typeof input.cursor!=='string'||binding.provider!=='gmail')fail('EMAIL_DATA_INPUT_INVALID');
 client=validateOAuthClient('gmail',client);const fingerprint=oauthClientFingerprint('gmail',client);
 const inspect=async()=>custody.withAccount(binding,async tx=>{const row=tx.read();if(!row||row.health!=='connected'||canonical(row.binding)!==canonical(binding)||row.secret?.client_fingerprint!==fingerprint||!row.secret.identity?.provider_subject)fail('EMAIL_DATA_CONNECTION_DENIED');const account=accountFromRecord(binding,row);if(!account?.capabilities.includes('read'))fail('EMAIL_DATA_CONNECTION_DENIED');return {account,pin:digest({binding:row.binding,generation:row.setup_generation,principal:row.secret.identity.provider_subject,account,scopes:row.secret.scopes,client_fingerprint:fingerprint})};});
 await check();const selected=await inspect(),identityScope=identityScopeFor?await identityScopeFor():binding.scope;
 const current=async()=>{signal?.throwIfAborted();await check();if((await inspect()).pin!==selected.pin)fail('EMAIL_DATA_CONNECTION_DENIED');signal?.throwIfAborted();};
 const guardedFetch=async(url,options={})=>{await current();return fetchImpl(url,{...options,signal:AbortSignal.any([signal,options.signal].filter(Boolean))});};
 // OAuth checks occur inside custody locks. Its host guard is current online
 // authority only; adapter/network checks inspect custody outside those locks.
 const oauth=createEmailOAuth({clients:{gmail:client},custody,now,fetch:async(url,options={})=>{await check();return fetchImpl(url,{...options,signal:AbortSignal.any([signal,options.signal].filter(Boolean))});},host:{async resolveAccount(request){await check();if(canonical(request.scope)!==canonical(binding.scope)||request.account_id!==binding.account_id||request.purpose!=='read')fail('EMAIL_DATA_AUTHORITY_DENIED');return binding;},async assertAuthority({binding:requested,purpose}){if(canonical(requested)!==canonical(binding)||purpose!=='read')fail('EMAIL_DATA_AUTHORITY_DENIED');await check();return {allowed:true,expires_at:expiresAt()};}}});
 const cursorBinding=digest({version:'email.archive_cursor.v1',scope:binding.scope,binding,principal_pin:selected.pin,query:ARCHIVE_QUERY,limit:input.limit}),providerCursor=decodeCursor(input.cursor,cursorBinding);
 const adapter=createGmailAdapter({account:selected.account,fetch:guardedFetch,assertAuthority:async request=>{if(request.account_id!==binding.account_id||request.authority_epoch!==binding.authority_epoch||request.operation!=='read')return false;await current();return true;},getAccessToken:request=>oauth.getAccessToken({scope:binding.scope,account:selected.account,...request})});
 const page=await adapter.listMessages({query:ARCHIVE_QUERY,label_ids:[],include_spam_trash:false,cursor:providerCursor,limit:input.limit});await current();
 if(page.account_id!==binding.account_id||!Array.isArray(page.messages)||page.messages.length>input.limit||!Array.isArray(page.failures)||page.failures.length>input.limit||page.messages.some(message=>message.account_id!==binding.account_id||message.provider!=='gmail'))fail('EMAIL_DATA_RESULT_INVALID');
 const selectedMessages=page.messages.filter(message=>Array.isArray(message.folders)&&!message.folders.some(label=>excluded.includes(label))),scopeFailures=page.messages.length-selectedMessages.length,index=new LogicalMailIndex(identityScope);
 const items=selectedMessages.map(message=>{const parent=index.upsert(identityScope,message),metadata=projectEmailMetadata(parent);return {account_id:binding.account_id,logical_message_id:parent.logical_message_id,revision:metadata.revision,received_at:metadata.data.date||null,folders:gmailMessageFolders(parent.summary.folders??[]),flags:{seen:parent.summary.flags?.seen??false,flagged:parent.summary.flags?.flagged??false,answered:parent.summary.flags?.answered??false},data:metadata.data,provider_source:providerSourceForParent(selected.account,parent)};});
 const next_cursor=page.next_cursor===null?null:encodeCursor(cursorBinding,page.next_cursor);await current();return {schema_version:'deft.email_search_page.v1',account_id:binding.account_id,provider:'gmail',original_query:'in:archive',status:'supported',items,next_cursor,has_more:next_cursor!==null,query_complete:next_cursor===null&&page.failures.length===0&&scopeFailures===0,observed_at:page.observed_at,failure_count:page.failures.length+scopeFailures,unsupported:[],limitations:['gmail_archive_excludes_inbox_sent_drafts_trash_spam','message_not_thread_search','hydrated_current_labels_rechecked']};
}
