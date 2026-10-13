import {assertNoCredentialRepair} from './credential-repair-reservation.mjs';
import {randomBytes} from 'node:crypto';
import {canonical,digest,fail,validateRegistration} from './contract.mjs';
import {createEmailOAuth} from './vendor/providers/oauth-account.mjs';
import {createEncryptedEmailCustody} from './vendor/providers/custody-encrypted.mjs';
import {validateOAuthClient,oauthClientFingerprint,grantedOAuthCapabilities} from './vendor/providers/oauth-provider.mjs';
import {createDraftStore} from './draft-store.mjs';
import {createResourcePlanStore} from './resource-plan-store.mjs';
import {lineageKey,continuityPins,validateLineage} from './account-lineage.mjs';
import {capabilitiesFor,credentialAnchor,sealPurposeSet} from './purpose-set.mjs';
import {UPGRADE_VERSION,validateUpgradeRequest,upgradePins,upgradeReviewDigest,upgradeReceiptDigest,upgradeClosureDigest,createUpgradeChecker} from './upgrade-contract.mjs';
import {reserveUpgradeTarget,advanceTarget,endTarget} from './target-reservation.mjs';

const sessionKey=id=>'email.runtime.session.'+id,journalKey=id=>'email.runtime.upgrade.'+id;
const read=(store,key)=>store.withLock({key},tx=>tx.read());
const unchanged=['org_id','owner_user_id','installation_id','target_key','resource_key','operator_user_id'];
/** Exact reviewed OAuth replaces credentials only for the verified same
 * principal/account. Intent precedes state/custody/provider I/O. Status reads
 * journals and exact current custody only; it cannot resume Begin or callback. */
export function createUpgradeRuntime({registration:rawRegistration,client,provider='gmail',store,encryption_key,key_id,assertCurrent,fetch:fetchImpl=globalThis.fetch,now=Date.now}){
 const registration=validateRegistration(rawRegistration);client=validateOAuthClient(provider,client);const fingerprint=oauthClientFingerprint(provider,client),custody=createEncryptedEmailCustody({store,encryption_key,key_id,now}),drafts=createDraftStore({store,now}),resourcePlans=createResourcePlanStore({store,now});
 function validSource(request,source){if(!source||source.state!=='connected'||source.session_id!==request.source.session_id||canonical(source.scope)!==canonical(request.source.scope)||source.runtime_session_ref!==request.source.runtime_session_ref||source.account?.account_ref!==request.source.account_ref||source.binding.account_id!==request.source.account_ref||source.client_fingerprint!==fingerprint||source.binding.provider!==provider||source.binding.connection_target!==source.scope.target_key||source.binding.resource_binding_id!==source.scope.resource_binding_id||canonical(source.binding.scope)!==canonical({org_id:source.scope.org_id,owner_id:source.scope.owner_user_id,installation_id:source.scope.installation_id})||unchanged.some(k=>source.scope[k]!==request.scope[k])||request.scope.lifecycle_epoch<source.scope.lifecycle_epoch||request.scope.grant_epoch<source.scope.grant_epoch)fail('EMAIL_RUNTIME_UPGRADE_DENIED');}
 const plan=(request,source)=>({...source.binding,resource_binding_id:request.scope.resource_binding_id,action_binding_id:request.action_consents.length?credentialAnchor(source.binding.account_id,source.binding.action_binding_id):source.binding.action_binding_id,authority_epoch:source.binding.authority_epoch+1,capabilities:capabilitiesFor(request.action_consents)});
 function eligibility(record,source,request){if(!record||!['connected','reauth_required'].includes(record.health)||canonical(record.binding)!==canonical(source.binding)||record.secret?.client_fingerprint!==fingerprint||record.secret.identity?.primary_address!==source.account.label||!record.secret.identity?.provider_subject||!grantedOAuthCapabilities(record.binding,record.secret.scopes).includes('read'))fail('EMAIL_RUNTIME_UPGRADE_DENIED');return {account:source.account,custody_generation:record.setup_generation,custody_digest:'sha256:'+digest({binding:record.binding,health:record.health,setup_generation:record.setup_generation,identity:record.secret.identity,scopes:record.secret.scopes,client_fingerprint:fingerprint,planned_binding:plan(request,source),planned_purpose_set:request.action_consents})};}
 const noEffects=async(source,check)=>{await drafts.assertNoPendingEffects({org_id:source.scope.org_id,owner_user_id:source.scope.owner_user_id,account_id:source.binding.account_id},check);await resourcePlans.assertNoPendingEffects({org_id:source.scope.org_id,owner_user_id:source.scope.owner_user_id,account_id:source.binding.account_id});await check();};
 return Object.freeze({async request(raw,signal){const request=validateUpgradeRequest(raw),guard=createUpgradeChecker({request,registration,assertCurrent,signal,now}),check=guard.check,base={schema_version:UPGRADE_VERSION,session_id:request.session_id};
  try{await check();return await store.withLock({key:journalKey(request.session_id)},async jtx=>{
   let row=await jtx.read(),journal=row?.value;const persist=async value=>{await check();if(!await jtx.compareAndSwap({expected_revision:row?.revision??null,value}))fail('EMAIL_RUNTIME_CONFLICT');row=await jtx.read();journal=row.value;};
   if(journal&&canonical(journal.pins)!==canonical(upgradePins(request)))fail('EMAIL_RUNTIME_UPGRADE_DENIED');
   if(request.operation==='status'){
    if(!journal)return {...base,state:'indeterminate'};
    if(request.close_expired&&['awaiting_callback','expiry_closing','expired'].includes(journal.state)){
     if(Date.parse(request.review_expires_at)>now()||!journal.review||canonical(request.review)!==canonical(journal.review)
      ||request.runtime_session_ref!==null&&request.runtime_session_ref!==journal.runtime_session_ref||journal.new_session||journal.receipt_digest)return {...base,state:'indeterminate'};
     const closure={reason:'callback_expired',custody_generation:journal.review.custody_generation+1,receipt_digest:upgradeClosureDigest(request,journal.review)};
     if(journal.closure&&canonical(journal.closure)!==canonical(closure)||journal.state!=='awaiting_callback'&&!journal.closure)fail('EMAIL_RUNTIME_UPGRADE_DENIED');
     if(journal.state==='expired'){await check();return {...base,state:'expired',closure};}
     return store.withLock({key:sessionKey(request.source.session_id)},async stx=>{
      const source=(await stx.read())?.value;await assertNoCredentialRepair({store,scope:request.source.scope});validSource(request,source);await noEffects(source,check);
      if(await read(store,sessionKey(request.session_id)))fail('EMAIL_RUNTIME_UPGRADE_DENIED');
      return store.withLock({key:lineageKey(source.binding)},async ltx=>{
       const lineageRow=await ltx.read(),lineage=lineageRow?.value;
       if(!lineage||lineage.transport_digest!==request.transport_digest||lineage.current.session_id!==source.session_id
        ||lineage.pending&&lineage.pending!==request.session_id)fail('EMAIL_RUNTIME_UPGRADE_DENIED');
       const receipt={session_id:request.session_id,pins:upgradePins(request),review:journal.review,closure},prior=(lineage.expired_upgrades??[]).find(item=>item.session_id===request.session_id);
       if(prior&&(canonical(prior)!==canonical(receipt)||lineage.pending)||!prior&&lineage.pending!==request.session_id)fail('EMAIL_RUNTIME_UPGRADE_DENIED');
       validateLineage({...lineage,pending:null},source);
       return custody.withAccount(source.binding,async tx=>{
        const current=tx.read();
        if(current?.setup_generation!==closure.custody_generation||current.secret?.identity?.provider_subject!==journal.provider_subject
         ||canonical(journal.new_binding)!==canonical(plan(request,source))||canonical(eligibility({...current,setup_generation:journal.review.custody_generation},source,request))!==canonical(journal.eligibility))fail('EMAIL_RUNTIME_UPGRADE_DENIED');
        if(!prior&&lineage.current.custody_generation!==journal.review.custody_generation)fail('EMAIL_RUNTIME_UPGRADE_DENIED');
        if(!prior&&(lineage.expired_upgrades?.length??0)>=1024)fail('EMAIL_RUNTIME_UPGRADE_DENIED');
        // The original journal closes durably before either admission fence opens.
        // A restart completes only this exact closure; no OAuth state or custody is rewritten.
        if(journal.state==='awaiting_callback')await persist({...journal,state:'expiry_closing',closure});
        await endTarget({store,request,check});
        if(!prior){await check();if(!await ltx.compareAndSwap({expected_revision:lineageRow.revision,value:{...lineage,pending:null,expired_upgrades:[...(lineage.expired_upgrades??[]),receipt],current:{...lineage.current,custody_generation:closure.custody_generation}}}))fail('EMAIL_RUNTIME_CONFLICT');}
        await persist({...journal,state:'expired'});await check();return {...base,state:'expired',closure};
       });
      });
     });
    }
    if(journal.state==='eligible'){
     if(request.review!==null&&canonical(request.review)!==canonical({...journal.eligibility,digest:upgradeReviewDigest(request,journal.eligibility)}))return {...base,state:'indeterminate'};
     return store.withLock({key:sessionKey(request.source.session_id)},async tx=>{const source=(await tx.read())?.value;validSource(request,source);await noEffects(source,check);const current=await custody.withAccount(source.binding,tx=>eligibility(tx.read(),source,request));if(canonical(current)!==canonical(journal.eligibility))return {...base,state:'indeterminate'};await check();return {...base,state:'eligible',...current};});
    }
    if(!['connected','commit_started'].includes(journal.state)||!journal.new_session||canonical(request.review)!==canonical(journal.review)||request.runtime_session_ref!==null&&request.runtime_session_ref!==journal.new_session.runtime_session_ref)return {...base,state:'indeterminate'};
    const session=(await read(store,sessionKey(request.session_id)))?.value,lineage=(await read(store,lineageKey(journal.new_session.binding)))?.value;
    if(!session||canonical(session)!==canonical(journal.new_session)||!lineage||lineage.pending||lineage.current.session_id!==request.session_id)return {...base,state:'indeterminate'};validateLineage(lineage,session);
    const current=await custody.withAccount(session.binding,tx=>tx.read());if(!current||canonical(current.binding)!==canonical(session.binding)||current.health!=='connected'||current.setup_generation!==journal.review.custody_generation+1||current.secret?.identity?.provider_subject!==journal.provider_subject||current.secret.client_fingerprint!==fingerprint||lineage.current.receipt_digest!==journal.receipt_digest)return {...base,state:'indeterminate'};
    await check();return {...base,state:'connected',account:session.account,runtime_session_ref:session.runtime_session_ref,custody_generation:current.setup_generation,receipt_digest:journal.receipt_digest};
   }
   if(journal&&request.operation==='prepare'&&journal.state!=='eligible'||journal&&request.operation==='begin'&&journal.state!=='eligible'||journal&&request.operation==='callback'&&journal.state!=='awaiting_callback')return {...base,state:'indeterminate'};
   return store.withLock({key:sessionKey(request.source.session_id)},async stx=>{
    const source=(await stx.read())?.value;await assertNoCredentialRepair({store,scope:request.source.scope});validSource(request,source);await noEffects(source,check);
    return store.withLock({key:lineageKey(source.binding)},async ltx=>{
     const lineageRow=await ltx.read(),lineage=lineageRow?.value;if(lineage){if(lineage.pending&&lineage.pending!==request.session_id||lineage.transport_digest!==request.transport_digest)fail('EMAIL_RUNTIME_UPGRADE_DENIED');if(!lineage.pending)validateLineage(lineage,source);}
     if(request.operation==='prepare'){
      const current=await custody.withAccount(source.binding,tx=>eligibility(tx.read(),source,request));if(journal&&canonical(current)!==canonical(journal.eligibility))return {...base,state:'indeterminate'};
      await reserveUpgradeTarget({store,request,check,now});
      await store.withLock({key:'email.runtime.registration.'+digest([registration.org_id,registration.runtime_registration_id,registration.runtime_epoch,registration.profile_digest])},async tx=>{await check();const row=await tx.read(),value={schema_version:'email.runtime.registration_client.v1',registration,client_fingerprint:fingerprint};if(row&&canonical(row.value)!==canonical(value))fail('EMAIL_RUNTIME_CLIENT_REGISTRATION_CHANGED');if(!row&&!await tx.compareAndSwap({expected_revision:null,value}))fail('EMAIL_RUNTIME_CONFLICT');});
      if(!journal)await persist({schema_version:'email.runtime.upgrade_journal.v1',pins:upgradePins(request),state:'eligible',eligibility:current,review:null});await check();return {...base,state:'eligible',...current};
     }
     if(!journal||canonical(request.review)!==canonical({...journal.eligibility,digest:upgradeReviewDigest(request,journal.eligibility)}))fail('EMAIL_RUNTIME_UPGRADE_DENIED');
     const new_binding=plan(request,source),generation=journal.eligibility.custody_generation+1;
     if(new_binding.authority_epoch>2147483646||generation>2147483646||(lineage?.receipts.length??0)>=1024)fail('EMAIL_RUNTIME_UPGRADE_DENIED');
     const initial=lineage??{schema_version:'email.runtime.account_lineage.v1',pins:continuityPins(source),transport_digest:request.transport_digest,epochs:[source.binding.authority_epoch],receipts:[],base:{session_id:source.session_id,binding:source.binding,custody_generation:journal.eligibility.custody_generation},current:{session_id:source.session_id,binding:source.binding,custody_generation:journal.eligibility.custody_generation}};
     if(request.operation==='begin'){
      const prior=await custody.withAccount(source.binding,tx=>tx.read());if(canonical(eligibility(prior,source,request))!==canonical(journal.eligibility))fail('EMAIL_RUNTIME_UPGRADE_DENIED');
      if(await read(store,sessionKey(request.session_id)))fail('EMAIL_RUNTIME_UPGRADE_DENIED');
      await advanceTarget({store,request,from:'prepared',to:'activating',check});
      await persist({...journal,state:'begin_started',review:request.review,new_binding,runtime_session_ref:randomBytes(32).toString('base64url'),provider_subject:prior.secret.identity.provider_subject,provider_state:null});
      await check();if(!await ltx.compareAndSwap({expected_revision:lineageRow?.revision??null,value:{...initial,pending:request.session_id}}))fail('EMAIL_RUNTIME_CONFLICT');
     }else if(!journal||journal.state!=='awaiting_callback'||request.runtime_session_ref!==journal.runtime_session_ref||canonical(journal.new_binding)!==canonical(new_binding)||lineage?.pending!==request.session_id)fail('EMAIL_RUNTIME_UPGRADE_DENIED');
     const browser_binding='email.runtime.upgrade:'+request.session_id,binding=journal.new_binding,oauth=createEmailOAuth({clients:{[provider]:client},custody,now,fetch:async(url,options={})=>{await check();return fetchImpl(url,{...options,signal:AbortSignal.any([guard.signal,options.signal].filter(Boolean))});},host:{async resolveAccount(input){await check();if(canonical(input.scope)!==canonical(binding.scope)||input.account_id!==binding.account_id||input.purpose!=='connect')fail('EMAIL_RUNTIME_UPGRADE_DENIED');return binding;},async assertAuthority(){return {allowed:true,expires_at:await check()};}}});
     if(request.operation==='begin'){
      const begun=await oauth.begin({scope:binding.scope,account_id:binding.account_id,browser_binding}),url=new URL(begun.authorization_url),provider_state=url.searchParams.get('state');url.searchParams.set('state',request.callback_state);await persist({...journal,state:'awaiting_callback',provider_state});await check();return {...base,state:'awaiting_callback',runtime_session_ref:journal.runtime_session_ref,authorization_url:url.href};
     }
     await persist({...journal,state:'callback_started'});
     if(request.callback.outcome==='denied'){await custody.takeState({scope:binding.scope,state:journal.provider_state,browser_binding});await persist({...journal,state:'indeterminate',provider_state:null});return {...base,state:'indeterminate'};}
     const account=await oauth.complete({scope:binding.scope,state:journal.provider_state,browser_binding,code:request.callback.code});if(account.account_id!==source.binding.account_id||account.primary_address!==source.account.label)fail('EMAIL_RUNTIME_UPGRADE_DENIED');
     const actual=await custody.withAccount(binding,tx=>tx.read());if(canonical(actual.binding)!==canonical(binding)||actual.setup_generation!==generation||actual.secret.identity.provider_subject!==journal.provider_subject||actual.secret.client_fingerprint!==fingerprint||!grantedOAuthCapabilities(binding,actual.secret.scopes).includes('read'))fail('EMAIL_RUNTIME_UPGRADE_DENIED');
     const new_session={session_id:request.session_id,scope:request.scope,action_consents:request.action_consents,purpose_set:sealPurposeSet(binding,request.action_consents,generation),client_fingerprint:fingerprint,runtime_session_ref:journal.runtime_session_ref,binding,state:'connected',account:source.account,provider_state:null,callback_expires_at:0},receipt_digest=upgradeReceiptDigest(request,request.review,new_session.runtime_session_ref);
     await persist({...journal,state:'commit_started',new_session,receipt_digest,provider_state:null});
     const latest=await ltx.read(),next={...initial,schema_version:initial.schema_version==='email.runtime.account_lineage.v3'?initial.schema_version:'email.runtime.account_lineage.v2',pins:continuityPins(new_session),epochs:[...initial.epochs,binding.authority_epoch],receipts:[...initial.receipts,{kind:'oauth_upgrade',session_id:request.session_id,source_session_id:source.session_id,review_digest:request.review.digest,receipt_digest,authority_epoch:binding.authority_epoch,custody_generation:generation,pins:upgradePins(request),review:request.review,runtime_session_ref:new_session.runtime_session_ref,prior_binding:source.binding,current_binding:binding,purpose_set:new_session.purpose_set}],pending:null,current:{session_id:request.session_id,binding,custody_generation:generation,receipt_digest}};
     await check();if(!await ltx.compareAndSwap({expected_revision:latest.revision,value:next}))fail('EMAIL_RUNTIME_CONFLICT');
     await store.withLock({key:sessionKey(request.session_id)},async ntx=>{await check();if(await ntx.read()||!await ntx.compareAndSwap({expected_revision:null,value:new_session}))fail('EMAIL_RUNTIME_CONFLICT');});await persist({...journal,state:'connected'});await advanceTarget({store,request,from:'activating',to:'connected',check});await check();return {...base,state:'connected',account:source.account,runtime_session_ref:new_session.runtime_session_ref,custody_generation:generation,receipt_digest};
    });
   });
  });}finally{guard.dispose();}
 }});
}

