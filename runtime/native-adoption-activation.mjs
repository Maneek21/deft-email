import {nativeContinuityEpochs} from './native-adoption-continuity.mjs';
import {lineageKey,validateLineage} from './account-lineage.mjs';
import {NATIVE_TABLES} from './native-adoption-retained.mjs';
import {randomBytes} from 'node:crypto';
import {canonical,digest,exact,fail,validateScope,validateRegistration,isoTime} from './contract.mjs';
import {uuid} from './draft-store.mjs';
import {nativeScope} from './native-adoption-records.mjs';
import {nativeAdoptionKey,readNativeIdentity} from './native-adoption-identity.mjs';
import {validateOAuthBinding} from './vendor/providers/oauth-contract.mjs';
import {validateOAuthClient,oauthClientFingerprint,grantedOAuthCapabilities} from './vendor/providers/oauth-provider.mjs';
import {reserveTarget} from './target-reservation.mjs';
import {sealPurposeSet} from './purpose-set.mjs';
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const journalKey=scope=>'email.native.activation.'+digest(nativeScope(scope));
const sessionKey=id=>'email.runtime.session.'+id;
const read=(store,key)=>store.withLock({key},tx=>tx.read());
const completeSource=stage=>stage?.source_manifest&&canonical(Object.keys(stage.source_manifest).sort())===canonical([...NATIVE_TABLES].sort())&&Object.values(stage.source_manifest).every(entry=>entry&&Number.isSafeInteger(entry.count)&&entry.count>=0&&hash(entry.digest))&&stage.source_manifest.email_accounts.count===1;
export function nativeActivationAdmission(raw){
 exact(raw,['schema_version','adoption_id','scope','snapshot_digest','source_principal_digest','destination_scope','destination_binding','session_id']);
 if(raw.schema_version!=='email.native_activation_admission.v1'||!uuid(raw.adoption_id)||!uuid(raw.session_id)||!hash(raw.snapshot_digest)||!hash(raw.source_principal_digest))fail('EMAIL_NATIVE_ACTIVATION_INVALID');
 const scope=nativeScope(raw.scope),destination_scope=validateScope(raw.destination_scope),binding=validateOAuthBinding(raw.destination_binding);
 if(!/^[A-Za-z0-9_-]{1,256}$/.test(scope.account_id)||binding.provider!=='gmail'||binding.account_id!==scope.account_id||binding.action_binding_id!==null||canonical(binding.capabilities)!==canonical(['read','search','thread'])
  ||destination_scope.org_id!==scope.org_id||destination_scope.owner_user_id!==scope.owner_user_id||canonical(binding.scope)!==canonical({org_id:scope.org_id,owner_id:scope.owner_user_id,installation_id:destination_scope.installation_id})||binding.connection_target!==destination_scope.target_key||binding.resource_binding_id!==destination_scope.resource_binding_id)fail('EMAIL_NATIVE_ACTIVATION_BINDING_DENIED');
 return structuredClone(raw);
}
/** Operator-only import completion. assertCurrent must be the independent Host
 * owner/session/binding/admission check; it returns the durable native routing
 * fence freshly. It never accepts old native grants as destination authority. */
export function createNativeActivation({store,custody,registration:rawRegistration,client,assertCurrent,now=Date.now}){
 const registration=validateRegistration(rawRegistration),fingerprint=oauthClientFingerprint('gmail',validateOAuthClient('gmail',client));
 if(typeof assertCurrent!=='function')fail('EMAIL_NATIVE_ACTIVATION_AUTHORITY_REQUIRED');
 function checker(admission,phase,receipt_digest=null){return async()=>{
  if(Object.keys(registration).some(k=>registration[k]!==admission.destination_scope[k])||Date.parse(admission.destination_scope.consent_expires_at)<=now())fail('EMAIL_NATIVE_ACTIVATION_AUTHORITY_DENIED');
  const current=await assertCurrent({admission:structuredClone(admission),phase,receipt_digest});exact(current,['allowed','expires_at','route']);
  if(current.allowed!==true||!isoTime(current.expires_at)||Date.parse(current.expires_at)<=now()||Date.parse(current.expires_at)>Math.min(now()+30000,Date.parse(admission.destination_scope.consent_expires_at)))fail('EMAIL_NATIVE_ACTIVATION_AUTHORITY_DENIED');
  const route=current.route;exact(route,['adoption_id','scope','state','snapshot_digest','source_principal_digest','source_binding_digest','source_generation','destination_binding_digest','destination_admission_digest','runtime_receipt_digest']);
  if(route.adoption_id!==admission.adoption_id||canonical(route.scope)!==canonical(admission.scope)||route.snapshot_digest!==admission.snapshot_digest||route.source_principal_digest!==admission.source_principal_digest
   ||route.destination_binding_digest!==digest(admission.destination_binding)||route.destination_admission_digest!==digest(admission)||route.state!==(phase==='prepare'?'runtime_prepared':'runtime_active')||route.runtime_receipt_digest!==receipt_digest)fail('EMAIL_NATIVE_ACTIVATION_ROUTE_DENIED');
  return route;
 };}
 async function imported(admission,check){
  const route=await check(),stage=(await read(store,nativeAdoptionKey(admission.scope)))?.value;
  if(!completeSource(stage))fail('EMAIL_NATIVE_ACTIVATION_COMPLETE_SOURCE_REQUIRED');
  if(stage?.state!=='staged_verified'||stage.adoption_id!==admission.adoption_id||stage.snapshot_digest!==admission.snapshot_digest||stage.binding_digest!==digest(admission.destination_binding)||stage.source_evidence.writer_generation!==route.source_generation)fail('EMAIL_NATIVE_ACTIVATION_IMPORT_DENIED');
  const identity=await readNativeIdentity(store,admission.scope,admission.destination_binding,check);
  if(!identity||digest(identity.source_binding)!==route.source_binding_digest)fail('EMAIL_NATIVE_ACTIVATION_IMPORT_DENIED');
  const record=await custody.withAccount(admission.destination_binding,async tx=>{await check();return tx.read();});
  if(!['connected','reauth_required'].includes(record?.health)||canonical(record.binding)!==canonical(admission.destination_binding)||record.secret?.client_fingerprint!==fingerprint||!record.secret.identity?.provider_subject||!grantedOAuthCapabilities(record.binding,record.secret.scopes).includes('read')||digest([admission.scope.org_id,admission.scope.owner_user_id,'gmail',record.secret.identity.provider_subject])!==admission.source_principal_digest)fail('EMAIL_NATIVE_ACTIVATION_PRINCIPAL_DENIED');
  return {account:{account_ref:admission.scope.account_id,label:record.secret.identity.primary_address},generation:record.setup_generation};
 }
 return Object.freeze({
  async prepare(raw){const admission=nativeActivationAdmission(raw),check=checker(admission,'prepare');await check();
   return store.withLock({key:journalKey(admission.scope)},async jtx=>{
    const prior=await jtx.read();if(prior&&canonical(prior.value.admission)!==canonical(admission))fail('EMAIL_NATIVE_ACTIVATION_CONFLICT');
    const account=await imported(admission,check);
    return store.withLock({key:sessionKey(admission.session_id)},async stx=>{
     if(prior){if(prior.value.state!=='prepared')fail('EMAIL_NATIVE_ACTIVATION_CONFLICT');const stored=await stx.read();if(stored&&canonical(stored.value)!==canonical(prior.value.session))fail('EMAIL_NATIVE_ACTIVATION_CONFLICT');await check();if(!stored&&!await stx.compareAndSwap({expected_revision:null,value:prior.value.session}))fail('EMAIL_NATIVE_ACTIVATION_CONFLICT');await check();return structuredClone(prior.value.receipt);}
     if(await stx.read())fail('EMAIL_NATIVE_ACTIVATION_SESSION_EXISTS');
     await reserveTarget({store,request:{scope:admission.destination_scope,session_id:admission.session_id},kind:'native_adoption',check,now});
     const registrationKey='email.runtime.registration.'+digest([registration.org_id,registration.runtime_registration_id,registration.runtime_epoch,registration.profile_digest]);
     await store.withLock({key:registrationKey},async tx=>{await check();const row=await tx.read(),value={schema_version:'email.runtime.registration_client.v1',registration,client_fingerprint:fingerprint};if(row&&canonical(row.value)!==canonical(value))fail('EMAIL_RUNTIME_CLIENT_REGISTRATION_CHANGED');if(!row&&!await tx.compareAndSwap({expected_revision:null,value}))fail('EMAIL_NATIVE_ACTIVATION_CONFLICT');});
     const runtime_session_ref=randomBytes(32).toString('base64url'),pins={schema_version:'email.native_activation_receipt.v1',adoption_id:admission.adoption_id,admission_digest:digest(admission),snapshot_digest:admission.snapshot_digest,session_id:admission.session_id,runtime_session_ref,custody_generation:account.generation,principal_digest:admission.source_principal_digest,account:account.account},receipt={...pins,receipt_digest:digest(pins)};
     const session={session_id:admission.session_id,scope:admission.destination_scope,action_consents:[],purpose_set:sealPurposeSet(admission.destination_binding,[],account.generation),client_fingerprint:fingerprint,runtime_session_ref,binding:admission.destination_binding,state:'native_adoption_prepared',account:account.account,provider_state:null,callback_expires_at:0};
     // Journal first fixes the one original session/ref across process loss.
     await check();if(!await jtx.compareAndSwap({expected_revision:null,value:{state:'prepared',admission,session,receipt}}))fail('EMAIL_NATIVE_ACTIVATION_CONFLICT');
     if(!await stx.compareAndSwap({expected_revision:null,value:session}))fail('EMAIL_NATIVE_ACTIVATION_CONFLICT');await check();return receipt;
    });
   });
  },
  async publish(raw,expected_receipt_digest){const admission=nativeActivationAdmission(raw);if(!hash(expected_receipt_digest))fail('EMAIL_NATIVE_ACTIVATION_INVALID');const check=checker(admission,'publish',expected_receipt_digest);await check();
   return store.withLock({key:journalKey(admission.scope)},async jtx=>{const journal=await jtx.read(),value=journal?.value;if(!value||canonical(value.admission)!==canonical(admission)||value.receipt.receipt_digest!==expected_receipt_digest||!['prepared','active'].includes(value.state))fail('EMAIL_NATIVE_ACTIVATION_CONFLICT');
    const account=await imported(admission,check);if(account.generation!==value.receipt.custody_generation||canonical(account.account)!==canonical(value.session.account))fail('EMAIL_NATIVE_ACTIVATION_PRINCIPAL_DENIED');
    const connected={...value.session,state:'connected'};
    await store.withLock({key:sessionKey(admission.session_id)},async tx=>{const row=await tx.read();if(!row||![canonical(value.session),canonical(connected)].includes(canonical(row.value)))fail('EMAIL_NATIVE_ACTIVATION_CONFLICT');await check();if(row.value.state!=='connected'&&!await tx.compareAndSwap({expected_revision:row.revision,value:connected}))fail('EMAIL_NATIVE_ACTIVATION_CONFLICT');});
    if(value.state==='prepared'){
     await store.withLock({key:'email.runtime.target.'+digest(admission.destination_scope)},async tx=>{await check();const row=await tx.read();if(!row||row.value.session_id!==admission.session_id||canonical(row.value.scope)!==canonical(admission.destination_scope)||row.value.kind!=='native_adoption'||!['reserved','connected'].includes(row.value.state))fail('EMAIL_NATIVE_ACTIVATION_CONFLICT');if(row.value.state==='reserved'&&!await tx.compareAndSwap({expected_revision:row.revision,value:{...row.value,state:'connected'}}))fail('EMAIL_NATIVE_ACTIVATION_CONFLICT');});
     await check();if(!await jtx.compareAndSwap({expected_revision:journal.revision,value:{...value,state:'active'}}))fail('EMAIL_NATIVE_ACTIVATION_CONFLICT');}
    await check();return structuredClone(value.receipt);
   });
  },
 });
}
/** Ordinary data access remains invisible while staging or publication is incomplete. */
export async function assertNativeSessionVisible({store,session}){
 if(!session?.account?.account_ref)return;
 const scope={org_id:session.scope.org_id,owner_user_id:session.scope.owner_user_id,account_id:session.account.account_ref};
 const stage=(await read(store,nativeAdoptionKey(scope)))?.value;if(!stage)return;
 const value=(await read(store,journalKey(scope)))?.value;
 if(!completeSource(stage)||stage.state!=='staged_verified'||value?.state!=='active'||value.admission.snapshot_digest!==stage.snapshot_digest||value.admission.adoption_id!==stage.adoption_id)fail('EMAIL_NATIVE_ACTIVATION_NOT_VISIBLE');
 await nativeContinuityEpochs({store,scope,session,original:{...value.session,state:'connected'}});
}
