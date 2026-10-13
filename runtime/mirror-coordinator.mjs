import {randomUUID} from 'node:crypto';import {createEncryptedEmailCustody} from './vendor/providers/custody-encrypted.mjs';import {createNativeEmailBridge} from './vendor/providers/native-mailbox.mjs';import {validateEmailAccount} from './vendor/account-registry.mjs';import {grantedOAuthCapabilities} from './vendor/providers/oauth-provider.mjs';import {createDraftStore} from './draft-store.mjs';import {createMailboxStore} from './mailbox-store.mjs';import {createMirrorStore,canReplaceExpiredMirror,canFenceUnknownCreate} from './mirror-store.mjs';import {createMirrorPrepared} from './mirror-prepared.mjs';import {purposeFor} from './purpose-set.mjs';import {canonical,digest,fail} from './contract.mjs';
const accountFromRecord=(binding,record)=>{if(!record?.secret?.identity||record.health!=='connected')return null;const identity=record.secret.identity;return validateEmailAccount({account_id:binding.account_id,provider:binding.provider,display_label:identity.display_label,primary_address:identity.primary_address,verified_sender_identities:[...identity.verified_sender_identities],capabilities:grantedOAuthCapabilities(binding,record.secret.scopes),connection_target:binding.connection_target,resource_binding_id:binding.resource_binding_id,action_binding_id:binding.action_binding_id,authority_epoch:binding.authority_epoch,health:'connected'});};
import {assertNoCredentialRepair,wrapCredentialProviderBridge} from './credential-repair-reservation.mjs';
import {fenceCredentialGeneration} from './credential-generation-fence.mjs';
/** Saved foreground data only records a private scope hint. Polling that hint
 * cannot create provider authority: the host must return a still-current
 * explicit mirror receipt, independently of browser/view lifetime. */
export function createMirrorCoordinator({store,client,mirror_client,provider='gmail',encryption_key,key_id,fetch,now=Date.now}){
 const drafts=createDraftStore({store,now}),mirrors=createMirrorStore({store,now}),prepared=createMirrorPrepared({store,now}),mailbox=createMailboxStore({store,now}),custody=createEncryptedEmailCustody({store,encryption_key,key_id,now}),hintKey='email.data.mirror_hints';
 const hints=()=>store.withLock({key:hintKey},async tx=>(await tx.read())?.value?.scopes??[]);
 async function observe(scope){await store.withLock({key:hintKey},async tx=>{const row=await tx.read(),scopes=row?.value?.scopes??[];if(scopes.some(value=>canonical(value)===canonical(scope)))return;if(scopes.length>=32)fail('EMAIL_MIRROR_HINT_LIMIT');if(!await tx.compareAndSwap({expected_revision:row?.revision??null,value:{scopes:[...scopes,structuredClone(scope)]}}))fail('EMAIL_MIRROR_HINT_CONFLICT');});}
 async function runOnce(signal){
  for(const connectionScope of await hints()){
   signal?.throwIfAborted();let poll;try{poll=await mirror_client.poll(connectionScope,signal);}catch{signal?.throwIfAborted();continue;}if(!Array.isArray(poll.receipts))fail('EMAIL_MIRROR_CHANNEL_INVALID');
   for(const receipt of poll.receipts){
    const check=async()=>{await assertNoCredentialRepair({store,scope:connectionScope});signal?.throwIfAborted();const fresh=await mirror_client.check(connectionScope,receipt.receipt_id,signal);if(fresh.revision!==receipt.revision||fresh.policy_digest!==receipt.policy_digest||fresh.account_ref!==receipt.account_ref||fresh.expires_at!==receipt.expires_at||Date.parse(fresh.expires_at)<=now())fail('EMAIL_MIRROR_AUTHORITY_DENIED');};
    await check();if(receipt.attempts_remaining<1)continue;
    const session=await store.withLock({key:'email.runtime.session.'+receipt.connection.session_id},async tx=>(await tx.read())?.value);
    if(!session||session.state!=='connected'||canonical(session.scope)!==canonical(connectionScope)||session.runtime_session_ref!==receipt.connection.runtime_session_ref||session.account?.account_ref!==receipt.account_ref||session.binding.provider!==provider)fail('EMAIL_MIRROR_CONNECTION_DENIED');purposeFor(session,'mirror_drafts',now);
    const fencedCustody=await fenceCredentialGeneration({store,custody,session});const scope={org_id:connectionScope.org_id,owner_user_id:connectionScope.owner_user_id,account_id:receipt.account_ref},sender=await custody.withAccount(session.binding,async tx=>{await check();return accountFromRecord(session.binding,tx.read());});if(!sender?.capabilities.includes('modify'))fail('EMAIL_MIRROR_MODIFY_REQUIRED');
    const bridge=wrapCredentialProviderBridge({store,scope:connectionScope,bridge:createNativeEmailBridge({selected:session.binding,clients:{[provider]:client},custody:fencedCustody,accountFromRecord,fetch:async(...args)=>{await check();return (fetch??globalThis.fetch)(...args);},now})}),context=()=>({org_id:scope.org_id,owner_user_id:scope.owner_user_id,account_id:scope.account_id,installation_id:connectionScope.installation_id,resource_binding_id:connectionScope.resource_binding_id,authority_version:receipt.policy_digest,expires_at:Math.min(now()+30000,Date.parse(receipt.expires_at)),recheck:check,signal,owner_capabilities:['read','modify']});
    // Inspect unresolved original effects before admitting fresh writes on this receipt.
    for(const recoveryOnly of [true,false]){let cursor=null;do{const page=await drafts.list(scope,{cursor,limit:50},check);cursor=page.next_cursor;for(const record of page.items){
     let row=await mirrors.read(scope,record.draft_id,check);
     // An inaccessible original remains permanently status-only and untouched.
     // Recheck the current receipt before considering a different saved record.
     const originalStatus=async submission=>{try{return await mirror_client.status(connectionScope,submission.receipt_id,submission.request_id,signal);}catch(error){signal?.throwIfAborted();if(error?.code!=='EMAIL_MIRROR_ORIGINAL_STATUS_DENIED')throw error;await check();return undefined;}};
     if(row?.pending_submission){const pending=row.pending_submission,status=await originalStatus(pending);if(status?.run)await mirrors.acknowledge(scope,record.draft_id,pending.request_id,status.run.id,check);continue;}
     const original=row?.last_submission?await originalStatus(row.last_submission):null;if(row?.last_submission&&original===undefined)continue;
     if(original?.run?.id===row?.last_submission?.run_id&&original?.run?.state==='unknown_outcome'&&canFenceUnknownCreate(row,original.unknown_create,now())){
      const frozen=await prepared.read(scope,row.desired.snapshot_id,check),input=frozen.input;
      if(input.mirror_operation!=='create'||input.record_id!==record.draft_id||input.record_revision!==row.desired.revision||input.content_digest!=='sha256:'+row.desired.content_digest||input.snapshot_digest!=='sha256:'+row.desired.snapshot_digest||digest(input)!==row.last_submission.input_digest||input.mirror_receipt_id!==row.last_submission.receipt_id||input.mirror_policy_digest!==original.unknown_create.mirror_policy_digest||canonical(frozen.identity.connection_scope)!==canonical(connectionScope))fail('EMAIL_MIRROR_RECOVERY_CHANGED');
      row=await mirrors.fenceUnknownCreate(scope,record.draft_id,original.unknown_create,check);
     }
     const submitRecovery=async(operation,target_operation_id)=>{const snapshot=await prepared.recovery({scope,session,receipt,row,operation,check});if(operation==='delete'&&!(await mirror_client.cleanupSource(connectionScope,receipt.receipt_id,snapshot.input,signal)).eligible)return null;const request_id=randomUUID();await mirrors.recoveryIntake(scope,record.draft_id,{request_id,receipt_id:receipt.receipt_id,input_digest:digest(snapshot.input),kind:operation,target_operation_id},check);const result=await mirror_client.submit(connectionScope,request_id,snapshot.input,signal);await mirrors.acknowledge(scope,record.draft_id,request_id,result.run.id,check);return {request_id,run_id:result.run.id};};
     if(row?.operation){if(['unknown','conflict','unsupported'].includes(row.state)&&(row.last_inspection_operation_id!==row.operation.operation_id||row.last_inspection_submission?.receipt_id!==receipt.receipt_id)&&['unknown_outcome','failed','cancelled','expired'].includes(original?.run?.state)){const work=await submitRecovery('inspect',row.operation.operation_id);if(work)return work;}continue;}
     if(recoveryOnly)continue;
     const expired=original?.run?.id===row?.last_submission?.run_id&&['pending_approval','expired'].includes(original?.run?.state)&&canReplaceExpiredMirror(row,original.unstarted_expiry,now());
     if(!expired&&row?.last_submission&&original?.run?.state!=='succeeded'&&row.recovered_create?.operation.run_id!==row.last_submission.run_id)continue;
     if(row?.accepted_send&&row.previous&&receipt.policy.cleanup_action_keys?.includes('send_message')){const work=await submitRecovery('delete',row.accepted_send.run_id);if(work)return work;continue;}
     if(record.status!=='draft'||row?.synced_desired?.revision===record.revision||!expired&&row&&row.desired.revision===record.revision)continue;
     let parent=null;if(record.content.reply_record_id){const anchor=await mailbox.getLogical(scope,record.content.reply_record_id,check),source=await bridge.nativeEmailPresentation({source:anchor.provider_source},context());if(!record.origin||record.origin.source_digest!=='sha256:'+source.source_digest||source.reply_seed_unavailable?.length)fail('EMAIL_MIRROR_SOURCE_UNAVAILABLE');const metadata=source.presentation.metadata;parent={account_id:scope.account_id,org_id:scope.org_id,owner_id:scope.owner_user_id,logical_message_id:anchor.logical_message_id,message_id:metadata.message_id,references:metadata.references.split(/\s+/u).filter(Boolean),...(provider==='gmail'?{thread_id:anchor.provider_source.locator.thread_id}:{})};}
     const snapshot=await prepared.prepare({scope,session,receipt:{...receipt,operation:row?.previous?'update':'create'},record,drafts,sender,parent,check}),desired={record_id:record.draft_id,revision:record.revision,content_digest:record.content_digest,snapshot_id:snapshot.input.snapshot_id,snapshot_digest:snapshot.input.snapshot_digest.slice(7)},request_id=randomUUID();
     if(expired)await mirrors.replaceExpired(scope,record.draft_id,{proof:original.unstarted_expiry,desired,request_id,receipt_id:receipt.receipt_id,input_digest:digest(snapshot.input)},check);
     else{await mirrors.enqueue(scope,desired,check);await mirrors.enabled(scope,record.draft_id,true,check);await mirrors.intake(scope,record.draft_id,{request_id,receipt_id:receipt.receipt_id,input_digest:digest(snapshot.input)},check);}
     // Persist original UUID before network. Any lost reply becomes status-only
     // recovery; it never resubmits preparation or a provider effect.
     const result=await mirror_client.submit(connectionScope,request_id,snapshot.input,signal);await mirrors.acknowledge(scope,record.draft_id,request_id,result.run.id,check);return {request_id,run_id:result.run.id};
    }}while(cursor!==null);}
   }
  }return null;
 }
 return Object.freeze({observe,runOnce});
}

