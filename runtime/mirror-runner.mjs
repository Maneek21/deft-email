import {assertNoCredentialRepair,wrapCredentialProviderBridge} from './credential-repair-reservation.mjs';
import {fenceCredentialGeneration} from './credential-generation-fence.mjs';
import {createNativeEmailBridge as createUnfencedNativeEmailBridge} from './vendor/providers/native-mailbox.mjs';
const createNativeEmailBridge=options=>wrapCredentialProviderBridge({bridge:createUnfencedNativeEmailBridge(options),store:options.store,scope:{...options.selected.scope,resource_binding_id:options.selected.resource_binding_id}});
import {createEncryptedEmailCustody} from './vendor/providers/custody-encrypted.mjs';
import {grantedOAuthCapabilities,validateOAuthClient,oauthClientFingerprint} from './vendor/providers/oauth-provider.mjs';
import {validateEmailAccount} from './vendor/account-registry.mjs';
import {createDraftStore,uuid} from './draft-store.mjs';
import {createMirrorStore} from './mirror-store.mjs';
import {createMirrorPrepared} from './mirror-prepared.mjs';
import {purposeFor} from './purpose-set.mjs';
import {canonical,digest,exact,fail} from './contract.mjs';
const keys=['mirror_receipt_id','mirror_receipt_revision','mirror_policy_digest','record_store_key','record_id','record_revision','content_digest','snapshot_id','snapshot_digest','mirror_operation','accepted_submission_id','accepted_snapshot_id','accepted_snapshot_digest'];
const accountFromRecord=(binding,record)=>{if(!record?.secret?.identity||record.health!=='connected')return null;const identity=record.secret.identity;return validateEmailAccount({account_id:binding.account_id,provider:binding.provider,display_label:identity.display_label,primary_address:identity.primary_address,verified_sender_identities:[...identity.verified_sender_identities],capabilities:grantedOAuthCapabilities(binding,record.secret.scopes),connection_target:binding.connection_target,resource_binding_id:binding.resource_binding_id,action_binding_id:binding.action_binding_id,authority_epoch:binding.authority_epoch,health:'connected'});};
function graphJournal(store,scope,operation_id,input_digest){const pins={scope,operation_id,input_digest},key='email.runtime.graph_mirror.'+digest(pins),valid=row=>{if(row&&canonical(row.pins)!==canonical(pins))fail('EMAIL_MIRROR_JOURNAL_CONFLICT');return row;};return {async create(plan){return store.withLock({key},async tx=>{let row=await tx.read();if(row){const state=valid(row.value).state;if(canonical(state.plan)!==canonical(plan))fail('EMAIL_MIRROR_JOURNAL_CONFLICT');return state;}const state={plan,steps:plan.steps.map(step=>({step_id:step.step_id,state:'prepared'}))};if(!await tx.compareAndSwap({expected_revision:null,value:{pins,state}}))fail('EMAIL_MIRROR_JOURNAL_CONFLICT');return state;});},async load(nominated,id){if(canonical(nominated)!==canonical(scope)||id!==operation_id)fail('EMAIL_MIRROR_JOURNAL_CONFLICT');return store.withLock({key},async tx=>valid((await tx.read())?.value)?.state??null);},async change(nominated,id,work){if(canonical(nominated)!==canonical(scope)||id!==operation_id)fail('EMAIL_MIRROR_JOURNAL_CONFLICT');return store.withLock({key},async tx=>{let row=await tx.read();return work(valid(row?.value)?.state??null,async state=>{if(!await tx.compareAndSwap({expected_revision:row?.revision??null,value:{pins,state}}))fail('EMAIL_MIRROR_JOURNAL_CONFLICT');row=await tx.read();});});}};}
/** One released exact Run. Unknown/reserved effects never re-enter native IO.
 * Remote conflict changes no saved local content. All provider fences perform
 * fresh host authority checks; private outcome custody survives revocation. */
export function createMirrorRunner({runtime_client,registration,client,provider='gmail',store,encryption_key,key_id,fetch:fetchImpl=globalThis.fetch,now=Date.now}){
 client=validateOAuthClient(provider,client);const fingerprint=oauthClientFingerprint(provider,client),custody=createEncryptedEmailCustody({encryption_key,key_id,store,now}),drafts=createDraftStore({store,now}),mirrors=createMirrorStore({store,now}),prepared=createMirrorPrepared({store,now});
 async function executeClaim(claim,started,signal){
  if(!uuid(claim?.run_id)||!uuid(claim.attempt_id)||claim.operation_name!=='mirror_drafts'||started.run_id!==claim.run_id||started.attempt_id!==claim.attempt_id)fail('EMAIL_MIRROR_CLAIM_DENIED');exact(started.input,keys);const input=structuredClone(started.input),input_digest='sha256:'+digest(input);
  if(input.record_store_key!=='drafts'||!['create','update','inspect','delete'].includes(input.mirror_operation)||['record_id','snapshot_id','mirror_receipt_id'].some(key=>!uuid(input[key])))fail('EMAIL_MIRROR_INPUT_DENIED');
  const controller=new AbortController(),combined=AbortSignal.any([signal,controller.signal].filter(Boolean));
  let authorityDeadline=Math.min(Date.parse(claim.lease_expires_at),Date.parse(started.lease_expires_at)),operationDeadline=now()+300000,deadline=Math.min(authorityDeadline,operationDeadline),lastHeartbeat=now(),authority,timer;
  const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>controller.abort(),Math.max(0,deadline-now()));timer.unref();};arm();
  let repairScope=null;const check=async()=>{if(repairScope)await assertNoCredentialRepair({store,scope:repairScope});
   combined.throwIfAborted();if(deadline<=now())fail('EMAIL_MIRROR_AUTHORITY_EXPIRED');
   let renewed=false;
   if(now()-lastHeartbeat>=15000&&typeof runtime_client.heartbeat==='function'){
    if(!await runtime_client.heartbeat(claim))fail('EMAIL_MIRROR_AUTHORITY_DENIED');
    combined.throwIfAborted();lastHeartbeat=now();renewed=true;
   }
   const next=await runtime_client.authorize(claim);combined.throwIfAborted();if(operationDeadline<=now())fail('EMAIL_MIRROR_AUTHORITY_EXPIRED');const nextLease=Date.parse(next.lease_expires_at);
   if(next.schema_version!=='deft.app_runtime_authority.v1'||next.audience!=='app_runtime'||next.run_id!==claim.run_id||next.attempt_id!==claim.attempt_id||next.operation_name!=='mirror_drafts'||next.org_id!==registration.org_id||next.runtime_registration_id!==registration.runtime_registration_id||next.runtime_epoch!==registration.runtime_epoch||next.input_digest!==input_digest||canonical(next.input)!==canonical(input)||!Number.isFinite(nextLease)||(!renewed&&nextLease>authorityDeadline)||nextLease<=now())fail('EMAIL_MIRROR_AUTHORITY_DENIED');
   if(authority){const {lease_expires_at:oldExpiry,...pins}=authority,{lease_expires_at:nextExpiry,...fresh}=next;if(canonical(pins)!==canonical(fresh))fail('EMAIL_MIRROR_AUTHORITY_DENIED');}
   authority=structuredClone(next);authorityDeadline=renewed?nextLease:Math.min(authorityDeadline,nextLease);deadline=Math.min(operationDeadline,authorityDeadline);arm();
  };
  let scope,row,reserved=false,providerStarted=false;
  try{
   await check();const snapshot=await prepared.read({org_id:authority.org_id,owner_user_id:authority.owner_id},input.snapshot_id,check);scope=snapshot.scope;operationDeadline=Math.min(operationDeadline,Date.parse(snapshot.identity.expires_at));deadline=Math.min(deadline,operationDeadline);arm();if(canonical(snapshot.input)!==canonical(input)||Date.parse(snapshot.identity.expires_at)<=now())fail('EMAIL_MIRROR_SNAPSHOT_DENIED');
   const connection=snapshot.identity.connection,session=await store.withLock({key:'email.runtime.session.'+connection.session_id},async tx=>(await tx.read())?.value);
   if(!session||session.state!=='connected'||session.client_fingerprint!==fingerprint||session.binding.provider!==provider||session.runtime_session_ref!==connection.runtime_session_ref||session.account?.account_ref!==scope.account_id||canonical(session.scope)!==canonical(snapshot.identity.connection_scope)||purposeFor(session,'mirror_drafts',now).action_binding_id!==authority.runtime_binding_id)fail('EMAIL_MIRROR_CONNECTION_DENIED');
   repairScope=session.scope;await assertNoCredentialRepair({store,scope:repairScope});const fencedCustody=await fenceCredentialGeneration({store,custody,session});const pins={org_id:'org_id',owner_id:'owner_user_id',app_installation_id:'installation_id',app_version_id:'app_version_id',grant_snapshot_id:'grant_snapshot_id',lifecycle_epoch:'lifecycle_epoch',grant_epoch:'grant_epoch'};if(Object.entries(pins).some(([host,local])=>authority[host]!==session.scope[local]))fail('EMAIL_MIRROR_SCOPE_DENIED');
   row=await mirrors.read(scope,input.record_id,check);if(!row?.enabled)return {status:'not_attempted',error_code:'APP_RUN_AUTHORIZATION_STALE'};
   if(row.recovered_create?.operation.operation_id===claim.run_id)return {status:'indeterminate'};
   if(row.operation&&input.mirror_operation!=='inspect')return {status:'indeterminate'};
   const record=await drafts.read(scope,input.record_id,check),deleting=input.mirror_operation==='delete';
   if(input.mirror_operation==='inspect'){
    const recovery=snapshot.identity.recovery,adopted=row.recovered_create;
    if(adopted?.proof.inspection_run_id===claim.run_id&&adopted.proof.inspection_attempt_id===claim.attempt_id&&adopted.proof.inspection_input_digest===input_digest.slice(7)&&recovery?.target_operation_id===adopted.operation.operation_id){await check();return structuredClone(adopted.result);}
    if(!recovery||recovery.target_operation_id!==(row.operation?.operation_id??null))fail('EMAIL_MIRROR_RECOVERY_CHANGED');
    const ref=recovery.provider_draft_ref,known=typeof ref==='string'&&ref.length>0&&ref.length<=256;
    let recoveryMime,nomination;
    if(known)nomination={operation:'inspect',operation_id:claim.run_id,provider_draft_ref:ref};
    else if(provider==='gmail'&&row.operation?.kind==='create'){
     const desired=row.operation.desired,original=await prepared.read(scope,desired.snapshot_id,check);
     if(original.input.mirror_operation!=='create'||original.input.record_id!==input.record_id||original.input.record_revision!==desired.revision||original.input.snapshot_digest!=='sha256:'+desired.snapshot_digest||original.input.content_digest!=='sha256:'+desired.content_digest)fail('EMAIL_MIRROR_RECOVERY_CHANGED');
     recoveryMime=Buffer.from(original.mime_bytes,'base64url');
     nomination={operation:'inspect',operation_id:claim.run_id,recovery:{message_id:`<${original.input.snapshot_id}@deft.invalid>`,mime_bytes:recoveryMime,mime_digest:original.identity.mime_digest}};
    }else return {status:'returned',provider_succeeded:true,output:{operation_id:claim.run_id,record_id:input.record_id,record_revision:input.record_revision,mirror_state:'unknown',automatic_retry:false,limitations_json:JSON.stringify({recovery:'inspect_only',unlocated_create:true,original_effect_replayed:false})}};
    const bridge=createNativeEmailBridge({store,selected:session.binding,clients:{[provider]:client},custody:fencedCustody,accountFromRecord,now,fetch:async(url,options={})=>{await check();await assertNoCredentialRepair({store,scope:session.scope});return fetchImpl(url,{...options,signal:AbortSignal.any([combined,options.signal].filter(Boolean))});}});
    let observed;try{
     observed=await bridge.nativeEmailDraftSync(nomination,{org_id:scope.org_id,owner_user_id:scope.owner_user_id,account_id:scope.account_id,installation_id:session.scope.installation_id,resource_binding_id:session.scope.resource_binding_id,authority_version:input_digest,expires_at:operationDeadline,recheck:check,signal:combined,owner_capabilities:['read','modify'],draft_sync_before_effect:async()=>false});
     const previous=observed.outcome==='present'?{provider_draft_ref:observed.provider_draft_ref,baseline_digest:observed.baseline_digest,provider_version:observed.provider_version}:null;
     if(!known&&observed.recovery_match==='matched'&&previous&&row.state==='unknown'&&row.operation?.kind==='create'){
      const latest=await drafts.read(scope,input.record_id,check);
      if(latest.status==='draft'){
       const result={status:'returned',provider_succeeded:true,output:{operation_id:claim.run_id,record_id:input.record_id,record_revision:row.operation.desired.revision,mirror_state:'synced',automatic_retry:false,limitations_json:JSON.stringify({limitations:observed.limitations,recovery:'adopted_original_baseline',original_operation_id:row.operation.operation_id,original_run_state:'unknown',original_content_match:true,original_effect_replayed:false,automatic_create_allowed:false,newer_local_revision:latest.revision>row.operation.desired.revision})}};
       await mirrors.adoptVerifiedCreate(scope,input.record_id,row.operation.operation_id,{previous,proof:{inspection_run_id:claim.run_id,inspection_attempt_id:claim.attempt_id,inspection_input_digest:input_digest.slice(7),inspection_authority_digest:digest(authority),receipt_id:input.mirror_receipt_id,receipt_revision:input.mirror_receipt_revision,current_record_revision:latest.revision},result},check);await check();return result;
      }
     }
     if(row.operation)await mirrors.inspected(scope,input.record_id,row.operation.operation_id,previous,async()=>{});await check();
     return {status:'returned',provider_succeeded:true,output:{operation_id:claim.run_id,record_id:input.record_id,record_revision:input.record_revision,mirror_state:row.operation?'unknown':observed.outcome==='present'&&canonical(previous)===canonical(row.previous)?'synced':'conflict',automatic_retry:false,limitations_json:JSON.stringify({limitations:observed.limitations,recovery:'inspect_only',original_effect_replayed:false,observed:observed.outcome,...(!known?{unlocated_create:previous===null,original_content_match:observed.recovery_match==='matched',recovery_match:observed.recovery_match}:{}),...(row.operation?{original_operation_id:row.operation.operation_id}:{})})}};
    }finally{observed?.mime_bytes?.fill(0);recoveryMime?.fill(0);}
   }
   const accepted=row.accepted_send;if(deleting){if(!snapshot.identity.recovery?.accepted_send||canonical(snapshot.identity.recovery.accepted_send)!==canonical(accepted)||!accepted||canonical(row.previous)!==canonical(accepted.previous)||canonical(row.synced_desired)!==canonical(accepted.mirror_desired)||record.send_effect?.state!=='accepted'||record.send_effect.run_id!==input.accepted_submission_id||!['submitted','archived'].includes(record.status)||record.content_digest!==accepted.content_digest||accepted.run_id!==input.accepted_submission_id||accepted.snapshot_id!==input.accepted_snapshot_id||'sha256:'+accepted.snapshot_digest!==input.accepted_snapshot_digest)fail('EMAIL_MIRROR_CLEANUP_DENIED');}else if(record.status!=='draft'||record.revision<input.record_revision)fail('EMAIL_MIRROR_LOCAL_CHANGED');
   if(!deleting&&(row.desired.snapshot_id!==input.snapshot_id||row.desired.snapshot_digest!==input.snapshot_digest.slice(7)||row.desired.content_digest!==input.content_digest.slice(7)))fail('EMAIL_MIRROR_SNAPSHOT_DENIED');
   await mirrors.reserve(scope,input.record_id,{operation_id:claim.run_id,run_id:claim.run_id,authority_digest:input.mirror_policy_digest.slice(7),operation:input.mirror_operation},check);reserved=true;
   const bridge=createNativeEmailBridge({store,selected:session.binding,clients:{[provider]:client},custody:fencedCustody,accountFromRecord,now,fetch:async(url,options={})=>{await check();await assertNoCredentialRepair({store,scope:session.scope});return fetchImpl(url,{...options,signal:AbortSignal.any([combined,options.signal].filter(Boolean))});}}),previous=row.previous;
   const nomination={operation:input.mirror_operation,operation_id:claim.run_id,...(previous?{provider_draft_ref:previous.provider_draft_ref,baseline_digest:previous.baseline_digest,provider_version:previous.provider_version}:{}),...(deleting?{}:{desired:{mime_bytes:Buffer.from(snapshot.mime_bytes,'base64url'),mime_digest:snapshot.identity.mime_digest}})};
   let result;try{result=await bridge.nativeEmailDraftSync(nomination,{org_id:scope.org_id,owner_user_id:scope.owner_user_id,account_id:scope.account_id,installation_id:session.scope.installation_id,resource_binding_id:session.scope.resource_binding_id,authority_version:input_digest,expires_at:operationDeadline,recheck:check,signal:combined,owner_capabilities:['read','modify'],draft_sync_journal:graphJournal(store,scope,claim.run_id,input_digest),draft_sync_before_effect:async effect=>{await check();const current=await drafts.read(scope,input.record_id,check);if((deleting?(!['submitted','archived'].includes(current.status)||current.send_effect?.state!=='accepted'||current.send_effect.run_id!==input.accepted_submission_id||current.content_digest!==accepted.content_digest):current.status!=='draft')||effect.operation_id!==claim.run_id||effect.account_id!==scope.account_id)return false;providerStarted=true;return true;}});}finally{nomination.desired?.mime_bytes.fill(0);}
   const state=['created','updated','deleted'].includes(result.outcome)?'synced':result.outcome==='unsupported'?'unsupported':['conflict','missing'].includes(result.outcome)?'conflict':'unknown',retained=(({mime_bytes,...metadata})=>metadata)(result),baseline=state==='synced'&&!deleting?{provider_draft_ref:result.provider_draft_ref,baseline_digest:result.baseline_digest,provider_version:result.provider_version}:null;result.mime_bytes?.fill(0);
   await mirrors.settle(scope,input.record_id,claim.run_id,{state,previous:baseline,provider_result:retained},async()=>{});await check();
   return state==='unknown'?{status:'indeterminate'}:{status:'returned',provider_succeeded:state==='synced',output:{operation_id:claim.run_id,record_id:input.record_id,record_revision:input.record_revision,mirror_state:deleting&&state==='synced'?'cleaned':state,automatic_retry:false,limitations_json:JSON.stringify(result.limitations)}};
  }catch(error){if(reserved){try{await mirrors.settle(scope,input.record_id,claim.run_id,{state:providerStarted?'unknown':'unsupported'},async()=>{});}catch{}return providerStarted?{status:'indeterminate'}:{status:'not_attempted',error_code:'APP_RUN_PROVIDER_UNAVAILABLE'};}throw error;}finally{clearTimeout(timer);}
 }
 return Object.freeze({executeClaim});
}




