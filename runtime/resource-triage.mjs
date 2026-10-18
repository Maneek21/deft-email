import {createImapResourceTriage} from './imap-resource-triage.mjs';

import {createEmailOAuth} from './vendor/providers/oauth-account.mjs';

import {createGmailTriageAdapter} from './vendor/providers/triage-gmail.mjs';

import {createMicrosoftTriageAdapter} from './vendor/providers/triage-microsoft.mjs';

import {createEmailTriageService} from './vendor/triage-service.mjs';

import {resolveProviderSource} from './vendor/providers/provider-browser.mjs';

import {validateEmailAccount} from './vendor/account-registry.mjs';

import {grantedOAuthCapabilities,oauthClientFingerprint,validateOAuthClient} from './vendor/providers/oauth-provider.mjs';

import {purposeFor} from './purpose-set.mjs';

import {ORGANIZE_OPERATIONS} from './resource-plan-store.mjs';

import {canonical,fail,consentDeadline} from './contract.mjs';



/** Request-local ports for the frozen triage engine. The credential anchor is

 * selected custody only; the independent current Organize grant gates every

 * token read, actual network request and native reservation. */

export async function createResourceTriage({session,custody,client,journal,check,checkLocal=check,signal,expires_at,getDeadline=()=>expires_at,now=Date.now,fetch:fetchImpl=globalThis.fetch,resolveMessage,forms,connector,store,mailbox}){

 if(session.binding.provider==='imap_smtp')return createImapResourceTriage({session,forms,connector,journal,check,checkLocal,signal,expires_at,getDeadline,now,resolveMessage,store,mailbox});

 const provider=session.binding.provider;if(!['gmail','microsoft'].includes(provider))fail('EMAIL_RESOURCE_ACTION_UNSUPPORTED');client=validateOAuthClient(provider,client);const fingerprint=oauthClientFingerprint(provider,client),purpose=purposeFor(session,'organize_messages',now),selected=session.binding;

 await check();const initial=await custody.withAccount(selected,tx=>tx.read());

 if(!initial||initial.health!=='connected'||canonical(initial.binding)!==canonical(selected)||initial.secret?.client_fingerprint!==fingerprint||!grantedOAuthCapabilities(selected,initial.secret.scopes).includes('modify')||!Number.isSafeInteger(initial.setup_generation)||initial.setup_generation<1)fail('EMAIL_RESOURCE_ACTION_CUSTODY_DENIED');

 const generation=initial.setup_generation,identity=initial.secret.identity,scope=selected.scope;

 const account=validateEmailAccount({account_id:selected.account_id,provider:selected.provider,display_label:identity.display_label,primary_address:identity.primary_address,verified_sender_identities:[...identity.verified_sender_identities],capabilities:grantedOAuthCapabilities(selected,initial.secret.scopes),connection_target:selected.connection_target,resource_binding_id:selected.resource_binding_id,action_binding_id:selected.action_binding_id,authority_epoch:selected.authority_epoch,health:'connected'});

 if(account.provider!==provider)fail('EMAIL_RESOURCE_ACTION_UNSUPPORTED');

 const current=async()=>{signal?.throwIfAborted();if(now()>=getDeadline()||canonical(purposeFor(session,'organize_messages',now))!==canonical(purpose))fail('EMAIL_RESOURCE_ACTION_AUTHORITY_DENIED');await checkLocal();signal?.throwIfAborted();};

 let activeCustodyRead=null;

 const assertRow=(row,refresh=false)=>{if(!row||!(row.health==='connected'||refresh&&row.health==='refresh_pending')||row.setup_generation!==generation||canonical(row.binding)!==canonical(selected)||row.secret?.client_fingerprint!==fingerprint)fail('EMAIL_RESOURCE_ACTION_CUSTODY_DENIED');return row;};

 const fencedCustody={...custody,withAccount(binding,work){if(canonical(binding)!==canonical(selected))fail('EMAIL_RESOURCE_ACTION_CUSTODY_DENIED');return custody.withAccount(binding,async tx=>{const previous=activeCustodyRead;activeCustodyRead=()=>assertRow(tx.read(),true);try{return await work({...tx,read(){return assertRow(tx.read());}});}finally{activeCustodyRead=previous;}});}};

 const fetchCurrent=async(url,options={})=>{await current();if(activeCustodyRead)activeCustodyRead();else await fencedCustody.withAccount(selected,tx=>tx.read());await check();await current();return fetchImpl(url,{...options,signal:AbortSignal.any([signal,options.signal,AbortSignal.timeout(30000)].filter(Boolean))});};

 const oauth=createEmailOAuth({clients:{[provider]:client},custody:fencedCustody,fetch:fetchCurrent,now,host:{async resolveAccount(input){await current();if(input.account_id!==account.account_id||input.purpose!=='modify'||canonical(input.scope)!==canonical(scope))fail('EMAIL_RESOURCE_ACTION_AUTHORITY_DENIED');return selected;},async assertAuthority(input){await current();if(input.purpose!=='modify'||canonical(input.binding)!==canonical(selected))fail('EMAIL_RESOURCE_ACTION_AUTHORITY_DENIED');return {allowed:true,expires_at:Math.min(getDeadline(),consentDeadline(purpose))};}}});

 const binding={scope,account,action_binding_id:purpose.action_binding_id,operations:Object.values(ORGANIZE_OPERATIONS).filter(value=>!['undo','create_folder','rename_folder','manual_rule'].includes(value)&&(provider==='gmail'||value!=='labels')).sort()},adapter=(provider==='gmail'?createGmailTriageAdapter:createMicrosoftTriageAdapter)({binding,now,fetch:fetchCurrent,assertAuthority:async({binding:requested,operation})=>{await current();return canonical(requested)===canonical(binding)&&binding.operations.includes(operation);},getAccessToken:async()=>{await current();const token=await oauth.getAccessToken({scope,account,account_id:account.account_id,authority_epoch:account.authority_epoch,operation:'modify'});const row=await fencedCustody.withAccount(selected,tx=>tx.read());await current();return {token,granted_scopes:row.secret.scopes};}});

 let uncertain=false;const effectCurrent=async()=>{if(uncertain)fail('EMAIL_RESOURCE_ACTION_UNKNOWN');await current();};

 const fencedEffect=method=>async request=>{let reserved=false;try{return await adapter[method]({...request,reserve:async()=>{await request.reserve();reserved=true;}});}catch(error){const known=reserved&&['EMAIL_TRIAGE_PROVIDER_REJECTED','EMAIL_TRIAGE_CONFLICT'].includes(error.code)&&error.status>=400&&error.status<500&&error.status!==408;if(reserved&&!known)uncertain=true;throw error;}};
 const fencedAdapter={...adapter,apply:fencedEffect('apply'),undo:fencedEffect('undo')};

 const service=createEmailTriageService({journal,now,adapterFor:async expected=>{await effectCurrent();if(canonical(expected)!==canonical(binding))fail('EMAIL_RESOURCE_ACTION_AUTHORITY_DENIED');return fencedAdapter;},resolveAuthority:async({scope:requested,account_id,operation})=>{await effectCurrent();if(canonical(requested)!==canonical(scope)||account_id!==account.account_id||!binding.operations.includes(operation))fail('EMAIL_RESOURCE_ACTION_AUTHORITY_DENIED');return {binding,actor:{kind:'human',user_id:scope.owner_id},expires_at:Math.min(getDeadline(),consentDeadline(purpose))};},resolveMessage:async request=>{await effectCurrent();const row=await resolveMessage(request.logical_id),source=resolveProviderSource({scope,account,source:row});await effectCurrent();return {scope,account_id:account.account_id,locator:source.locator};}});

 return Object.freeze({service,scope,account,purpose,custody_generation:generation,check:async()=>{await current();await fencedCustody.withAccount(selected,tx=>tx.read());await check();await current();}});

}

