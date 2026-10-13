import {assertNoCredentialRepair,wrapCredentialProviderBridge} from './credential-repair-reservation.mjs';
import {fenceCredentialGeneration} from './credential-generation-fence.mjs';
import {acceptedRecipientMetadata} from './integration-recipient-projection.mjs';
import {createMirrorStore} from './mirror-store.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {createNativeEmailBridge as createUnfencedNativeEmailBridge} from './vendor/providers/native-mailbox.mjs';
const createNativeEmailBridge=options=>wrapCredentialProviderBridge({bridge:createUnfencedNativeEmailBridge(options),store:options.store,scope:{...options.selected.scope,resource_binding_id:options.selected.resource_binding_id}});
import {createEncryptedEmailCustody} from './vendor/providers/custody-encrypted.mjs';
import {grantedOAuthCapabilities,validateOAuthClient,oauthClientFingerprint} from './vendor/providers/oauth-provider.mjs';
import {validateEmailAccount} from './vendor/account-registry.mjs';
import {createDraftStore,uuid} from './draft-store.mjs';
import {createPreparedActions,RELEASE_INPUT_KEYS,SEND_INPUT_KEYS} from './prepared-actions.mjs';
import {canonical,digest,exact,fail,opaque,hostUuid} from './contract.mjs';

import {createGraphSendJournal} from './graph-send-journal.mjs';
import {purposeFor} from './purpose-set.mjs';
const noDisclosure={status:'indeterminate'};
const accountFromRecord=(binding,record)=>{if(!record?.secret?.identity||record.health!=='connected')return null;const identity=record.secret.identity;return validateEmailAccount({account_id:binding.account_id,provider:binding.provider,display_label:identity.display_label,primary_address:identity.primary_address,verified_sender_identities:[...identity.verified_sender_identities],capabilities:grantedOAuthCapabilities(binding,record.secret.scopes),connection_target:binding.connection_target,resource_binding_id:binding.resource_binding_id,action_binding_id:binding.action_binding_id,authority_epoch:binding.authority_epoch,health:'connected'});};
/** Executes only claims received from the public reviewed Runtime channel.
 * Snapshot and provider-start reservations are durable before dispatch. No HTTP
 * data method, author nomination, retry or process restart can resend a packet. */
export function createSendRunner({runtime_client,registration,client,provider='gmail',store,encryption_key,key_id,fetch:fetchImpl=globalThis.fetch,now=Date.now}){
  exact(registration,['org_id','runtime_registration_id','runtime_epoch']);
  if(!uuid(registration.org_id)||!uuid(registration.runtime_registration_id)||!Number.isInteger(registration.runtime_epoch)||registration.runtime_epoch<0||['claim','start','authorize','result'].some(method=>typeof runtime_client?.[method]!=='function'))fail('EMAIL_SEND_CHANNEL_CONFIG_INVALID');
  client=validateOAuthClient(provider,client);const fingerprint=oauthClientFingerprint(provider,client),custody=createEncryptedEmailCustody({encryption_key,key_id,store,now}),drafts=createDraftStore({store,now}),prepared=createPreparedActions({store,now});
  async function executeClaim(claim,started,signal){
    if(!uuid(claim?.run_id)||!uuid(claim.attempt_id)||claim.operation_name!=='send_message'||started.run_id!==claim.run_id||started.attempt_id!==claim.attempt_id)fail('EMAIL_SEND_CLAIM_DENIED');
    exact(started.input,RELEASE_INPUT_KEYS);const input=structuredClone(started.input),input_digest='sha256:'+digest(input);
    if(input.record_action_version!=='deft.app_prepared_record_action.v1'||input.record_store_key!=='drafts'||!opaque(input.account_ref)||!hostUuid(input.connection_session_id)||['snapshot_id','draft_id','data_consent_id'].some(field=>!uuid(input[field]))||['content_digest','file_manifest_digest','mime_digest','payload_digest','data_consent_digest','prepared_digest'].some(field=>!/^sha256:[a-f0-9]{64}$/u.test(input[field]??''))||input.source_digest!==''&&!/^sha256:[a-f0-9]{64}$/u.test(input.source_digest??'')||['draft_revision','content_revision','connection_revision'].some(field=>!Number.isSafeInteger(input[field])||input[field]<1))fail('EMAIL_SEND_INPUT_DENIED');
    const expiry=new AbortController(),combined=AbortSignal.any([signal,expiry.signal].filter(Boolean));let authorityDeadline=Math.min(Date.parse(started.lease_expires_at),Date.parse(claim.lease_expires_at)),deadline=authorityDeadline,operationDeadline=now()+300000,lastHeartbeat=now(),renewed=false,timer,authority;
    const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>expiry.abort(new Error('EMAIL_SEND_AUTHORITY_EXPIRED')),Math.max(0,deadline-now()));timer.unref();};arm();
    let repairScope=null; const check=async()=>{if(repairScope)await assertNoCredentialRepair({store,scope:repairScope});combined.throwIfAborted();if(now()-lastHeartbeat>=15000){if(typeof runtime_client.heartbeat!=='function'||!await runtime_client.heartbeat(claim))fail('EMAIL_SEND_AUTHORITY_DENIED');lastHeartbeat=now();renewed=true;}if(deadline<=now())fail('EMAIL_SEND_AUTHORITY_DENIED');const value=await runtime_client.authorize(claim);combined.throwIfAborted();if(value.schema_version!=='deft.app_runtime_authority.v1'||value.run_id!==claim.run_id||value.attempt_id!==claim.attempt_id||value.operation_name!=='send_message'||value.audience!=='app_runtime'||value.org_id!==registration.org_id||value.runtime_registration_id!==registration.runtime_registration_id||value.runtime_epoch!==registration.runtime_epoch||value.input_digest!==input_digest||canonical(value.input)!==canonical(input)||!Number.isFinite(Date.parse(value.lease_expires_at))||(!renewed&&Date.parse(value.lease_expires_at)>authorityDeadline)||Date.parse(value.lease_expires_at)<=now())fail('EMAIL_SEND_AUTHORITY_DENIED');
      if(authority){const {lease_expires_at:oldExpiry,...oldPins}=authority,{lease_expires_at:newExpiry,...pins}=value;if(canonical(oldPins)!==canonical(pins))fail('EMAIL_SEND_AUTHORITY_DENIED');}authority=structuredClone(value);authorityDeadline=renewed?Date.parse(value.lease_expires_at):Math.min(authorityDeadline,Date.parse(value.lease_expires_at));renewed=false;deadline=Math.min(operationDeadline,authorityDeadline);if(deadline<=now())fail('EMAIL_SEND_AUTHORITY_DENIED');arm();return deadline;};
    // Gmail local immutable snapshot/custody checks share this operation's
    // bounded admission. Fresh SQL authority remains mandatory at reservation,
    // every provider/token HTTP call, and final disclosure; no decision is cached
    // across provider I/O. Microsoft compound preparation keeps its old checker.
    const localCheck=provider==='gmail'?async()=>{if(repairScope)await assertNoCredentialRepair({store,scope:repairScope});combined.throwIfAborted();if(deadline<=now())fail('EMAIL_SEND_AUTHORITY_DENIED');return deadline;}:check;
    let value,scope,providerStarted=false,preparationStarted=false;
    try{
      await check();scope={org_id:authority.org_id,owner_user_id:authority.owner_id,account_id:input.account_ref};value=await prepared.read(scope,input.snapshot_id,localCheck);
      if(Date.parse(value.prepared.expires_at)<=now()||canonical(value.prepared.input)!==canonical(Object.fromEntries(SEND_INPUT_KEYS.map(field=>[field,input[field]])))||value.prepared.action_key!=='send_message'||value.prepared.record_id!==input.draft_id||value.prepared.revision!==input.draft_revision||value.prepared.snapshot_digest!==input.prepared_digest||value.connection.session_id!==input.connection_session_id||value.connection.session_revision!==input.connection_revision||value.authority.consent_id!==input.data_consent_id||value.authority.consent_digest!==input.data_consent_digest)fail('EMAIL_SEND_SNAPSHOT_DENIED');
      const scopePins={org_id:'org_id',owner_id:'owner_user_id',app_installation_id:'installation_id',app_version_id:'app_version_id',grant_snapshot_id:'grant_snapshot_id',lifecycle_epoch:'lifecycle_epoch',grant_epoch:'grant_epoch'};
      if(Object.entries(scopePins).some(([host,local])=>authority[host]!==value.connection_scope[local]))fail('EMAIL_SEND_SCOPE_DENIED');
      if(value.state==='accepted'){if(value.effect?.run_id!==claim.run_id||value.effect.input_digest!==input_digest)fail('EMAIL_SEND_ALREADY_RESERVED');await check();return value.effect.result;}
      if(value.state!=='prepared')return noDisclosure;operationDeadline=Math.min(operationDeadline,Date.parse(value.prepared.expires_at));deadline=Math.min(deadline,operationDeadline);arm();
      // Local session inspection is outside native custody locks. The online
      // host checker is SQL-only and rechecks its current connection/action on
      // every provider I/O, avoiding lock inversion during token refresh.
      const session=await store.withLock({key:'email.runtime.session.'+input.connection_session_id},async tx=>(await tx.read())?.value);
      if(!session||session.state!=='connected'||canonical(session.scope)!==canonical(value.connection_scope)||canonical(session.scope)!==canonical(value.connection_scope)||session.client_fingerprint!==fingerprint||session.binding.provider!==provider||session.runtime_session_ref!==value.connection.runtime_session_ref||session.account?.account_ref!==input.account_ref||!session.binding.capabilities.includes('send'))fail('EMAIL_SEND_CONNECTION_DENIED');
      repairScope=session.scope;await assertNoCredentialRepair({store,scope:repairScope});const fencedCustody=await fenceCredentialGeneration({store,custody,session});const sendConsent=purposeFor(session,'send_message',now);if(sendConsent.action_binding_id!==authority.runtime_binding_id)fail('EMAIL_SEND_CONNECTION_DENIED');operationDeadline=Math.min(operationDeadline,Date.parse(value.prepared.expires_at),Date.parse(sendConsent.expires_at),...(value.prepared.required_action_consents??[]).map(row=>Date.parse(row.expires_at)));deadline=Math.min(deadline,operationDeadline);arm();
      const largeGraph=provider==='microsoft'&&Buffer.from(value.snapshot.mime_bytes,'base64url').length>3*1024*1024;if(!largeGraph){operationDeadline=Math.min(operationDeadline,now()+30000);deadline=Math.min(deadline,operationDeadline);arm();}if(largeGraph){const modify=purposeFor(session,'organize_messages',now);if(canonical(value.prepared.required_action_consents)!==canonical([modify]))fail('EMAIL_GRAPH_SEND_MODIFY_REQUIRED');}
      const future=Boolean(value.prepared.future_release),release=value.future_local_release;
      if(future&&(!release||release.run_id!==claim.run_id||release.release_id!==release.original_request_id||release.snapshot_digest!==input.prepared_digest))fail('EMAIL_SEND_FUTURE_RELEASE_DENIED');
      const queuedEffect=future?{run_id:claim.run_id,release_id:release.release_id,snapshot_digest:input.prepared_digest}:null;
      const reserve=()=>future?drafts.reserveQueuedSend(scope,input.draft_id,input.draft_revision+1,input.content_digest.slice(7),queuedEffect,localCheck):drafts.reserveSend(scope,input.draft_id,input.draft_revision,input.content_digest.slice(7),claim.run_id,localCheck);
      const record=await drafts.read(scope,input.draft_id,localCheck);if(record.status!==(future?'submitted':'draft')||record.revision!==input.draft_revision+(future?1:0)||future&&canonical(record.send_effect)!==canonical({...queuedEffect,state:'queued'})||record.content_revision!==input.content_revision||'sha256:'+record.content_digest!==input.content_digest||'sha256:'+digest(record.content.attachments)!==input.file_manifest_digest)fail('EMAIL_SEND_DRAFT_CHANGED');
      const bridge=createNativeEmailBridge({store,selected:session.binding,clients:{[provider]:client},custody:fencedCustody,accountFromRecord,now,fetch:async(url,options={})=>{await check();await assertNoCredentialRepair({store,scope:session.scope});return fetchImpl(url,{...options,signal:AbortSignal.any([combined,options.signal].filter(Boolean))});}});
      const packet=await prepared.bind(value,claim.run_id,localCheck,async identity=>prepared.withSnapshot(scope,input.snapshot_id,localCheck,async(current,persist)=>{
        if(current.state!=='prepared')return current.effect?.run_id===claim.run_id?'replay':'unknown';
        await check();if(!largeGraph)await reserve();
        const effect={run_id:claim.run_id,attempt_id:claim.attempt_id,input_digest,identity,authority,provider_receipt:null,result:null};await persist({...current,state:largeGraph?'preparing':'provider_started',effect});if(largeGraph)preparationStarted=true;else providerStarted=true;return 'reserved';
      }));
      if(packet.replay)return noDisclosure;
      const context={org_id:scope.org_id,owner_user_id:scope.owner_user_id,account_id:scope.account_id,installation_id:value.connection_scope.installation_id,resource_binding_id:value.connection_scope.resource_binding_id,authority_version:input_digest,expires_at:deadline,recheck:localCheck,signal:combined,owner_capabilities:largeGraph?['read','modify','send']:['read','send'],send_before_reserve:async nomination=>{await check();return providerStarted&&nomination.operation_id===claim.run_id&&nomination.mime_digest===input.mime_digest.slice(7)&&nomination.account_id===scope.account_id;}};
      let result;
      try{if(largeGraph){const journal=createGraphSendJournal({store,scope,operation_id:claim.run_id,input_digest,prepared_digest:input.prepared_digest});
        const proof=async nomination=>{await check();const current=await drafts.read(scope,input.draft_id,check);return preparationStarted&&current.status===(future?'submitted':'draft')&&current.revision===input.draft_revision+(future?1:0)&&(!future||canonical(current.send_effect)===canonical({...queuedEffect,state:'queued'}))&&'sha256:'+current.content_digest===input.content_digest&&nomination.operation_id===claim.run_id&&nomination.mime_digest===input.mime_digest.slice(7)&&nomination.account_id===scope.account_id;};
        let page;for(let i=0;i<64;i++){await check();page=await bridge.nativeEmailPrepareSend({operation_id:claim.run_id,mime_bytes:packet.mime_bytes,mime_digest:packet.mime_digest,from_address:packet.from_address},(({send_before_reserve,...core})=>({...core,expires_at:Math.min(deadline,now()+30000),send_upload_journal:journal,send_prepare_before_effect:proof}))(context));if(page.state==='ready')break;if(page.state!=='pending')fail('EMAIL_GRAPH_SEND_PREPARATION_UNKNOWN');if(!page.limitations.includes('bounded_preparation_page')){await delay(Math.min(page.retry_after_ms??1000,Math.max(1,deadline-now())),undefined,{signal:combined});}}
        if(page?.state!=='ready')fail('EMAIL_GRAPH_SEND_PREPARATION_PENDING');
        context.send_upload_journal=journal;context.expires_at=Math.min(deadline,now()+30000);context.send_before_reserve=async nomination=>{await check();if(!await proof(nomination))return false;return prepared.withSnapshot(scope,input.snapshot_id,check,async(current,persist)=>{if(current.state!=='preparing'||current.effect?.run_id!==claim.run_id)return false;await reserve();await persist({...current,state:'provider_started'});providerStarted=true;return true;});};
      }
      result=await bridge.nativeEmailSend({operation_id:claim.run_id,mime_bytes:packet.mime_bytes,mime_digest:packet.mime_digest,from_address:packet.from_address,thread_id:packet.thread_id},context);}catch{
        if(providerStarted||preparationStarted){await prepared.withSnapshot(scope,input.snapshot_id,async()=>{},async(current,persist)=>{if(current.effect?.run_id===claim.run_id&&current.state!=='accepted')await persist({...current,state:'unknown'});});if(providerStarted)await drafts.recordSendOutcome(scope,input.draft_id,claim.run_id,'unknown');}return noDisclosure;
      }
      const publicResult={status:'returned',provider_succeeded:true,output:{operation_id:claim.run_id,transport_outcome:'provider_accepted',sent_copy_outcome:'pending'}};
      // Custody of a completed effect survives subsequent revocation. Persist
      // validated acceptance first, then recheck before disclosing to the host.
      await prepared.withSnapshot(scope,input.snapshot_id,async()=>{},async(current,persist)=>{if(current.effect?.run_id!==claim.run_id||current.effect.input_digest!==input_digest)fail('EMAIL_SEND_CONFLICT');await persist({...current,state:'accepted',effect:{...current.effect,provider_receipt:{provider,provider_message_id:result.provider_message_id},result:publicResult}});});
      await drafts.recordSendOutcome(scope,input.draft_id,claim.run_id,'accepted',acceptedRecipientMetadata({payload:value.snapshot.payload,installation_id:value.connection_scope.installation_id,run_id:claim.run_id,snapshot_id:input.snapshot_id,accepted_at:new Date(now()).toISOString()}));
      // Cleanup custody is separate from Send acceptance. Missing or fenced mirror state grants no delete.
      try{await createMirrorStore({store,now}).accepted(scope,input.draft_id,{run_id:claim.run_id,snapshot_id:input.snapshot_id,snapshot_digest:input.prepared_digest.slice(7),record_revision:input.draft_revision,content_digest:input.content_digest.slice(7)},async()=>{});}catch{}
      await check();return publicResult;
    }catch(error){if(providerStarted||preparationStarted){try{await prepared.withSnapshot(scope,input.snapshot_id,async()=>{},async(current,persist)=>{if(current.state!=='accepted')await persist({...current,state:'unknown'});});}catch{}return noDisclosure;}throw error;}
    finally{clearTimeout(timer);}
  }
  return Object.freeze({executeClaim,async runOnce(signal){const claim=await runtime_client.claim();if(!claim)return null;let result;try{const started=await runtime_client.start(claim);result=await executeClaim(claim,started,signal);}catch{result={status:'not_attempted',error_code:'APP_RUN_PROVIDER_UNAVAILABLE'};}await runtime_client.result(claim,result);return result;}});
}




