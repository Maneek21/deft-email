import {parseResourceSyncStartForClaimV3,parseSyncPageV2,ResourceObservationAuthorityResultSchema} from '@deft/app-kit';
import {createNativeEmailBridge} from './vendor/providers/native-mailbox.mjs';
import {createEncryptedEmailCustody} from './vendor/providers/custody-encrypted.mjs';
import {grantedOAuthCapabilities,validateOAuthClient,oauthClientFingerprint} from './vendor/providers/oauth-provider.mjs';
import {validateEmailAccount} from './vendor/account-registry.mjs';
import {assertEmailMetadataDescriptor} from './vendor/metadata-resource.mjs';
import {createMailboxStore} from './mailbox-store.mjs';
import {lineageKey,validateLineage} from './account-lineage.mjs';
import {canonical,digest,exact,fail,validateScope,validateRegistration} from './contract.mjs';

const accountFromRecord=(binding,record)=>{if(!record?.secret?.identity||record.health!=='connected')return null;const identity=record.secret.identity;return validateEmailAccount({account_id:binding.account_id,provider:binding.provider,display_label:identity.display_label,primary_address:identity.primary_address,verified_sender_identities:[...identity.verified_sender_identities],capabilities:grantedOAuthCapabilities(binding,record.secret.scopes),connection_target:binding.connection_target,resource_binding_id:binding.resource_binding_id,action_binding_id:binding.action_binding_id,authority_epoch:binding.authority_epoch,health:'connected'});};
const scopeClaim={org_id:'org_id',installation_id:'app_installation_id',app_version_id:'app_version_id',grant_snapshot_id:'grant_snapshot_id',lifecycle_epoch:'lifecycle_epoch',grant_epoch:'grant_epoch',runtime_registration_id:'runtime_registration_id',runtime_epoch:'runtime_epoch',resource_binding_id:'resource_binding_id'};
const unknown=()=>({status:'indeterminate'});

/** One public v3 observation Run. No scheduler, owner token, action, MIME or
 * attachment stage is introduced. Restart recovery never repeats provider I/O. */
export function createResourceObservationRunner({runtime_client,observation_client,registration,client,store,encryption_key,key_id,fetch:fetchImpl=globalThis.fetch,now=Date.now,onPhase}){
 registration=validateRegistration(registration);client=validateOAuthClient('gmail',client);
 if(['claim','start','heartbeat','result'].some(method=>typeof runtime_client?.[method]!=='function')||typeof observation_client?.authorize!=='function')fail('EMAIL_OBSERVATION_CONFIG_INVALID');
 const fingerprint=oauthClientFingerprint('gmail',client),custody=createEncryptedEmailCustody({store,encryption_key,key_id,now}),mailbox=createMailboxStore({store,now});
 async function executeClaim(claim,rawStarted,signal,emit){
  const started=await parseResourceSyncStartForClaimV3(claim,rawStarted);await assertEmailMetadataDescriptor(started.descriptor,claim.descriptor_digest);
  if(claim.org_id!==registration.org_id||claim.runtime_registration_id!==registration.runtime_registration_id||claim.runtime_epoch!==registration.runtime_epoch)fail('EMAIL_OBSERVATION_SCOPE_DENIED');
  const expiry=new AbortController(),combined=AbortSignal.any([signal,expiry.signal].filter(Boolean)),operationDeadline=now()+30000;let lease=Math.min(Date.parse(claim.lease_expires_at),Date.parse(started.lease_expires_at)),deadline=Math.min(lease,operationDeadline),authority,timer;
  const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>expiry.abort(new Error('EMAIL_OBSERVATION_EXPIRED')),Math.max(0,deadline-now()));timer.unref();};
  const local=()=>{combined.throwIfAborted();if(!Number.isFinite(deadline)||deadline<=now())fail('EMAIL_OBSERVATION_AUTHORITY_DENIED');};arm();
  let heartbeatPending=null;
  const check=async()=>{local();if(lease-now()<10000){if(!heartbeatPending)heartbeatPending=runtime_client.heartbeat(claim,{signal:combined}).then(value=>{const next=Date.parse(value);if(!Number.isFinite(next)||next<=now())fail('EMAIL_OBSERVATION_AUTHORITY_DENIED');lease=next;}).finally(()=>{heartbeatPending=null;});await heartbeatPending;local();}const value=ResourceObservationAuthorityResultSchema.parse(await observation_client.authorize(claim,{signal:combined}));local();
   const expected={schema_version:'deft.app_resource_observation_authority.v1',audience:'app_resource_sync',session_id:claim.session_id,run_id:claim.run_id,attempt_id:claim.attempt_id,claim_token:claim.claim_token,sequence:claim.sequence};
   if(Object.keys(expected).some(field=>value[field]!==expected[field])||value.allowed!==true||!/^sha256:[a-f0-9]{64}$/u.test(value.consent_digest??'')||!Number.isFinite(Date.parse(value.expires_at))||Date.parse(value.expires_at)>now()+15000||Date.parse(value.expires_at)<=now())fail('EMAIL_OBSERVATION_AUTHORITY_DENIED');
   const snapshot=value.snapshot;exact(snapshot,['schema_version','consent_id','scope','connection','resource_policy_digest','interval_seconds','expires_at']);validateScope(snapshot.scope);
   exact(snapshot.connection,['session_id','runtime_session_ref','account_ref','expected_custody_generation','receipt_digest']);
   if(snapshot.schema_version!=='deft.app_resource_observation_consent.v1'||'sha256:'+digest(snapshot)!==value.consent_digest||Object.entries(scopeClaim).some(([scopeField,claimField])=>snapshot.scope[scopeField]!==claim[claimField])||Object.keys(registration).some(field=>registration[field]!==snapshot.scope[field])||Date.parse(value.expires_at)>Date.parse(snapshot.expires_at)||Date.parse(snapshot.expires_at)>Date.parse(snapshot.scope.consent_expires_at))fail('EMAIL_OBSERVATION_AUTHORITY_DENIED');
   if(authority&&(authority.consent_digest!==value.consent_digest||canonical(authority.snapshot)!==canonical(snapshot)))fail('EMAIL_OBSERVATION_AUTHORITY_DENIED');
   authority=value;deadline=Math.min(operationDeadline,lease,Date.parse(value.expires_at),Date.parse(snapshot.expires_at));arm();return deadline;
  };
  try{await check();const snapshot=structuredClone(authority.snapshot),connection=snapshot.connection,scope={org_id:snapshot.scope.org_id,owner_user_id:snapshot.scope.owner_user_id,account_id:connection.account_ref};
   const journalKey='email.data.request.'+digest(['email.observation.v1',registration,claim.run_id]);
   return await store.withLock({key:journalKey},async jtx=>{
    let row=await jtx.read();const pins={claim,started,snapshot,consent_digest:authority.consent_digest};
    // Lease timestamps may renew, but all released identity/input pins remain exact.
    const stable=({claim,started,...rest})=>{const {lease_expires_at:a,...c}=claim,{lease_expires_at:b,...s}=started;return {...rest,claim:c,started:s};};
    if(row&&canonical(stable(row.value.pins))!==canonical(stable(pins)))fail('EMAIL_OBSERVATION_RUN_DENIED');
    const persist=async value=>{if(!await jtx.compareAndSwap({expected_revision:row?.revision??null,value}))fail('EMAIL_OBSERVATION_CONFLICT');row=await jtx.read();};
    return store.withLock({key:'email.runtime.session.'+connection.session_id},async stx=>{
     const session=(await stx.read())?.value;
     const checkLocal=()=>{local();if(!session||session.state!=='connected'||canonical(session.scope)!==canonical(snapshot.scope)||session.runtime_session_ref!==connection.runtime_session_ref||session.account?.account_ref!==connection.account_ref||session.binding.account_id!==connection.account_ref||session.client_fingerprint!==fingerprint)fail('EMAIL_OBSERVATION_CONNECTION_DENIED');};
     const current=async()=>{await check();checkLocal();};await current();
     const record=await custody.withAccount(session.binding,tx=>tx.read());
     if(!record||record.health!=='connected'||canonical(record.binding)!==canonical(session.binding)||record.secret?.client_fingerprint!==fingerprint||!grantedOAuthCapabilities(session.binding,record.secret.scopes).includes('read'))fail('EMAIL_OBSERVATION_CUSTODY_DENIED');
     const generation=record.setup_generation;
     const lineage=(await store.withLock({key:lineageKey(session.binding)},tx=>tx.read()))?.value;
     if(connection.expected_custody_generation!==null){validateLineage(lineage,session);if(generation!==connection.expected_custody_generation||lineage.current.custody_generation!==generation||lineage.current.receipt_digest!==connection.receipt_digest)fail('EMAIL_OBSERVATION_CUSTODY_DENIED');}
     else if(connection.receipt_digest!==null||lineage)fail('EMAIL_OBSERVATION_CUSTODY_DENIED');
     const checkCustody=()=>custody.withAccount(session.binding,tx=>{checkLocal();const value=tx.read();if(!value||value.health!=='connected'||value.setup_generation!==generation||canonical(value.binding)!==canonical(session.binding)||value.secret?.client_fingerprint!==fingerprint)fail('EMAIL_OBSERVATION_CUSTODY_DENIED');});
     const disclose=async result=>{await current();await checkCustody();await current();if(emit)await emit(result,combined);return result;};
     if(row){if(row.value.custody_generation!==generation)return disclose(unknown());if(row.value.state!=='completed')return disclose(unknown());return disclose({status:'returned',provider_succeeded:true,page:parseSyncPageV2(started.descriptor,started.input,row.value.page)});}
     await current();await persist({schema_version:'email.app_observation_run.v1',pins,custody_generation:generation,state:'started'});
     // Decorate the frozen native custody reads, including reads under refresh
     // locks. This checks generation without recursive account-lock acquisition.
     const fencedCustody={...custody,withAccount(binding,work){return custody.withAccount(binding,tx=>work({...tx,read(){checkLocal();const value=tx.read();if(!value||value.setup_generation!==generation||canonical(value.binding)!==canonical(session.binding))fail('EMAIL_OBSERVATION_CUSTODY_DENIED');return value;}}));}};
     const bridge=createNativeEmailBridge({selected:session.binding,clients:{gmail:client},custody:fencedCustody,accountFromRecord,now,fetch:async(url,options={})=>{await current();return fetchImpl(url,{...options,signal:AbortSignal.any([combined,options.signal].filter(Boolean))});}});
     const context={org_id:scope.org_id,owner_user_id:scope.owner_user_id,account_id:scope.account_id,installation_id:snapshot.scope.installation_id,resource_binding_id:snapshot.scope.resource_binding_id,authority_version:authority.consent_digest,expires_at:Math.min(operationDeadline,lease,Date.parse(snapshot.expires_at)),recheck:current,signal:combined,owner_capabilities:['read'],provider_state:await mailbox.providerState(scope,current)};
     try{await onPhase?.('before_provider',{run_id:claim.run_id});const page=await bridge.nativeEmailPage({cursor:started.input.cursor,limit:Math.min(25,started.input.max_items)},context);
      const result=parseSyncPageV2(started.descriptor,started.input,{schema_version:'deft.app_sync_page.v2',upserts:page.items.map(item=>({id:item.logical_message_id,revision:item.revision,data:item.data,attachments:[]})),tombstones:(page.tombstones??[]).map(id=>({id,revision:String(generation)})),next_cursor:page.next_cursor,has_more:page.has_more});
      await onPhase?.('before_checkpoint',{run_id:claim.run_id});await current();await checkCustody();await mailbox.commit(scope,page,current,{localCheck:checkLocal});await checkCustody();await current();
      await persist({schema_version:'email.app_observation_run.v1',pins,custody_generation:generation,state:'completed',page:result});await onPhase?.('before_disclosure',{run_id:claim.run_id});return await disclose({status:'returned',provider_succeeded:true,page:result});
     }catch(error){if(row.value.state==='completed')throw error;await persist({...row.value,state:'indeterminate'});return disclose(unknown());}
    });
   });
  }finally{clearTimeout(timer);}
 }
 return Object.freeze({executeClaim,async runOnce(signal){const claim=await runtime_client.claim({signal});if(!claim)return null;let started,result;try{started=await runtime_client.start(claim,{signal});result=await executeClaim(claim,started,signal,(value,currentSignal)=>runtime_client.result(claim,started,value,{signal:currentSignal}));}catch{result={status:'indeterminate'};}
  return result;
 }});
}
