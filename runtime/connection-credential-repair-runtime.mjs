import {randomBytes} from 'node:crypto';
import {canonical,digest,fail,validateRegistration} from './contract.mjs';
import {createEmailOAuth} from './vendor/providers/oauth-account.mjs';
import {createEncryptedEmailCustody} from './vendor/providers/custody-encrypted.mjs';
import {validateOAuthClient,oauthClientFingerprint} from './vendor/providers/oauth-provider.mjs';
import {sealPurposeSet} from './purpose-set.mjs';
import {createUpgradeChecker} from './upgrade-contract.mjs';
import {REPAIR_VERSION,validateRepairRequest,repairPins,repairReviewDigest,repairReceiptDigest,repairClosureDigest,repairIntentClosureDigest} from './credential-repair-contract.mjs';
import {reserveCredentialRepair,assertCredentialRepairReservation,closeCredentialRepairReservation,drainCredentialProviderOperations,wrapCredentialProviderBridge} from './credential-repair-reservation.mjs';
const sessionKey=id=>'email.runtime.session.'+id,journalKey=id=>'email.runtime.credential_repair.'+id;
const same=(a,b)=>canonical(a)===canonical(b),denied=()=>fail('EMAIL_RUNTIME_CREDENTIAL_REPAIR_DENIED');
/** Source lock waits for whole observation/data executions;
 * operation gate drains whole native calls including response decoding. Durable
 * reservation excludes admission. Status never repeats Begin or exchange. */
export function createCredentialRepairRuntime({registration:rawRegistration,client,provider='gmail',store,encryption_key,key_id,assertCurrent,fetch:fetchImpl=globalThis.fetch,now=Date.now,commitRepair,commitClosure,assertHostAcknowledgement,inspectPublication,inspectHistoricalAttempts}){
 const registration=validateRegistration(rawRegistration);client=validateOAuthClient(provider,client);const fingerprint=oauthClientFingerprint(provider,client),custody=createEncryptedEmailCustody({store,encryption_key,key_id,now});
 if(typeof commitRepair!=='function'||typeof assertHostAcknowledgement!=='function'||typeof inspectPublication!=='function')fail('EMAIL_RUNTIME_REPAIR_COMMIT_PORT_REQUIRED');
 function sourceValid(request,source){if(!source||source.state!=='connected'||source.session_id!==request.source.session_id||!same(source.scope,request.scope)||source.runtime_session_ref!==request.source.runtime_session_ref||source.account?.account_ref!==request.source.account_ref||source.binding.account_id!==request.source.account_ref||source.client_fingerprint!==fingerprint||source.binding.provider!==provider||!same(source.action_consents??(source.action_consent?[source.action_consent]:[]),request.action_consents))denied();}
 function eligible(request,source,record,publication_continuity_digest){
  if(!record||!['connected','reauth_required','refresh_pending'].includes(record.health)||!same(record.binding,source.binding)||record.secret?.client_fingerprint!==fingerprint||!record.secret?.identity?.provider_subject||record.secret.identity.primary_address!==source.account.label)denied();
  const generation=record.setup_generation,identity_digest='sha256:'+digest({binding:record.binding,identity:record.secret.identity,client_fingerprint:fingerprint,scopes:[...record.secret.scopes].sort()}),custody_digest='sha256:'+digest({binding:record.binding,generation,health:record.health,identity_digest});
  if(!/^sha256:[a-f0-9]{64}$/.test(publication_continuity_digest??''))denied();
  const fence={reservation_id:request.session_id,repair_session_id:request.session_id,source_session_id:request.source.session_id,source_revision:request.source.session_revision,account_ref:request.source.account_ref,resource_binding_id:request.scope.resource_binding_id,old_custody_generation:generation,planned_custody_generation:generation+1,identity_digest,historical_attempts:request.historical_attempts,publication_continuity_digest};
  return {account:source.account,custody_generation:generation,custody_digest,fence:{...fence,fence_digest:'sha256:'+digest({schema_version:'email.runtime.credential_repair_fence.v1',...fence})}};
 }
 return Object.freeze({async request(raw,signal){const requestStarted=performance.now();let authorityChecks=0,authorityElapsedMs=0,authorityErrorCode=null;const request=validateRepairRequest(raw),guard=createUpgradeChecker({request,registration,assertCurrent,signal,now,admittedCallback:true}),check=async()=>{authorityChecks++;const started=performance.now();try{return await guard.check();}catch(error){authorityErrorCode=error?.code==='EMAIL_RUNTIME_AUTHORITY_DENIED'?error.code:guard.signal.aborted?'EMAIL_RUNTIME_AUTHORITY_INTERRUPTED':'OPAQUE_AUTHORITY_ERROR';throw error;}finally{authorityElapsedMs+=performance.now()-started;}},base={schema_version:REPAIR_VERSION,session_id:request.session_id};
  let callbackStage='request_admitted';
  try{await check();return await store.withLock({key:journalKey(request.session_id)},async jtx=>{
   let row=await jtx.read(),journal=row?.value;const persist=async value=>{await check();if(!await jtx.compareAndSwap({expected_revision:row?.revision??null,value}))fail('EMAIL_RUNTIME_CONFLICT');row=await jtx.read();journal=row.value;};
   if(journal&&!same(journal.pins,repairPins(request)))denied();
   const cancelMissingIntent=!journal&&request.operation==='status'&&request.close_prepared===true&&request.review===null&&request.runtime_session_ref===null;
   // Historical run journals precede session locks in worker order. Inspect
   // exact immutable UNKNOWN pins before holding the source session; never
   // invert journal→session by acquiring their locks during drain.
   if(request.operation==='prepare'||cancelMissingIntent){if(typeof inspectHistoricalAttempts!=='function'||await inspectHistoricalAttempts({request,check})!==true)denied();}
   return store.withLock({key:sessionKey(request.source.session_id)},async stx=>{
    const source=(await stx.read())?.value;sourceValid(request,source);
    let generation=journal?.eligibility.custody_generation;
    if(cancelMissingIntent){
     // The Host authenticated the original unconsumed intent. Reconstruct only
     // its local cancellation proof; never prepare Begin or call the provider.
     const record=await custody.withAccount(source.binding,tx=>tx.read()),publication_continuity_digest=await inspectPublication({request,source,check}),eligibility=eligible(request,source,record,publication_continuity_digest);
     await persist({schema_version:'email.runtime.credential_repair_journal.v1',pins:repairPins(request),state:'preparing',eligibility});generation=eligibility.custody_generation;
    }
    const finishPrepare=async()=>{
     await reserveCredentialRepair({store,request,check});await drainCredentialProviderOperations({store,request,check});
     const record=await custody.withAccount(source.binding,tx=>tx.read()),publication_continuity_digest=await inspectPublication({request,source,check}),eligibility=eligible(request,source,record,publication_continuity_digest);
     if(journal.eligibility.custody_generation!==eligibility.custody_generation||!same(journal.eligibility.fence,eligibility.fence)||journal.state==='eligible'&&!same(journal.eligibility,eligibility))denied();
     if(journal.state==='preparing')await persist({...journal,state:'eligible',eligibility});
     return {...base,state:'eligible',...journal.eligibility};
    };
    const close=async(reason)=>{const review=journal.review??{...journal.eligibility,digest:repairReviewDigest(request,journal.eligibility)},custody_generation=generation+(reason==='prepared_cancelled'?0:1),closure={reason,custody_generation,receipt_digest:repairClosureDigest(request,review,reason,custody_generation)};await persist({...journal,state:reason==='provider_denied'?'denied':reason==='callback_expired'?'expired':'cancelled',review,closure,provider_state:null});};
    const commit=async()=>{
     if(!journal?.new_session||journal.receipt_digest!==repairReceiptDigest(request,journal.review,journal.new_session.runtime_session_ref))denied();
     const record=await custody.withAccount(source.binding,tx=>tx.read());if(!record||record.health!=='connected'||record.setup_generation!==generation+1||!same(record.binding,source.binding)||record.secret.identity.provider_subject!==journal.provider_subject||record.secret.client_fingerprint!==fingerprint||!same([...record.secret.scopes].sort(),journal.scopes))denied();
     await commitRepair({request,source,new_session:journal.new_session,receipt_digest:journal.receipt_digest,review:journal.review,check});
     await store.withLock({key:sessionKey(request.session_id)},async tx=>{await check();const row=await tx.read();if(row&&!same(row.value,journal.new_session))denied();if(!row&&!await tx.compareAndSwap({expected_revision:null,value:journal.new_session}))fail('EMAIL_RUNTIME_CONFLICT');});
     if(journal.state==='provider_result')await persist({...journal,state:'host_ack_pending'});
    };
    if(request.operation==='status'){
     if(!journal)return {...base,state:'indeterminate'};
     if(request.close_uncertain&&journal.state==='exchange_started'){
      // Explicit abandonment closes only local custody admission. It says
      // nothing about whether the provider consumed the original code.
      // Holding journal -> source excludes the entire original callback,
      // including its custody write; the native operation gate drains readers.
      if(now()<Date.parse(request.review_expires_at)||!same(request.review,journal.review)||request.runtime_session_ref!==journal.runtime_session_ref||journal.new_session||journal.receipt_digest||journal.closure)denied();
      await assertCredentialRepairReservation({store,request,check});await drainCredentialProviderOperations({store,request,check});
      const record=await custody.withAccount(source.binding,tx=>tx.read());
      if(!record||!['reauth_required','refresh_pending'].includes(record.health)||record.setup_generation!==generation+1||!same(record.binding,source.binding)||record.secret?.client_fingerprint!==fingerprint||record.secret.identity?.provider_subject!==journal.provider_subject||record.secret.identity?.primary_address!==source.account.label||!same([...record.secret.scopes].sort(),journal.scopes))denied();
      try{await custody.takeState({scope:source.binding.scope,state:journal.provider_state,browser_binding:'email.runtime.credential_repair:'+request.session_id});}catch(error){if(!['EMAIL_OAUTH_STATE_EXPIRED','EMAIL_OAUTH_STATE_REPLAY'].includes(error.code))throw error;}
      await persist({...journal,abandoned_from_state:'exchange_started',exchange_outcome:'unknown',abandoned_provider_state_digest:'sha256:'+digest(journal.provider_state)});
      await close('exchange_abandoned');
     }
     // Recover only the exact durable, unconsumed prepare intent locally. No
     // Begin/exchange is repeated. Host can adopt this eligible reply, then
     // explicitly cancel through the existing reviewed closure contract.
     if(journal.state==='preparing'){
      if(!request.close_prepared)return finishPrepare();
      if(request.review!==null||request.runtime_session_ref!==null)denied();
      await reserveCredentialRepair({store,request,check});await drainCredentialProviderOperations({store,request,check});
      const record=await custody.withAccount(source.binding,tx=>tx.read()),old=journal.eligibility,proof=eligible(request,source,record,old.fence.publication_continuity_digest);
      if(proof.custody_generation!==old.custody_generation||proof.fence.identity_digest!==old.fence.identity_digest)denied();
      const closure={reason:'intent_cancelled',custody_generation:generation,intent_fence:old.fence,receipt_digest:repairIntentClosureDigest(request,old.fence,generation)};
      await persist({...journal,state:'cancelled',closure,provider_state:null});
     }
     if(request.close_prepared&&journal.state==='eligible')await close('prepared_cancelled');
     if(request.close_expired&&['awaiting_callback','expiry_closure_started'].includes(journal.state)){
      if(now()<Date.parse(request.review_expires_at)||!same(request.review,journal.review)||request.runtime_session_ref!==journal.runtime_session_ref)denied();
      const recovering=journal.state==='expiry_closure_started';if(!recovering)await persist({...journal,state:'expiry_closure_started'});
      try{await custody.takeState({scope:source.binding.scope,state:journal.provider_state,browser_binding:'email.runtime.credential_repair:'+request.session_id});}catch(error){if(error.code!=='EMAIL_OAUTH_STATE_EXPIRED'&&!(recovering&&error.code==='EMAIL_OAUTH_STATE_REPLAY'))throw error;}
      await close('callback_expired');
     }
     if(['denied','expired','cancelled'].includes(journal.state)){
      const closureDigest=journal.closure.reason==='intent_cancelled'?repairIntentClosureDigest(request,journal.closure.intent_fence,journal.closure.custody_generation):repairClosureDigest(request,journal.review,journal.closure.reason,journal.closure.custody_generation);
      if(journal.closure.receipt_digest!==closureDigest)denied();
      if(request.acknowledged_closure){await assertHostAcknowledgement({request,closure:journal.closure,receipt_digest:journal.closure.receipt_digest,custody_generation:journal.closure.custody_generation,check});
       if(journal.closure.custody_generation!==generation){if(typeof commitClosure!=='function')fail('EMAIL_RUNTIME_REPAIR_CLOSURE_PORT_REQUIRED');const record=await custody.withAccount(source.binding,tx=>tx.read());if(record.setup_generation!==journal.closure.custody_generation||record.secret.identity.provider_subject!==journal.provider_subject||!same([...record.secret.scopes].sort(),journal.scopes))denied();await commitClosure({request,source,sourceTx:stx,review:journal.review,closure:journal.closure,check});}
       await closeCredentialRepairReservation({store,request,check,receipt_digest:journal.closure.receipt_digest});await persist({...journal,reservation_closed:true});
      }
      return {...base,state:journal.state,closure:journal.closure,reservation_closed:journal.reservation_closed===true};
     }
     if(journal.state==='eligible')return {...base,state:'eligible',...journal.eligibility};
     if(!['provider_result','host_ack_pending','connected'].includes(journal.state)||!same(request.review,journal.review)||request.runtime_session_ref!==journal.new_session.runtime_session_ref)return {...base,state:'indeterminate'};
     await commit();
     if(request.acknowledged_receipt){await assertHostAcknowledgement({request,receipt_digest:journal.receipt_digest,custody_generation:generation+1,check});await closeCredentialRepairReservation({store,request,check,receipt_digest:journal.receipt_digest});await persist({...journal,state:'connected'});}
     return {...base,state:'connected',account:source.account,runtime_session_ref:journal.new_session.runtime_session_ref,custody_generation:generation+1,receipt_digest:journal.receipt_digest,reservation_closed:journal.state==='connected'};
    }
    if(request.operation==='prepare'){
     if(journal&&!['eligible','preparing'].includes(journal.state))return {...base,state:'indeterminate'};
     // Deterministic proof failures must not strand a reservation. Preflight
     // under the source lock, persist its exact intent, then reserve and drain.
     if(!journal){const record=await custody.withAccount(source.binding,tx=>tx.read()),publication_continuity_digest=await inspectPublication({request,source,check}),eligibility=eligible(request,source,record,publication_continuity_digest);await persist({schema_version:'email.runtime.credential_repair_journal.v1',pins:repairPins(request),state:'preparing',eligibility});}
     return finishPrepare();
    }
    if(!journal||!same(request.review,{...journal.eligibility,digest:repairReviewDigest(request,journal.eligibility)}))denied();
    if(request.operation==='begin'&&journal.state!=='eligible'||request.operation==='callback'&&journal.state!=='awaiting_callback')return {...base,state:'indeterminate'};
    const binding=source.binding,browser_binding='email.runtime.credential_repair:'+request.session_id;

    const oauth=createEmailOAuth({onCompleteStage:stage=>{callbackStage=stage;},clients:{[provider]:client},custody,now,fetch:async(url,options={})=>{await check();return fetchImpl(url,{...options,signal:AbortSignal.any([guard.signal,options.signal].filter(Boolean))});},host:{async resolveAccount(input){await check();if(!same(input.scope,binding.scope)||input.account_id!==binding.account_id||input.purpose!=='connect')denied();return binding;},async assertAuthority(){return {allowed:true,expires_at:await check()};}},beforeCredentialWrite:async({credentials,setup_generation})=>{if(setup_generation!==generation+1||credentials.identity.provider_subject!==journal.provider_subject||credentials.client_fingerprint!==fingerprint||credentials.identity.primary_address!==source.account.label||!same([...credentials.scopes].sort(),journal.scopes))denied();await check();}});
    if(request.operation==='begin'){
     const record=await custody.withAccount(binding,tx=>tx.read());if(!same(eligible(request,source,record,journal.eligibility.fence.publication_continuity_digest),journal.eligibility))denied();
     await persist({...journal,state:'begin_started',review:request.review,provider_subject:record.secret.identity.provider_subject,scopes:[...record.secret.scopes].sort(),runtime_session_ref:randomBytes(32).toString('base64url')});
     const begun=await oauth.begin({scope:binding.scope,account_id:binding.account_id,browser_binding}),url=new URL(begun.authorization_url),provider_state=url.searchParams.get('state');url.searchParams.set('state',request.callback_state);await persist({...journal,state:'awaiting_callback',provider_state,callback_expires_at:begun.expires_at});
     return {...base,state:'awaiting_callback',runtime_session_ref:journal.runtime_session_ref,authorization_url:url.href,custody_generation:generation+1};
    }
    if(request.runtime_session_ref!==journal.runtime_session_ref)denied();await persist({...journal,state:'exchange_started'});
    if(request.callback.outcome==='denied'){await custody.takeState({scope:binding.scope,state:journal.provider_state,browser_binding});await close('provider_denied');return {...base,state:'denied',closure:journal.closure,reservation_closed:false};}
    const account=await oauth.complete({scope:binding.scope,state:journal.provider_state,browser_binding,code:request.callback.code});if(account.account_id!==binding.account_id)denied();
    callbackStage='provider_verified';
    const new_session={...source,session_id:request.session_id,runtime_session_ref:journal.runtime_session_ref,action_consents:request.action_consents,purpose_set:sealPurposeSet(binding,request.action_consents,generation+1),provider_state:null,callback_expires_at:0};delete new_session.action_consent;
    const receipt_digest=repairReceiptDigest(request,request.review,new_session.runtime_session_ref);await persist({...journal,state:'provider_result',new_session,receipt_digest,provider_state:null});callbackStage='provider_receipt_persisted';await commit();
    try{console.info(JSON.stringify({event:'email_credential_repair_callback_completed',session_id:request.session_id,elapsed_ms:Math.round(performance.now()-requestStarted),authority_checks:authorityChecks,authority_elapsed_ms:Math.round(authorityElapsedMs)}));}catch{}
    return {...base,state:'connected',reservation_closed:false,account:source.account,runtime_session_ref:new_session.runtime_session_ref,custody_generation:generation+1,receipt_digest};
   });
  });}catch(error){if(request.operation==='callback'){
     const codes=new Set(['EMAIL_RUNTIME_AUTHORITY_DENIED','EMAIL_RUNTIME_CONFLICT','EMAIL_OAUTH_PROVIDER_UNAVAILABLE','EMAIL_OAUTH_REAUTH_REQUIRED','EMAIL_OAUTH_PROVIDER_IDENTITY_INVALID','EMAIL_OAUTH_PROVIDER_IDENTITY_DENIED','EMAIL_OAUTH_PROVIDER_SCOPE_DENIED','EMAIL_OAUTH_PROVIDER_REQUEST_FAILED','EMAIL_OAUTH_RECONNECT_IDENTITY_CHANGED','EMAIL_OAUTH_REFRESH_TOKEN_REQUIRED','EMAIL_OAUTH_TOKEN_RESPONSE_INVALID','EMAIL_OAUTH_IDENTITY_SCOPE_REQUIRED','EMAIL_OAUTH_STATE_EXPIRED','EMAIL_OAUTH_STATE_REPLAY','EMAIL_OAUTH_AUTHORITY_DENIED','EMAIL_OAUTH_CUSTODY_UNAVAILABLE','EMAIL_OAUTH_SETUP_SUPERSEDED','EMAIL_RUNTIME_CREDENTIAL_REPAIR_DENIED']);
     try{console.info(JSON.stringify({event:'email_credential_repair_callback_failed',session_id:request.session_id,stage:callbackStage,code:codes.has(error?.code)?error.code:'OPAQUE_LOCAL_ERROR',provider_outcome:callbackStage==='provider_receipt_persisted'?'durable_receipt':'unknown',elapsed_ms:Math.round(performance.now()-requestStarted),authority_checks:authorityChecks,authority_elapsed_ms:Math.round(authorityElapsedMs),authority_error_code:authorityErrorCode}));}catch{}
}throw error;}finally{guard.dispose();}
 }});
}

