import {assertNativeSessionVisible} from './native-adoption-activation.mjs';
import {assertNoCredentialRepair,wrapCredentialProviderBridge} from './credential-repair-reservation.mjs';
import {createNativeIdentityScopeResolver} from './native-adoption-identity.mjs';
import {createImapReadPorts} from './imap-runtime-ports.mjs';
import {parseResourceSyncStartForClaimV3,parseSyncPageV2,ResourceObservationAuthorityResultSchema} from '@deft/app-kit';
import {createNativeEmailBridge as createUnfencedNativeEmailBridge} from './vendor/providers/native-mailbox.mjs';
const createNativeEmailBridge=options=>wrapCredentialProviderBridge({bridge:createUnfencedNativeEmailBridge(options),store:options.store,scope:{...options.selected.scope,resource_binding_id:options.selected.resource_binding_id}});
import {createEncryptedEmailCustody} from './vendor/providers/custody-encrypted.mjs';
import {grantedOAuthCapabilities,validateOAuthClient,oauthClientFingerprint} from './vendor/providers/oauth-provider.mjs';
import {validateEmailAccount} from './vendor/account-registry.mjs';
import {assertIntegrationSourceDescriptor,integrationSourceProjection} from './integration-source.mjs';
import {createMailboxStore} from './mailbox-store.mjs';
import {createSyncPublication} from './sync-publication.mjs';
import {lineageKey,validateLineage} from './account-lineage.mjs';
import {consentFields,consentDeadline,canonical,digest,exact,fail,validateScope,validateRegistration} from './contract.mjs';

const accountFromRecord=(binding,record)=>{if(!record?.secret?.identity||record.health!=='connected')return null;const identity=record.secret.identity;return validateEmailAccount({account_id:binding.account_id,provider:binding.provider,display_label:identity.display_label,primary_address:identity.primary_address,verified_sender_identities:[...identity.verified_sender_identities],capabilities:grantedOAuthCapabilities(binding,record.secret.scopes),connection_target:binding.connection_target,resource_binding_id:binding.resource_binding_id,action_binding_id:binding.action_binding_id,authority_epoch:binding.authority_epoch,health:'connected'});};
const scopeClaim={org_id:'org_id',installation_id:'app_installation_id',app_version_id:'app_version_id',grant_snapshot_id:'grant_snapshot_id',lifecycle_epoch:'lifecycle_epoch',grant_epoch:'grant_epoch',runtime_registration_id:'runtime_registration_id',runtime_epoch:'runtime_epoch',resource_binding_id:'resource_binding_id'};
const unknown=()=>({status:'indeterminate'});
import {observationDiagnosticCodes as diagnosticCodes} from './observation-diagnostics.mjs';
// Closed public transport codes, never exception messages or response contents.
const channelCodes=new Set(['APP_RESOURCE_SYNC_DISABLED','APP_RESOURCE_SYNC_ACCESS_DENIED','APP_RESOURCE_SYNC_INVALID_REQUEST','APP_RESOURCE_SYNC_TOO_LARGE','APP_RESOURCE_SYNC_TIMEOUT','APP_RESOURCE_SYNC_FAILURE','APP_RESOURCE_SYNC_ABORTED','APP_RESOURCE_SYNC_INVALID_RESPONSE','APP_RESOURCE_SYNC_RESPONSE_TOO_LARGE']);
const channelDiagnostic=error=>channelCodes.has(error?.code)&&Number.isInteger(error?.status)&&error.status>=0&&error.status<=599?{code:error.code,http_status:error.status}:null;

/** Share one claim cadence across retained channels. Empty/expired channels
 * cannot consume the peer budget reserved for an active Run's start/result. */
export function createResourceObservationPoller(runners){
 if(!Array.isArray(runners)||runners.length<1||runners.length>32||runners.some(r=>typeof r?.runOnce!=='function'))fail('EMAIL_OBSERVATION_CONFIG_INVALID');
 let next=0;
 return Object.freeze({runOnce(signal){const runner=runners[next];next=(next+1)%runners.length;return runner.runOnce(signal);}});
}

/** One public v3 observation Run. No scheduler, owner token, action, MIME or
 * attachment stage is introduced. Restart recovery never repeats provider I/O. */
export function createResourceObservationRunner({runtime_client,observation_client,registration,client,provider='gmail',forms,imapConnector,store,encryption_key,key_id,fetch:fetchImpl=globalThis.fetch,now=Date.now,onPhase,repairContinuity,onDiagnostic=event=>console.info(JSON.stringify(event))}){
 const formMode=provider==='imap_smtp';if(formMode&&(!forms||!imapConnector||client)||!formMode&&forms)fail('EMAIL_OBSERVATION_CONFIG_INVALID');const {connection_protocol,...registrationPins}=registration;registration=validateRegistration(registrationPins);if(!formMode)client=validateOAuthClient(provider,client);
 if(['claim','start','heartbeat','result'].some(method=>typeof runtime_client?.[method]!=='function')||typeof observation_client?.authorize!=='function')fail('EMAIL_OBSERVATION_CONFIG_INVALID');
 const fingerprint=formMode?'credential_form.v1':oauthClientFingerprint(provider,client),custody=formMode?null:createEncryptedEmailCustody({store,encryption_key,key_id,now}),mailbox=createMailboxStore({store,now}),publication=createSyncPublication({store,mailbox,repairContinuity});
 async function executeClaim(claim,rawStarted,signal,emit){
  let started,sourceMapping;try{started=await parseResourceSyncStartForClaimV3(claim,rawStarted);sourceMapping=await assertIntegrationSourceDescriptor(started.descriptor,claim.descriptor_digest);}catch(error){try{onDiagnostic?.({event:'email_observation_failure',run_id:claim.run_id,phase:'release_parse',code:diagnosticCodes.has(error?.code)?error.code:'OPAQUE_LOCAL_ERROR',elapsed_ms:0,authority_calls:0,provider_calls:0});}catch{}throw error;}
  if(claim.org_id!==registration.org_id||claim.runtime_registration_id!==registration.runtime_registration_id||claim.runtime_epoch!==registration.runtime_epoch)fail('EMAIL_OBSERVATION_SCOPE_DENIED');
  const began=performance.now();let phase='authority',authorityCalls=0,providerCalls=0,diagnosed=false;const diagnose=error=>{if(diagnosed)return;diagnosed=true;const expired=expiry.signal.aborted||deadline<=now(),code=expired?'EMAIL_OBSERVATION_EXPIRED':combined.aborted?'EMAIL_OBSERVATION_CANCELLED':diagnosticCodes.has(error?.code)?error.code:'OPAQUE_LOCAL_ERROR';try{onDiagnostic?.({event:'email_observation_failure',run_id:claim.run_id,phase,code,...(!expired&&!combined.aborted?channelDiagnostic(error):null),elapsed_ms:Math.round(performance.now()-began),authority_calls:authorityCalls,provider_calls:providerCalls});}catch{}};
  const expiry=new AbortController(),combined=AbortSignal.any([signal,expiry.signal].filter(Boolean)),operationDeadline=now()+30000;let lease=Math.min(Date.parse(claim.lease_expires_at),Date.parse(started.lease_expires_at)),deadline=Math.min(lease,operationDeadline),authority,timer;
  const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>expiry.abort(new Error('EMAIL_OBSERVATION_EXPIRED')),Math.max(0,deadline-now()));timer.unref();};
  const local=()=>{combined.throwIfAborted();if(!Number.isFinite(deadline)||deadline<=now())fail('EMAIL_OBSERVATION_AUTHORITY_DENIED');};arm();
  let heartbeatPending=null;
  let authorityQueue=Promise.resolve(),authorityFailure=null;
  const onlineCheck=async()=>{local();authorityCalls++;if(lease-now()<10000){if(!heartbeatPending)heartbeatPending=runtime_client.heartbeat(claim,{signal:combined}).then(value=>{const next=Date.parse(value);if(!Number.isFinite(next)||next<=now())fail('EMAIL_OBSERVATION_AUTHORITY_DENIED');lease=next;}).finally(()=>{heartbeatPending=null;});await heartbeatPending;local();}const value=ResourceObservationAuthorityResultSchema.parse(await observation_client.authorize(claim,{signal:combined}));local();
   const expected={schema_version:'deft.app_resource_observation_authority.v1',audience:'app_resource_sync',session_id:claim.session_id,run_id:claim.run_id,attempt_id:claim.attempt_id,claim_token:claim.claim_token,sequence:claim.sequence};
   if(Object.keys(expected).some(field=>value[field]!==expected[field])||value.allowed!==true||!/^sha256:[a-f0-9]{64}$/u.test(value.consent_digest??'')||!Number.isFinite(Date.parse(value.expires_at))||Date.parse(value.expires_at)>now()+15000||Date.parse(value.expires_at)<=now())fail('EMAIL_OBSERVATION_AUTHORITY_DENIED');
   const snapshot=value.snapshot;exact(snapshot,['schema_version','consent_id','scope','connection','resource_policy_digest','interval_seconds','expires_at',...consentFields(snapshot),...(snapshot.consent_lifetime==='until_revoked'?['review_expires_at']:[])]);validateScope(snapshot.scope);
   exact(snapshot.connection,['session_id','runtime_session_ref','account_ref','expected_custody_generation','receipt_digest']);
   if(snapshot.schema_version!=='deft.app_resource_observation_consent.v1'||'sha256:'+digest(snapshot)!==value.consent_digest||Object.entries(scopeClaim).some(([scopeField,claimField])=>snapshot.scope[scopeField]!==claim[claimField])||Object.keys(registration).some(field=>registration[field]!==snapshot.scope[field])||Date.parse(value.expires_at)>consentDeadline(snapshot)||consentDeadline(snapshot)>consentDeadline(snapshot.scope,'consent_expires_at'))fail('EMAIL_OBSERVATION_AUTHORITY_DENIED');
   if(authority&&(authority.consent_digest!==value.consent_digest||canonical(authority.snapshot)!==canonical(snapshot)))fail('EMAIL_OBSERVATION_AUTHORITY_DENIED');
   authority=value;deadline=Math.min(operationDeadline,lease,Date.parse(value.expires_at),consentDeadline(snapshot));arm();return deadline;
  };
  // Each queued call performs its own current-authority check; no lease caching.
  const check=()=>{const work=authorityQueue.then(async()=>{local();if(authorityFailure)throw authorityFailure;try{return await onlineCheck();}catch(error){authorityFailure=error;diagnose(error);throw error;}});authorityQueue=work.then(()=>undefined,()=>undefined);return work;};
  try{await check();phase='custody';const snapshot=structuredClone(authority.snapshot),connection=snapshot.connection,scope={org_id:snapshot.scope.org_id,owner_user_id:snapshot.scope.owner_user_id,account_id:connection.account_ref};
   // Match data-runtime lock order: activation visibility before session lock.
   const visibleSession=formMode?null:(await store.withLock({key:'email.runtime.session.'+connection.session_id},tx=>tx.read()))?.value;
   if(!formMode)await assertNativeSessionVisible({store,session:visibleSession});
   const journalKey='email.data.request.'+digest(['email.observation.v1',registration,claim.run_id]);
   return await store.withLock({key:journalKey},async jtx=>{
    let row=await jtx.read();const pins={claim,started,snapshot,consent_digest:authority.consent_digest};
    // Lease timestamps may renew, but all released identity/input pins remain exact.
    const stable=({claim,started,...rest})=>{const {lease_expires_at:a,...c}=claim,{lease_expires_at:b,...s}=started;return {...rest,claim:c,started:s};};
    if(row&&canonical(stable(row.value.pins))!==canonical(stable(pins)))fail('EMAIL_OBSERVATION_RUN_DENIED');
    const persist=async value=>{if(!await jtx.compareAndSwap({expected_revision:row?.revision??null,value}))fail('EMAIL_OBSERVATION_CONFLICT');row=await jtx.read();};
    const withSession=work=>formMode?forms.withDataSession(connection,snapshot.scope,local,work):store.withLock({key:'email.runtime.session.'+connection.session_id},work);return withSession(async stx=>{
     const session=(await stx.read())?.value;
     if(!formMode&&canonical(session)!==canonical(visibleSession))fail('EMAIL_OBSERVATION_CONNECTION_DENIED');
     const checkLocal=()=>{local();if(!session||session.state!=='connected'||canonical(session.scope)!==canonical(snapshot.scope)||session.runtime_session_ref!==connection.runtime_session_ref||session.account?.account_ref!==connection.account_ref||session.binding.account_id!==connection.account_ref||session.client_fingerprint!==fingerprint||session.binding.provider!==provider)fail('EMAIL_OBSERVATION_CONNECTION_DENIED');};
     const current=async()=>{await check();checkLocal();await assertNoCredentialRepair({store,scope:snapshot.scope});};await current();
     let generation,formIdentity=null,checkCustody;
     const formAccount=async()=>{checkLocal();const account=await stx.currentAccount(),identity={principal_digest:'sha256:'+account.principal_digest,receipt_digest:account.receipt.digest};if(account.account_id!==connection.account_ref||account.receipt.account_ref!==account.account_id||account.receipt.scope_digest!=='sha256:'+digest(snapshot.scope)||account.receipt.principal_digest!==identity.principal_digest||account.receipt.custody_generation!==account.custody_generation||!account.capabilities.includes('read')||!Number.isSafeInteger(account.custody_generation)||account.custody_generation<1||connection.expected_custody_generation!==account.custody_generation||connection.receipt_digest!==account.receipt.digest||!/^sha256:[a-f0-9]{64}$/u.test(identity.principal_digest)||!/^sha256:[a-f0-9]{64}$/u.test(identity.receipt_digest)||formIdentity&&canonical(formIdentity)!==canonical(identity))fail('EMAIL_OBSERVATION_CUSTODY_DENIED');if(generation!==undefined&&generation!==account.custody_generation)fail('EMAIL_OBSERVATION_CUSTODY_DENIED');generation??=account.custody_generation;formIdentity??=identity;checkLocal();return account;};
     if(formMode){await formAccount();checkCustody=async()=>{await formAccount();};}else{
     const record=await custody.withAccount(session.binding,tx=>tx.read());
     if(!record||record.health!=='connected'||canonical(record.binding)!==canonical(session.binding)||record.secret?.client_fingerprint!==fingerprint||!grantedOAuthCapabilities(session.binding,record.secret.scopes).includes('read'))fail('EMAIL_OBSERVATION_CUSTODY_DENIED');
     generation=record.setup_generation;
     const lineage=(await store.withLock({key:lineageKey(session.binding)},tx=>tx.read()))?.value;
     if(connection.expected_custody_generation!==null){validateLineage(lineage,session);if(generation!==connection.expected_custody_generation||lineage.current.custody_generation!==generation||lineage.current.receipt_digest!==connection.receipt_digest)fail('EMAIL_OBSERVATION_CUSTODY_DENIED');}
     else if(connection.receipt_digest!==null||lineage)fail('EMAIL_OBSERVATION_CUSTODY_DENIED');
     checkCustody=()=>custody.withAccount(session.binding,tx=>{checkLocal();const value=tx.read();if(!value||value.health!=='connected'||value.setup_generation!==generation||canonical(value.binding)!==canonical(session.binding)||value.secret?.client_fingerprint!==fingerprint)fail('EMAIL_OBSERVATION_CUSTODY_DENIED');});
     }
     const publicationFingerprint=formMode?digest(['credential_form.v1',formIdentity]):fingerprint;
     const disclose=async result=>{await current();await checkCustody();await current();if(emit){phase='host_result';await emit(result,combined);}return result;};
     if(row){if(formMode&&canonical(row.value.custody_identity)!==canonical(formIdentity))fail('EMAIL_OBSERVATION_CUSTODY_DENIED');if(row.value.custody_generation!==generation)return disclose(unknown());if(row.value.state!=='completed')return disclose(unknown());return disclose({status:'returned',provider_succeeded:true,page:parseSyncPageV2(started.descriptor,started.input,row.value.page)});}
     await current();await persist({schema_version:'email.app_observation_run.v1',pins,custody_generation:generation,...(formMode?{custody_identity:formIdentity}:{}),state:'started'});
     // Decorate the frozen native custody reads, including reads under refresh
     // locks. This checks generation without recursive account-lock acquisition.
     const fencedCustody=formMode?null:{...custody,withAccount(binding,work){return custody.withAccount(binding,tx=>work({...tx,read(){checkLocal();const value=tx.read();if(!value||value.setup_generation!==generation||canonical(value.binding)!==canonical(session.binding))fail('EMAIL_OBSERVATION_CUSTODY_DENIED');return value;}}));}};
     const bridge=formMode?createImapReadPorts({forms:{currentAccount:formAccount},connector:{...imapConnector,imap(...args){providerCalls++;return imapConnector.imap(...args);}},session_id:connection.session_id,scope:snapshot.scope,check:async()=>{await current();await checkCustody();},now}).bridge:createNativeEmailBridge({store,identityScopeFor:createNativeIdentityScopeResolver({store,scope,session,binding:session.binding,check:current}),selected:session.binding,nativePageHydrationLimit:5,clients:{[provider]:client},custody:fencedCustody,accountFromRecord,now,oauthFetch:async(url,options={})=>{await current();providerCalls++;return fetchImpl(url,{...options,signal:AbortSignal.any([combined,options.signal].filter(Boolean))});},fetch:async(url,options={})=>{await current();await checkCustody();providerCalls++;return fetchImpl(url,{...options,signal:AbortSignal.any([combined,options.signal].filter(Boolean))});}});
     const context={org_id:scope.org_id,owner_user_id:scope.owner_user_id,account_id:scope.account_id,installation_id:snapshot.scope.installation_id,resource_binding_id:snapshot.scope.resource_binding_id,authority_version:authority.consent_digest,expires_at:Math.min(operationDeadline,lease,consentDeadline(snapshot)),recheck:checkLocal,signal:combined,owner_capabilities:['read'],provider_state:await mailbox.providerState(scope,checkLocal)};
     try{phase='provider';await onPhase?.('before_provider',{run_id:claim.run_id});const producer={scope:snapshot.scope,session_id:connection.session_id,runtime_session_ref:connection.runtime_session_ref,custody_generation:generation,client_fingerprint:publicationFingerprint},consumer={snapshot,consent_digest:authority.consent_digest,descriptor_digest:claim.descriptor_digest,custody_generation:generation,client_fingerprint:publicationFingerprint,max_items:started.input.max_items};
      const page=await publication.page({scope,consumer,producer,input_cursor:started.input.cursor,limit:Math.min(25,started.input.max_items),check:async()=>{await current();await checkCustody();},localCheck:checkLocal,onBootstrap:()=>{try{onDiagnostic?.({event:'email_observation_cached_bootstrap',run_id:claim.run_id,coverage_complete:false,deletions_inferred:false});}catch{}},readNative:async()=>{const native=await bridge.nativeEmailPage({cursor:await mailbox.cursor(scope,checkLocal),limit:Math.min(25,started.input.max_items)},context);phase='checkpoint';await onPhase?.('before_checkpoint',{run_id:claim.run_id});await current();await checkCustody();await mailbox.commit(scope,native,current,{localCheck:checkLocal,sync_producer:producer});await checkCustody();await current();}});
      phase='projection';const result=parseSyncPageV2(started.descriptor,started.input,{schema_version:'deft.app_sync_page.v2',upserts:page.items.map(item=>sourceMapping?integrationSourceProjection(scope,item,page.observed_at,sourceMapping):({id:item.logical_message_id,revision:item.revision,data:item.data,attachments:[]})),tombstones:(page.tombstones??[]).map(id=>({id,revision:'sha256:'+digest([scope,page.next_cursor,id])})),next_cursor:page.next_cursor,has_more:page.has_more});
      phase='checkpoint';await current();await checkCustody();await current();
      await persist({schema_version:'email.app_observation_run.v1',pins,custody_generation:generation,...(formMode?{custody_identity:formIdentity}:{}),state:'completed',page:result});phase='disclosure';await onPhase?.('before_disclosure',{run_id:claim.run_id});return await disclose({status:'returned',provider_succeeded:true,page:result});
     }catch(error){diagnose(error);if(row.value.state==='completed')throw error;await persist({...row.value,state:'indeterminate'});return disclose(unknown());}
    });
   });
  }catch(error){if(phase!=='provider'&&phase!=='checkpoint')diagnose(error);throw error;}finally{clearTimeout(timer);}
 }
 return Object.freeze({executeClaim,async runOnce(signal){const claim=await runtime_client.claim({signal});if(!claim)return null;let started,result;try{started=await runtime_client.start(claim,{signal});result=await executeClaim(claim,started,signal,(value,currentSignal)=>runtime_client.result(claim,started,value,{signal:currentSignal}));}catch(error){if(!started){try{onDiagnostic?.({event:'email_observation_failure',run_id:claim.run_id,phase:'start',code:diagnosticCodes.has(error?.code)?error.code:'OPAQUE_LOCAL_ERROR',elapsed_ms:0,authority_calls:0,provider_calls:0});}catch{}}result={status:'indeterminate'};}
  return result;
 }});
}


