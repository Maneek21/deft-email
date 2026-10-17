import {assertNoCredentialRepair} from './credential-repair-reservation.mjs';
import {randomBytes} from 'node:crypto';
import {canonical,digest,fail,validateRegistration} from './contract.mjs';
import {validateOAuthClient,oauthClientFingerprint,grantedOAuthCapabilities} from './vendor/providers/oauth-provider.mjs';
import {createEncryptedEmailCustody} from './vendor/providers/custody-encrypted.mjs';
import {sealPurposeSet,capabilitiesFor} from './purpose-set.mjs';
import {lineageKey,continuityPins,validateLineage,lineageVersion} from './account-lineage.mjs';
import {reserveTarget,advanceTarget} from './target-reservation.mjs';
import {CONTINUATION_VERSION,validateContinuationRequest,continuationPins,continuationReviewDigest,continuationReceiptDigest,createContinuationChecker} from './consent-continuation-contract.mjs';
const sessionKey=id=>'email.runtime.session.'+id;
const journalKey=id=>'email.runtime.consent_continuation.'+id;
const denied=()=>fail('EMAIL_RUNTIME_CONSENT_CONTINUATION_DENIED');
/** Expiry-only owner consent creates a new session. Provider custody and all old
 * operation/session records remain unchanged. The journal is durable before any
 * publication; recovering local writes never invokes OAuth or an effect port. */
export function createConsentContinuationRuntime({registration:raw,client,provider='gmail',store,encryption_key,key_id,assertCurrent,now=Date.now}){
 const registration=validateRegistration(raw);client=validateOAuthClient(provider,client);
 const fingerprint=oauthClientFingerprint(provider,client),custody=createEncryptedEmailCustody({store,encryption_key,key_id,now});
 function sourceFor(request,source){
  if(!source||source.state!=='connected'||source.session_id!==request.source.session_id||canonical(source.scope)!==canonical(request.source.scope)||source.runtime_session_ref!==request.source.runtime_session_ref||source.account?.account_ref!==request.source.account_ref||source.binding.account_id!==request.source.account_ref||source.client_fingerprint!==fingerprint||source.binding.provider!==provider||canonical(source.binding.scope)!==canonical({org_id:source.scope.org_id,owner_id:source.scope.owner_user_id,installation_id:source.scope.installation_id})||source.binding.connection_target!==source.scope.target_key||source.binding.resource_binding_id!==source.scope.resource_binding_id||canonical(source.action_consents)!==canonical(request.source.action_consents)||!source.purpose_set||canonical(source.purpose_set)!==canonical(sealPurposeSet(source.binding,source.action_consents,source.purpose_set.custody_generation))||canonical(source.binding.capabilities)!==canonical(capabilitiesFor(request.action_consents)))denied();
  return source;
 }
 function eligibility(record,source){
  if(record?.health!=='connected'||!record.secret?.identity?.provider_subject||record.secret.client_fingerprint!==fingerprint||canonical(record.binding)!==canonical(source.binding)||record.secret.identity.primary_address!==source.account.label||record.setup_generation!==source.purpose_set.custody_generation||capabilitiesFor(source.action_consents).some(capability=>!grantedOAuthCapabilities(source.binding,record.secret.scopes).includes(capability)))denied();
  return {account:source.account,custody_generation:record.setup_generation,custody_digest:'sha256:'+digest({binding:record.binding,health:record.health,setup_generation:record.setup_generation,identity:record.secret.identity,scopes:record.secret.scopes,client_fingerprint:fingerprint})};
 }
 return Object.freeze({async request(rawRequest,signal){
  const request=validateContinuationRequest(rawRequest),guard=createContinuationChecker({request,registration,assertCurrent,signal,now}),check=guard.check,base={schema_version:CONTINUATION_VERSION,session_id:request.session_id};
  try{await check();return await store.withLock({key:journalKey(request.session_id)},async jtx=>{
   let row=await jtx.read(),journal=row?.value;
   const persist=async value=>{await check();if(!await jtx.compareAndSwap({expected_revision:row?.revision??null,value}))fail('EMAIL_RUNTIME_CONFLICT');row=await jtx.read();journal=row.value;};
   if(journal&&canonical(journal.pins)!==canonical(continuationPins(request)))denied();
   if(request.operation==='status'&&!journal)return {...base,state:'indeterminate'};
   return store.withLock({key:sessionKey(request.source.session_id)},async stx=>{
    await assertNoCredentialRepair({store,scope:request.source.scope});const source=sourceFor(request,(await stx.read())?.value);
    return store.withLock({key:lineageKey(source.binding)},async ltx=>{
     let lineageRow=await ltx.read(),lineage=lineageRow?.value;
     const current=await custody.withAccount(source.binding,async tx=>{await check();return eligibility(tx.read(),source);});
     if(journal&&canonical(current)!==canonical(journal.eligibility))denied();
     if(!journal||journal.state==='eligible'){
      if(lineage){if(lineage.transport_digest!==request.transport_digest)denied();validateLineage(lineage,source);}
      if(request.operation==='status'&&request.review===null){await check();return {...base,state:'eligible',...current};}
      // Reject an exhausted lineage before reserving the next target or
      // creating an eligible journal. This leaves the 1,025th prepare with no
      // durable side effects or stranded target reservation.
      if((lineage?.receipts.length??0)>=1024)denied();
      if(request.operation==='prepare'){
       await reserveTarget({store,request,kind:'consent_continuation',check,now});
       if(!journal)await persist({schema_version:'email.runtime.consent_continuation_journal.v1',pins:continuationPins(request),state:'eligible',eligibility:current,review:null});
       await check();return {...base,state:'eligible',...current};
      }
      if(!journal||canonical(request.review)!==canonical({...current,digest:continuationReviewDigest(request,current)}))denied();
      const nextSession={session_id:request.session_id,scope:request.scope,action_consents:request.action_consents,purpose_set:sealPurposeSet(source.binding,request.action_consents,current.custody_generation),client_fingerprint:fingerprint,runtime_session_ref:randomBytes(32).toString('base64url'),binding:source.binding,state:'connected',account:source.account,provider_state:null,callback_expires_at:0};
      const receipt_digest=continuationReceiptDigest(request,request.review,nextSession.runtime_session_ref);
      const initial=lineage??{schema_version:'email.runtime.account_lineage.v1',pins:continuityPins(source),transport_digest:request.transport_digest,epochs:[source.binding.authority_epoch],receipts:[],base:{session_id:source.session_id,binding:source.binding,custody_generation:current.custody_generation},current:{session_id:source.session_id,binding:source.binding,custody_generation:current.custody_generation}};
      const nextLineage={...initial,schema_version:lineageVersion(initial,'email.runtime.account_lineage.v3'),receipts:[...initial.receipts,{kind:'consent_continuation',session_id:request.session_id,source_session_id:source.session_id,review_digest:request.review.digest,receipt_digest,authority_epoch:source.binding.authority_epoch,custody_generation:current.custody_generation,pins:continuationPins(request),review:request.review,runtime_session_ref:nextSession.runtime_session_ref,prior_binding:source.binding,current_binding:source.binding,purpose_set:nextSession.purpose_set}],pending:null,current:{session_id:request.session_id,binding:source.binding,custody_generation:current.custody_generation,receipt_digest}};
      validateLineage(nextLineage,nextSession);
      await persist({...journal,state:'activation_started',review:request.review,new_session:nextSession,receipt_digest,prior_lineage_digest:digest(lineage??null),next_lineage:nextLineage});
     }
     if(request.operation==='prepare')return {...base,state:'indeterminate'};
     if(canonical(request.review)!==canonical(journal.review))denied();
     if(journal.state==='connected'){
      const plannedDigest=journal.next_lineage_digest??(journal.next_lineage?digest(journal.next_lineage):null);
      if(typeof plannedDigest!=='string'||!/^[a-f0-9]{64}$/u.test(plannedDigest)||journal.next_lineage&&digest(journal.next_lineage)!==plannedDigest||digest(lineage??null)!==plannedDigest)denied();
      return store.withLock({key:sessionKey(request.session_id)},async ntx=>{
       const existing=await ntx.read();if(!existing||canonical(existing.value)!==canonical(journal.new_session))denied();
       validateLineage(lineage,journal.new_session);
      if(journal.receipt_digest!==continuationReceiptDigest(request,journal.review,journal.new_session.runtime_session_ref)||lineage.current?.receipt_digest!==journal.receipt_digest)denied();
       const targetKey='email.runtime.target.'+digest(request.scope),target=(await store.withLock({key:targetKey},tx=>tx.read()))?.value;
       if(target?.session_id!==request.session_id||target.kind!=='consent_continuation'||target.state!=='connected'||canonical(target.scope)!==canonical(request.scope))denied();
       await check();return {...base,state:'connected',account:source.account,runtime_session_ref:journal.new_session.runtime_session_ref,custody_generation:current.custody_generation,receipt_digest:journal.receipt_digest};
      });
     }
     if(journal.state!=='activation_started')denied();
     // A durable plan can only finish its exact local publication. Neither
     // custody nor source/effect history is rewritten on retries or status.
     if(digest(lineage??null)!==journal.prior_lineage_digest&&canonical(lineage)!==canonical(journal.next_lineage))denied();
     return store.withLock({key:sessionKey(request.session_id)},async ntx=>{
      const existing=await ntx.read();if(existing&&canonical(existing.value)!==canonical(journal.new_session))denied();
      if(!existing){await check();if(!await ntx.compareAndSwap({expected_revision:null,value:journal.new_session}))fail('EMAIL_RUNTIME_CONFLICT');}
      if(canonical(lineage)!==canonical(journal.next_lineage)){await check();if(!await ltx.compareAndSwap({expected_revision:lineageRow?.revision??null,value:journal.next_lineage}))fail('EMAIL_RUNTIME_CONFLICT');}
      const targetKey='email.runtime.target.'+digest(request.scope),target=(await store.withLock({key:targetKey},tx=>tx.read()))?.value;
      if(target?.session_id!==request.session_id||target.kind!=='consent_continuation'||canonical(target.scope)!==canonical(request.scope))denied();
      if(target.state==='prepared')await advanceTarget({store,request,from:'prepared',to:'connected',check});else if(target.state!=='connected')denied();
      await persist({schema_version:'email.runtime.consent_continuation_journal.v2',pins:journal.pins,state:'connected',eligibility:journal.eligibility,
       review:journal.review,new_session:journal.new_session,receipt_digest:journal.receipt_digest,next_lineage_digest:digest(journal.next_lineage)});
      await check();return {...base,state:'connected',account:source.account,runtime_session_ref:journal.new_session.runtime_session_ref,custody_generation:current.custody_generation,receipt_digest:journal.receipt_digest};
     });
    });
   });
  });}finally{guard.dispose();}
 }});
}


