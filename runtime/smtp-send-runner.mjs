import {acceptedRecipientMetadata} from './integration-recipient-projection.mjs';
import {createOrganizeRunner} from './organize-runner.mjs';
import {createDraftStore,uuid} from './draft-store.mjs';
import {createPreparedActions,RELEASE_INPUT_KEYS,COPY_INPUT_KEYS,preparedInputKeys} from './prepared-actions.mjs';
import {createSmtpCompoundSend} from './smtp-compound.mjs';
import {canonical,digest,exact,fail,opaque} from './contract.mjs';

/** Public reviewed Run execution only. Neither a data nomination nor a prepared
 * plan is effect authority. Every socket/effect uses fresh exact Run authority. */
export function createSmtpSendRunner({runtime_client,registration,forms,connector,store,now=Date.now,onPhase}){
 exact(registration,['org_id','runtime_registration_id','runtime_epoch']);
 if(!uuid(registration.org_id)||!uuid(registration.runtime_registration_id)||!Number.isSafeInteger(registration.runtime_epoch)||registration.runtime_epoch<0||['claim','start','authorize','result'].some(key=>typeof runtime_client?.[key]!=='function'))fail('EMAIL_SMTP_CHANNEL_INVALID');
 const organize=createOrganizeRunner({runtime_client,registration,provider:'imap_smtp',forms,connector,store,now,onPhase});
 const prepared=createPreparedActions({store,now}),drafts=createDraftStore({store,now}),compound=createSmtpCompoundSend({forms,store,connector,now,onPhase});
 async function executeClaim(claim,started,signal){
  if(!uuid(claim?.run_id)||!uuid(claim.attempt_id)||claim.operation_name!=='send_message'||started.run_id!==claim.run_id||started.attempt_id!==claim.attempt_id)fail('EMAIL_SMTP_CLAIM_DENIED');
  exact(started.input,[...RELEASE_INPUT_KEYS,...COPY_INPUT_KEYS]);const input=structuredClone(started.input),input_digest='sha256:'+digest(input);
  if(input.record_action_version!=='deft.app_prepared_record_action.v1'||input.record_store_key!=='drafts'||!opaque(input.account_ref)||['snapshot_id','draft_id','connection_session_id','data_consent_id'].some(k=>!uuid(input[k])))fail('EMAIL_SMTP_INPUT_DENIED');
  let previous,deadline=Math.min(now()+30000,Date.parse(claim.lease_expires_at),Date.parse(started.lease_expires_at));
  if(!Number.isFinite(deadline)||deadline<=now())fail('EMAIL_SMTP_AUTHORITY_DENIED');
  const expiry=new AbortController(),combined=AbortSignal.any([signal,expiry.signal].filter(Boolean));
  let timer;const arm=()=>{clearTimeout(timer);timer=setTimeout(()=>expiry.abort(),Math.max(0,deadline-now()));timer.unref();};arm();
  const check=async()=>{combined.throwIfAborted();if(deadline<=now())fail('EMAIL_SMTP_AUTHORITY_DENIED');const authority=await runtime_client.authorize(claim);combined.throwIfAborted();
   if(authority.schema_version!=='deft.app_runtime_authority.v1'||authority.audience!=='app_runtime'||authority.run_id!==claim.run_id||authority.attempt_id!==claim.attempt_id||authority.operation_name!=='send_message'||authority.org_id!==registration.org_id||authority.runtime_registration_id!==registration.runtime_registration_id||authority.runtime_epoch!==registration.runtime_epoch||authority.input_digest!==input_digest||canonical(authority.input)!==canonical(input)||!Number.isFinite(Date.parse(authority.lease_expires_at))||Date.parse(authority.lease_expires_at)<=now()||Date.parse(authority.lease_expires_at)>Math.min(Date.parse(claim.lease_expires_at),Date.parse(started.lease_expires_at)))fail('EMAIL_SMTP_AUTHORITY_DENIED');
   const {lease_expires_at,...pins}=authority;if(previous&&canonical(previous)!==canonical(pins))fail('EMAIL_SMTP_AUTHORITY_DENIED');previous=structuredClone(pins);deadline=Math.min(deadline,Date.parse(lease_expires_at));if(deadline<=now())fail('EMAIL_SMTP_AUTHORITY_DENIED');arm();return authority;};
  const checkLocal=async()=>{combined.throwIfAborted();if(!previous||deadline<=now())fail('EMAIL_SMTP_AUTHORITY_DENIED');};
  let value,scope,reserved=false;
  try{
   const authority=await check();scope={org_id:authority.org_id,owner_user_id:authority.owner_id,account_id:input.account_ref};value=await prepared.read(scope,input.snapshot_id,checkLocal);
   if(!value.prepared.copy_effect||canonical(value.prepared.input)!==canonical(Object.fromEntries(preparedInputKeys(value.prepared).map(k=>[k,input[k]])))||value.prepared.snapshot_digest!==input.prepared_digest||value.prepared.record_id!==input.draft_id||value.prepared.revision!==input.draft_revision||value.connection.session_id!==input.connection_session_id||value.connection.session_revision!==input.connection_revision||value.authority.consent_id!==input.data_consent_id||value.authority.consent_digest!==input.data_consent_digest||value.prepared.copy_effect.action_binding_id!==authority.runtime_binding_id||Date.parse(value.prepared.expires_at)<=now())fail('EMAIL_SMTP_SNAPSHOT_DENIED');
   for(const [host,local] of Object.entries({org_id:'org_id',owner_id:'owner_user_id',app_installation_id:'installation_id',app_version_id:'app_version_id',grant_snapshot_id:'grant_snapshot_id',lifecycle_epoch:'lifecycle_epoch',grant_epoch:'grant_epoch'}))if(authority[host]!==value.connection_scope[local])fail('EMAIL_SMTP_SCOPE_DENIED');
   deadline=Math.min(deadline,Date.parse(value.prepared.expires_at));
   if(value.state==='accepted'){if(value.effect?.run_id!==claim.run_id||value.effect.input_digest!==input_digest)fail('EMAIL_SMTP_ALREADY_RESERVED');await check();return value.effect.result;}
   if(value.state!=='prepared')return {status:'indeterminate'};
   const future=Boolean(value.prepared.future_release),release=value.future_local_release;
   if(future&&(!release||release.run_id!==claim.run_id||release.snapshot_digest!==input.prepared_digest))fail('EMAIL_SMTP_FUTURE_RELEASE_DENIED');
   const queuedEffect=future?{run_id:claim.run_id,release_id:release.release_id,snapshot_digest:input.prepared_digest}:null;
   const record=await drafts.read(scope,input.draft_id,checkLocal);if(record.status!==(future?'submitted':'draft')||record.revision!==input.draft_revision+(future?1:0)||future&&canonical(record.send_effect)!==canonical({...queuedEffect,state:'queued'})||record.content_revision!==input.content_revision||'sha256:'+record.content_digest!==input.content_digest||'sha256:'+digest(record.content.attachments)!==input.file_manifest_digest)fail('EMAIL_SMTP_DRAFT_CHANGED');
   await check();const packet=await prepared.bind(value,claim.run_id,checkLocal,identity=>prepared.withSnapshot(scope,input.snapshot_id,checkLocal,async(current,persist)=>{
    if(current.state!=='prepared')return 'unknown';if(future)await drafts.reserveQueuedSend(scope,input.draft_id,input.draft_revision+1,input.content_digest.slice(7),queuedEffect,checkLocal);else await drafts.reserveSend(scope,input.draft_id,input.draft_revision,input.content_digest.slice(7),claim.run_id,checkLocal);
    await persist({...current,state:'provider_started',effect:{run_id:claim.run_id,attempt_id:claim.attempt_id,input_digest,identity,authority,result:null,compound_receipt:null}});reserved=true;return 'reserved';}));
   const receipt=await compound.execute({operation_id:claim.run_id,attempt_id:claim.attempt_id,connection:value.connection,scope:value.connection_scope,action_binding_id:authority.runtime_binding_id,snapshot_digest:value.prepared.snapshot_digest,copy_plan:value.copy_plan,mime_bytes:packet.mime_bytes,mime_digest:packet.mime_digest,from_address:packet.from_address,envelope:packet.envelope,check,checkLocal,signal:combined,expires_at:deadline});
   const result=receipt.transport_outcome==='unknown'?{status:'indeterminate'}:{status:'returned',provider_succeeded:receipt.transport_outcome==='accepted',output:{operation_id:claim.run_id,transport_outcome:receipt.transport_outcome==='accepted'?'provider_accepted':'provider_rejected',sent_copy_outcome:receipt.copy_outcome}};
   await prepared.withSnapshot(scope,input.snapshot_id,async()=>{},async(current,persist)=>{if(current.effect?.run_id!==claim.run_id||current.effect.input_digest!==input_digest)fail('EMAIL_SMTP_CONFLICT');await persist({...current,state:receipt.transport_outcome==='unknown'?'unknown':'accepted',effect:{...current.effect,result,compound_receipt:receipt}});});
   await drafts.recordSendOutcome(scope,input.draft_id,claim.run_id,receipt.transport_outcome==='accepted'?'accepted':'unknown',receipt.transport_outcome==='accepted'?acceptedRecipientMetadata({payload:value.snapshot.payload,installation_id:value.connection_scope.installation_id,run_id:claim.run_id,snapshot_id:input.snapshot_id,accepted_at:new Date(now()).toISOString()}):undefined);await check();return result;
  }catch(error){if(!reserved)throw error;try{
   // The narrow app-owned journal may already prove SMTP acceptance even when
   // later copy authority/disclosure was revoked. Preserve that fact without
   // provider I/O or disclosing it under revoked authority.
   const receipt=await compound.status(scope,claim.run_id,async()=>{}),accepted=receipt?.transport_outcome==='accepted';
   const result=accepted?{status:'returned',provider_succeeded:true,output:{operation_id:claim.run_id,transport_outcome:'provider_accepted',sent_copy_outcome:receipt.copy_outcome}}:null;
   await prepared.withSnapshot(scope,input.snapshot_id,async()=>{},async(current,persist)=>{if(current.state!=='accepted')await persist({...current,state:accepted?'accepted':'unknown',effect:{...current.effect,...(receipt?{compound_receipt:receipt}:{}),...(result?{result}: {})}});});
   await drafts.recordSendOutcome(scope,input.draft_id,claim.run_id,accepted?'accepted':'unknown',accepted?acceptedRecipientMetadata({payload:value.snapshot.payload,installation_id:value.connection_scope.installation_id,run_id:claim.run_id,snapshot_id:input.snapshot_id,accepted_at:new Date(now()).toISOString()}):undefined);
  }catch{}return {status:'indeterminate'};}
  finally{clearTimeout(timer);}
 }
 return Object.freeze({executeClaim,async runOnce(signal){const claim=await runtime_client.claim();if(!claim)return null;let result;try{result=await (claim.operation_name==='organize_messages'?organize.executeClaim:executeClaim)(claim,await runtime_client.start(claim),signal);}catch{result={status:'not_attempted',error_code:'APP_RUN_PROVIDER_UNAVAILABLE'};}await runtime_client.result(claim,result);return result;},readReceipt:compound.status});
}
