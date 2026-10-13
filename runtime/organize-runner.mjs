import {assertNoCredentialRepair,wrapCredentialProviderBridge} from './credential-repair-reservation.mjs';
import {executeManualRule,currentRulePins,ruleScope} from './rules-runtime.mjs';
import {imapOrganizePurpose} from './imap-resource-triage.mjs';
import {currentImapOwnedSource} from './imap-owned-source.mjs';
import {createEncryptedEmailCustody} from './vendor/providers/custody-encrypted.mjs';
import {oauthClientFingerprint,validateOAuthClient} from './vendor/providers/oauth-provider.mjs';
import {createResourcePlanStore,RESOURCE_PLAN_INPUT_KEYS,RESOURCE_PLAN_RELEASE_KEYS,ORGANIZE_OPERATIONS} from './resource-plan-store.mjs';
import {createResourceTriage} from './resource-triage.mjs';
import {createOrganizeCatalogPorts} from './organize-catalog-ports.mjs';
import {createFolderCatalogStore} from './folder-catalog-store.mjs';
import {grantedOAuthCapabilities} from './vendor/providers/oauth-provider.mjs';
import {validateEmailAccount} from './vendor/account-registry.mjs';
import {folderManagementOperation,executeFolderManagement} from './folder-management.mjs';
import {createMailboxStore,resourceView} from './mailbox-store.mjs';
import {createOwnedSourceResolver} from './account-lineage.mjs';
import {purposeFor} from './purpose-set.mjs';
import {canonical,digest,exact,fail,opaque} from './contract.mjs';
import {uuid} from './draft-store.mjs';

const unknown=()=>({status:'indeterminate'});
// Leave time for the durable receipt and Host result callback under the same
// lease. This reserve grants no authority and is never spent on provider work.
const COMPLETION_RESERVE_MS=10000;
/** Only a released exact App Runtime claim can dispatch a prepared plan. The
 * entire plan is reserved first; process loss never resumes remaining items. */
export function createOrganizeRunner({runtime_client,registration,client,provider='gmail',forms,connector,store,encryption_key,key_id,fetch:fetchImpl=globalThis.fetch,now=Date.now,onPhase}){
 exact(registration,['org_id','runtime_registration_id','runtime_epoch']);const formMode=provider==='imap_smtp';if(formMode&&(!forms||!connector))fail('EMAIL_RESOURCE_ACTION_CHANNEL_DENIED');if(!formMode)client=validateOAuthClient(provider,client);
 if(!uuid(registration.org_id)||!uuid(registration.runtime_registration_id)||!Number.isSafeInteger(registration.runtime_epoch)||registration.runtime_epoch<0||typeof runtime_client?.authorize!=='function')fail('EMAIL_RESOURCE_ACTION_CHANNEL_DENIED');
 const fingerprint=formMode?'credential_form.v1':oauthClientFingerprint(provider,client),custody=formMode?null:createEncryptedEmailCustody({store,encryption_key,key_id,now}),plans=createResourcePlanStore({store,now}),mailbox=createMailboxStore({store,now});
 async function executeClaim(claim,started,signal){
  if(!uuid(claim?.run_id)||!uuid(claim.attempt_id)||claim.operation_name!=='organize_messages'||started.run_id!==claim.run_id||started.attempt_id!==claim.attempt_id)fail('EMAIL_RESOURCE_ACTION_CLAIM_DENIED');exact(started.input,RESOURCE_PLAN_RELEASE_KEYS);
  const input=structuredClone(started.input),input_digest='sha256:'+digest(input);
  if(input.resource_action_version!=='deft.app_prepared_resource_action.v1'||input.resource_store_key!=='drafts'||!Object.hasOwn(ORGANIZE_OPERATIONS,input.operation_key)||!opaque(input.account_ref)||['snapshot_id','connection_session_id','data_consent_id'].some(key=>!uuid(input[key]))||['source_manifest_digest','plan_digest','data_consent_digest','prepared_digest'].some(key=>!/^sha256:[a-f0-9]{64}$/u.test(input[key]??''))||!Number.isSafeInteger(input.item_count)||input.item_count<1||input.item_count>25||!Number.isSafeInteger(input.connection_revision)||input.connection_revision<1||input.plan_digest!==input.prepared_digest)fail('EMAIL_RESOURCE_ACTION_INPUT_DENIED');
  const expiry=new AbortController(),combined=AbortSignal.any([signal,expiry.signal].filter(Boolean));const renewable=input.item_count>1||input.operation_key==='manual_rule',maxOperationMs=renewable?300000:60000,completionReserveMs=renewable?0:COMPLETION_RESERVE_MS,operationStarted=performance.now();let completing=false,live=true,authorityDeadline=Math.min(Date.parse(claim.lease_expires_at),Date.parse(started.lease_expires_at)),operationDeadline=now()+maxOperationMs,deadline=Math.min(operationDeadline,authorityDeadline)-completionReserveMs,authority,timer,heartbeatTimer,lastHeartbeat=now(),refresh=Promise.resolve(),reserved=false,scope,value;
  const activeReserve=()=>completing?0:completionReserveMs;
  const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>expiry.abort(),Math.max(0,Math.min(deadline-now(),maxOperationMs-activeReserve()-(performance.now()-operationStarted))));timer.unref();};arm();
  // Held credential custody rereads identity under the same session lock.
  // Fresh online authority remains at entry, provider IO and disclosure.
  const custodyFence=async()=>{if(!live||performance.now()-operationStarted>=maxOperationMs-activeReserve())fail('EMAIL_RESOURCE_ACTION_AUTHORITY_DENIED');combined.throwIfAborted();if(!Number.isFinite(deadline)||now()>=deadline)fail('EMAIL_RESOURCE_ACTION_AUTHORITY_DENIED');};
  const waitCurrent=promise=>new Promise((resolve,reject)=>{const cleanup=()=>combined.removeEventListener('abort',stopped),stopped=()=>{cleanup();reject(combined.reason??new Error('EMAIL_RESOURCE_ACTION_AUTHORITY_DENIED'));};combined.addEventListener('abort',stopped,{once:true});Promise.resolve(promise).then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});if(combined.aborted)stopped();});
  const refreshAuthority=async()=>{await custodyFence();let renewed=false;if(renewable&&now()-lastHeartbeat>=15000&&typeof runtime_client.heartbeat==='function'){if(!await waitCurrent(runtime_client.heartbeat(claim)))fail('EMAIL_RESOURCE_ACTION_AUTHORITY_DENIED');await custodyFence();lastHeartbeat=now();renewed=true;}const current=await waitCurrent(runtime_client.authorize(claim,{signal:combined}));await custodyFence();const nextLease=Date.parse(current.lease_expires_at);if(current.schema_version!=='deft.app_runtime_authority.v1'||current.audience!=='app_runtime'||current.operation_name!==claim.operation_name||current.run_id!==claim.run_id||current.attempt_id!==claim.attempt_id||current.org_id!==registration.org_id||current.runtime_registration_id!==registration.runtime_registration_id||current.runtime_epoch!==registration.runtime_epoch||current.input_digest!==input_digest||canonical(current.input)!==canonical(input)||!Number.isFinite(nextLease)||(!renewed&&nextLease>authorityDeadline)||nextLease<=now())fail('EMAIL_RESOURCE_ACTION_AUTHORITY_DENIED');if(authority){const {lease_expires_at:old,...pins}=authority,{lease_expires_at:next,...fresh}=current;if(canonical(pins)!==canonical(fresh))fail('EMAIL_RESOURCE_ACTION_AUTHORITY_DENIED');}authority=structuredClone(current);authorityDeadline=renewed?nextLease:Math.min(authorityDeadline,nextLease);deadline=Math.min(operationDeadline,authorityDeadline)-activeReserve();arm();};
  const check=()=>{const pending=refresh.then(refreshAuthority);refresh=pending.catch(()=>{});return pending;};
  const beginHeartbeats=()=>{if(!renewable||typeof runtime_client.heartbeat!=='function')return;heartbeatTimer=setInterval(()=>{void check().catch(error=>expiry.abort(error));},15000);heartbeatTimer.unref();};
  const persistOutcome=async(state,result=null)=>{
   const persistReceipt=()=>plans.withSnapshot(scope,input.snapshot_id,async()=>{},async(current,persist)=>{if(current.effect?.run_id!==claim.run_id||current.effect.input_digest!==input_digest)fail('EMAIL_RESOURCE_PLAN_CONFLICT');if(current.state==='settled'){if(state==='settled'&&canonical(current.effect.result)!==canonical(result))fail('EMAIL_RESOURCE_PLAN_CONFLICT');return;}await persist({...current,state,effect:{...current.effect,result}});});
   // Retry only the exact local known receipt once. A failed or lost storage
   // acknowledgement must never dispatch the provider again. Disclosure still
   // requires the fresh authority check below after durable settlement.
   try{await persistReceipt();}catch(error){if(state!=='settled'||!['EIO','EINTR','EAGAIN','EBUSY','ETIMEDOUT'].includes(error?.code))throw error;await persistReceipt();}
  };
  try{
   // Immutable local reads keep the original deadline/abort fences. Fresh
   // online authority still gates reservation, dispatch, each socket and disclosure.
   await check();scope={org_id:authority.org_id,owner_user_id:authority.owner_id,account_id:input.account_ref};value=await plans.read(scope,input.snapshot_id,custodyFence);
   const {identity,prepared}=value;if(prepared.snapshot_digest!==input.prepared_digest||canonical(prepared.input)!==canonical(Object.fromEntries(RESOURCE_PLAN_INPUT_KEYS.map(key=>[key,input[key]])))||prepared.action_key!==claim.operation_name||identity.connection.session_id!==input.connection_session_id||identity.connection.session_revision!==input.connection_revision||identity.authority.consent_id!==input.data_consent_id||identity.authority.consent_digest!==input.data_consent_digest)fail('EMAIL_RESOURCE_PLAN_DENIED');
   const pins={org_id:'org_id',owner_id:'owner_user_id',app_installation_id:'installation_id',app_version_id:'app_version_id',grant_snapshot_id:'grant_snapshot_id',lifecycle_epoch:'lifecycle_epoch',grant_epoch:'grant_epoch'};if(Object.entries(pins).some(([host,local])=>authority[host]!==identity.connection_scope[local]))fail('EMAIL_RESOURCE_ACTION_SCOPE_DENIED');
   if(value.state==='settled'){if(value.effect?.run_id!==claim.run_id||value.effect.input_digest!==input_digest)fail('EMAIL_RESOURCE_ACTION_ALREADY_RESERVED');if(value.effect.result.output.succeeded_count)await mailbox.invalidateContent(scope,async()=>{});await check();return value.effect.result;}
   if(value.state!=='prepared')return unknown();if(Date.parse(prepared.expires_at)<=now())fail('EMAIL_RESOURCE_PLAN_EXPIRED');operationDeadline=Math.min(operationDeadline,Date.parse(prepared.expires_at));deadline=Math.min(operationDeadline,authorityDeadline)-activeReserve();arm();
   const executeSession=async tx=>{
    const session=(await tx.read())?.value;if(!session||session.state!=='connected'||canonical(session.scope)!==canonical(identity.connection_scope)||session.account?.account_ref!==scope.account_id||session.runtime_session_ref!==identity.connection.runtime_session_ref||session.client_fingerprint!==fingerprint||session.binding.provider!==provider)fail('EMAIL_RESOURCE_ACTION_CONNECTION_DENIED');
    const purpose=formMode?imapOrganizePurpose(await tx.currentAccount(),now):purposeFor(session,'organize_messages',now);if(purpose.action_binding_id!==authority.runtime_binding_id||canonical(purpose)!==canonical(identity.purpose))fail('EMAIL_RESOURCE_ACTION_AUTHORITY_DENIED');operationDeadline=Math.min(operationDeadline,Date.parse(purpose.expires_at));deadline=Math.min(operationDeadline,authorityDeadline)-activeReserve();arm();beginHeartbeats();
    const checkLocal=async()=>{await assertNoCredentialRepair({store,scope:identity.connection_scope});combined.throwIfAborted();if(now()>=deadline||canonical(formMode?imapOrganizePurpose(await tx.currentAccount(),now):purposeFor(session,'organize_messages',now))!==canonical(purpose))fail('EMAIL_RESOURCE_ACTION_AUTHORITY_DENIED');const current=session;if(!current||current.state!=='connected'||canonical(current.scope)!==canonical(session.scope)||canonical(current.binding)!==canonical(session.binding)||canonical(current.action_consents)!==canonical(session.action_consents)||current.runtime_session_ref!==session.runtime_session_ref||current.client_fingerprint!==fingerprint)fail('EMAIL_RESOURCE_ACTION_CONNECTION_DENIED');};const heldForms=formMode?{currentAccount:()=>tx.currentAccount()}:null,sourceFor=formMode?record=>currentImapOwnedSource({forms:heldForms,session_id:input.connection_session_id,scope:identity.connection_scope,record,check:checkLocal,store}):createOwnedSourceResolver({store,session,scope,check:checkLocal}),sources=new Map(),observations=identity.operation_key==='undo'?(identity.source_observations??identity.sources):identity.sources;if(observations.length!==identity.sources.length||observations.some((ref,index)=>ref.record_id!==identity.sources[index].record_id||ref.resource_key!==identity.sources[index].resource_key))fail('EMAIL_RESOURCE_PLAN_DENIED');for(const ref of observations){const record=await mailbox.get(scope,ref.record_id,checkLocal);if(resourceView(record).content_digest!==ref.content_digest)fail('EMAIL_DATA_SOURCE_CHANGED');sources.set(record.logical_message_id,await sourceFor(record));}
    const triage=await createResourceTriage({session,forms:heldForms,connector,store,mailbox,custody,client,journal:plans.journal,check,checkLocal,signal:combined,expires_at:deadline,getDeadline:()=>deadline,fetch:async(...args)=>{await assertNoCredentialRepair({store,scope:identity.connection_scope});return fetchImpl(...args);},now,resolveMessage:async logical=>{const source=sources.get(logical);if(!source)fail('EMAIL_RESOURCE_ACTION_SOURCE_DENIED');return source;}});if(triage.custody_generation!==identity.custody_generation)fail('EMAIL_RESOURCE_ACTION_CUSTODY_DENIED');
    const references=prepared.record_refs??[];let catalogPorts;if(references.length){if(formMode)fail('EMAIL_RESOURCE_ACTION_UNSUPPORTED');catalogPorts=createOrganizeCatalogPorts({session,identity,scope,provider,client,custody,now,fetch:async(...args)=>{await assertNoCredentialRepair({store,scope:identity.connection_scope});return fetchImpl(...args);},check,checkLocal,signal:combined,expires_at:deadline,getDeadline:()=>deadline});const catalog=createFolderCatalogStore({store,now});for(const reference of references)await catalog.resolve({...scope,installation_id:identity.connection_scope.installation_id},reference,catalogPorts.read,checkLocal);}
    if(input.operation_key==='manual_rule')await currentRulePins({store,scope:ruleScope(scope,identity.connection_scope.installation_id),parameters:identity.nominations.parameters,expected:value.native_plan.rule_pins,check,checkLocal});
    if(formMode)await tx.reserve();
    const reservation=await plans.reserveRun(scope,input.snapshot_id,{run_id:claim.run_id,attempt_id:claim.attempt_id,input_digest},check);if(!reservation.reserved)return unknown();reserved=true;
    // Invalidate before the first possible effect, including an uncertain or
    // partially completed batch. This advances no observation checkpoint.
    await mailbox.invalidateContent(scope,async()=>{});await onPhase?.('before_dispatch');await check();
    let result;if(folderManagementOperation(input.operation_key)){
     if(formMode)fail('EMAIL_RESOURCE_ACTION_UNSUPPORTED');
     const {bridge,context}=catalogPorts;
     result=await executeFolderManagement({plan:value.native_plan,bridge,context,check:triage.check});
    }else if(input.operation_key==='manual_rule'){const records=[];for(const ref of identity.sources){const record=await mailbox.get(scope,ref.record_id,checkLocal);if(resourceView(record).content_digest!==ref.content_digest)fail('EMAIL_DATA_SOURCE_CHANGED');records.push(record);}result=await executeManualRule({store,scope:ruleScope(scope,identity.connection_scope.installation_id),plan:value.native_plan,parameters:identity.nominations.parameters,records,triage,journal:plans.journal,updateSource:async(record,after)=>{if(after?.locator){const source=sources.get(record.logical_message_id);sources.set(record.logical_message_id,{...source,locator:after.locator});}},check,checkLocal});}else result=await triage.service.execute({scope:triage.scope,operation_id:input.snapshot_id,expected_digest:value.native_plan.digest});
    if(result.items.some(item=>item.state==='unknown'||item.state==='started')){await persistOutcome('unknown');return unknown();}
    if(input.operation_key!=='manual_rule')await triage.reconcile?.(input.snapshot_id);
    const reviewedSources=[...identity.sources,...(identity.nominations?.record_sources??[])],counts={succeeded:0,failed:0};const items=result.items.map((item,index)=>{if(!['succeeded','failed'].includes(item.state)||item.logical_id!==value.native_plan.items[index].logical_id||!uuid(reviewedSources[index]?.record_id))fail('EMAIL_RESOURCE_ACTION_RESULT_DENIED');counts[item.state]++;return {record_id:reviewedSources[index].record_id,state:item.state};});
    const items_json=JSON.stringify(items);if(items.length!==input.item_count||new Set(items.map(item=>item.record_id)).size!==items.length||Buffer.byteLength(items_json)>2048||counts.succeeded+counts.failed!==items.length)fail('EMAIL_RESOURCE_ACTION_RESULT_DENIED');
    const output={operation_id:claim.run_id,operation_key:input.operation_key,item_count:items.length,succeeded_count:counts.succeeded,failed_count:counts.failed,items_json,automatic_retry:false,actions_json:JSON.stringify(input.operation_key==='manual_rule'?result.actions:[])},publicResult={status:'returned',provider_succeeded:input.operation_key==='manual_rule'?counts.failed===0&&counts.succeeded===items.length&&result.actions.length===items.length*value.native_plan.rule_pins.actions.length&&result.actions.every(action=>action.state==='succeeded'):counts.succeeded>0,output};
    // Provider effects may already exist when authority is withdrawn. Persist
    // their bounded receipt first; disclosure still requires current authority.
    await persistOutcome('settled',publicResult);
    // Provider work is finished and its exact known receipt is durable. Only
    // local completion and fresh disclosure authority may consume the reserve.
    completing=true;deadline=Math.min(operationDeadline,authorityDeadline);arm();
    if(counts.succeeded)await mailbox.invalidateContent(scope,async()=>{});if(formMode)await tx.releaseKnown();await triage.check();return publicResult;
   };
   return formMode?await forms.withEffectSession(identity.connection,identity.connection_scope,claim.run_id,custodyFence,async held=>executeSession({...held,read:async()=>({value:{state:'connected',scope:identity.connection_scope,runtime_session_ref:identity.connection.runtime_session_ref,account:{account_ref:scope.account_id},binding:{provider:'imap_smtp'},client_fingerprint:fingerprint}})})):await store.withLock({key:'email.runtime.session.'+input.connection_session_id},executeSession);
  }catch(error){if(reserved){try{await persistOutcome('unknown');}catch{}return unknown();}throw error;}finally{live=false;clearTimeout(timer);clearInterval(heartbeatTimer);expiry.abort(new Error('EMAIL_RESOURCE_ACTION_EXECUTION_ENDED'));}
 }
 return Object.freeze({executeClaim});
}



