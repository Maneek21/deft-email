import {canonical,fail} from './contract.mjs';
import {createNativeImapBridge} from './vendor/providers/native-imap.mjs';

/** Per-call trusted composition, never a Worker or endpoint nomination.
 * Immutable scope/session selects encrypted custody. Endpoint policy and
 * credential generation are checked before/after socket use and disclosure. */
export function createImapReadPorts({forms,connector,session_id,scope,check,imageDependencies,now=Date.now}){
 const row=()=>forms.currentAccount(session_id,scope,check);
 const descriptor=account=>({org_id:scope.org_id,owner_user_id:scope.owner_user_id,installation_id:scope.installation_id,account_id:account.account_id,provider:'imap_smtp',resource_binding_id:scope.resource_binding_id,authority_epoch:account.authority_epoch,connection_revision:account.connection_revision,principal_digest:account.principal_digest,health:account.state,capabilities:account.capabilities,primary_address:account.profile.primary_address,display_label:account.profile.display_label});
 const sameContext=context=>{if(['org_id','owner_user_id','installation_id','resource_binding_id'].some(key=>context[key]!==scope[key])||typeof context.recheck!=='function'||context.expires_at<=now()||context.expires_at>Date.parse(scope.consent_expires_at))fail('EMAIL_IMAP_ACCESS_DENIED');};
 const nativeView=account=>{const {org_id,owner_user_id,installation_id,...view}=descriptor(account);return view;};
 const host=Object.freeze({
  async current(context){sameContext(context);context.signal?.throwIfAborted();await context.recheck();const account=await row();if(context.account_id!==account.account_id)fail('EMAIL_IMAP_ACCESS_DENIED');return descriptor(account);},
  async withAuthorizedClient(context,expected,work){sameContext(context);const account=await row();if(context.account_id!==account.account_id||canonical(nativeView(account))!==canonical(expected))fail('EMAIL_IMAP_ACCESS_DENIED');
   const boundCheck=async()=>{context.signal?.throwIfAborted();await check();await context.recheck();const current=await row();if(current.custody_generation!==account.custody_generation||current.receipt.digest!==account.receipt.digest||!current.capabilities.includes('read')||context.expires_at<=now())fail('EMAIL_IMAP_ACCESS_DENIED');};
   return connector.imap(account.profile.imap,{signal:context.signal,expires_at:context.expires_at,check:boundCheck},client=>{
    const commands=new Set(['list','getMailboxLock','search','fetchOne','download']);
    const fenced=new Proxy(client,{get(target,key){const value=Reflect.get(target,key,target);if(key==='fetch')return (...args)=>(async function*(){await boundCheck();const iterator=value.apply(target,args)[Symbol.asyncIterator]();let failure;try{for(;;){await boundCheck();const next=await iterator.next();await boundCheck();if(next.done)break;yield next.value;}}catch(error){failure=error;throw error;}finally{try{await iterator.return?.();}catch(error){if(!failure)throw error;}}})();if(typeof key==='string'&&commands.has(key)&&typeof value==='function')return async(...args)=>{await boundCheck();const result=await value.apply(target,args);try{await boundCheck();return result;}catch(error){try{if(key==='getMailboxLock')result?.release?.();if(key==='download')result?.content?.destroy?.();}catch{}throw error;}};return typeof value==='function'?value.bind(target):value;}});
    return work(fenced);
   });
  },
 });
 const readBridge=createNativeImapBridge({host,imageDependencies,now});
 const bridge=Object.freeze({...readBridge,async nativeEmailSendIdentity(context){
  sameContext(context);await check();const account=await row();
  const action=account.action_consents.filter(value=>value.action_key==='send_message'&&Date.parse(value.expires_at)>now());
  if(context.account_id!==account.account_id||!account.profile.smtp||!account.capabilities.includes('send')||action.length!==1)fail('EMAIL_IMAP_SEND_DENIED');
  await check();return {...descriptor(account),connection_target:scope.target_key,action_binding_id:action[0].action_binding_id,verified_sender_identities:[account.profile.primary_address],identity_assurance:'owner_declared_authenticated'};
 }});return Object.freeze({host,bridge});
}
