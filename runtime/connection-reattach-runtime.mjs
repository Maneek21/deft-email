import {assertNoCredentialRepair} from './credential-repair-reservation.mjs';
import {capabilitiesFor,credentialAnchor,sealPurposeSet} from './purpose-set.mjs';
import {randomBytes} from 'node:crypto';
import {canonical,digest,fail,validateRegistration} from './contract.mjs';
import {validateOAuthClient,oauthClientFingerprint,grantedOAuthCapabilities} from './vendor/providers/oauth-provider.mjs';
import {createEncryptedEmailCustody} from './vendor/providers/custody-encrypted.mjs';
import {REATTACH_VERSION,validateReattachRequest,reattachPins,reviewDigest,receiptDigest,createReattachChecker} from './reattach-contract.mjs';
import {lineageKey,continuityPins,validateLineage,lineageVersion} from './account-lineage.mjs';
import {createDraftStore} from './draft-store.mjs';
import {createResourcePlanStore} from './resource-plan-store.mjs';
import {reserveTarget,advanceTarget,withUnreservedTarget} from './target-reservation.mjs';
const read=(store,key)=>store.withLock({key},tx=>tx.read());
const sessionKey=id=>'email.runtime.session.'+id;
const journalKey=id=>'email.runtime.reattach.'+id;
const unchanged=['org_id','owner_user_id','installation_id','target_key','resource_key','operator_user_id','profile_digest'];
export function createReattachRuntime({registration:rawRegistration,client,provider='gmail',store,encryption_key,key_id,assertCurrent,now=Date.now}){
 const registration=validateRegistration(rawRegistration);client=validateOAuthClient(provider,client);const fingerprint=oauthClientFingerprint(provider,client),custody=createEncryptedEmailCustody({store,encryption_key,key_id,now}),drafts=createDraftStore({store,now}),resourcePlans=createResourcePlanStore({store,now});
 function validSource(request,source){if(!source||source.state!=='connected'||source.session_id!==request.source.session_id||canonical(source.scope)!==canonical(request.source.scope)||source.runtime_session_ref!==request.source.runtime_session_ref||source.account?.account_ref!==request.source.account_ref||source.binding.account_id!==request.source.account_ref||source.client_fingerprint!==fingerprint||source.binding.provider!==provider||canonical(source.binding.scope)!==canonical({org_id:source.scope.org_id,owner_id:source.scope.owner_user_id,installation_id:source.scope.installation_id})||source.binding.connection_target!==source.scope.target_key||source.binding.resource_binding_id!==source.scope.resource_binding_id||unchanged.some(k=>source.scope[k]!==request.scope[k])||source.scope.app_version_id===request.scope.app_version_id||source.scope.grant_snapshot_id===request.scope.grant_snapshot_id||request.scope.lifecycle_epoch<=source.scope.lifecycle_epoch||request.scope.grant_epoch<=source.scope.grant_epoch)fail('EMAIL_RUNTIME_REATTACH_DENIED');
  if(request.action_consents!==undefined){if(!source.action_consents||canonical(source.action_consents.map(a=>a.action_key))!==canonical(request.action_consents.map(a=>a.action_key))||!source.purpose_set||canonical(source.purpose_set)!==canonical(sealPurposeSet(source.binding,source.action_consents,source.purpose_set.custody_generation)))fail('EMAIL_RUNTIME_REATTACH_DENIED');}
  else if(source.action_consents!==undefined)fail('EMAIL_RUNTIME_REATTACH_DENIED');
 }
 function eligibility(record,source){if(record?.health!=='connected'||!record.secret?.identity?.provider_subject||record.secret.client_fingerprint!==fingerprint||canonical(record.binding)!==canonical(source.binding)||record.secret.identity.primary_address!==source.account.label||!grantedOAuthCapabilities(source.binding,record.secret.scopes).includes('read'))fail('EMAIL_RUNTIME_REATTACH_DENIED');return {account:source.account,custody_generation:record.setup_generation,custody_digest:'sha256:'+digest({binding:record.binding,health:record.health,setup_generation:record.setup_generation,identity:record.secret.identity,scopes:record.secret.scopes,client_fingerprint:fingerprint})};}
async function noEffects(source,check,request){const scope={org_id:source.scope.org_id,owner_user_id:source.scope.owner_user_id,account_id:source.binding.account_id};
  if(request.action_consents===undefined){await drafts.assertNoPendingEffects(scope,check);await resourcePlans.assertNoPendingEffects(scope);}
  else{const lineage=(await read(store,lineageKey(source.binding)))?.value;if(lineage){if(lineage.current.session_id!==source.session_id||lineage.transport_digest!==request.transport_digest)fail('EMAIL_RUNTIME_REATTACH_DENIED');validateLineage(lineage,source);}const current=await custody.withAccount(source.binding,tx=>eligibility(tx.read(),source));if(source.purpose_set.custody_generation!==current.custody_generation)fail('EMAIL_RUNTIME_REATTACH_DENIED');await drafts.assertNoActiveReattachmentEffects(scope,check);await resourcePlans.assertNoActiveReattachmentEffects(scope,source,check);}await check();}
 return Object.freeze({async request(raw,signal){const request=validateReattachRequest(raw),guard=createReattachChecker({request,registration,assertCurrent,signal,now}),check=guard.check,base={schema_version:request.schema_version,session_id:request.session_id};
  try{await check();return await store.withLock({key:journalKey(request.session_id)},async jtx=>{
   let row=await jtx.read(),journal=row?.value;const persist=async value=>{await check();if(!await jtx.compareAndSwap({expected_revision:row?.revision??null,value}))fail('EMAIL_RUNTIME_CONFLICT');row=await jtx.read();journal=row.value;};
   if(journal&&canonical(journal.pins)!==canonical(reattachPins(request)))fail('EMAIL_RUNTIME_REATTACH_DENIED');
   if(request.operation==='status'){
    if(journal?.state==='closed_unprepared'){if(request.action_consents===undefined||request.review!==null||Date.parse(request.review_expires_at)>now()||journal.reason!=='prepare_not_started')fail('EMAIL_RUNTIME_REATTACH_DENIED');await check();return {...base,state:'not_connected',reason:'prepare_not_started'};}
    if(!journal){
     if(request.action_consents===undefined||request.review!==null||Date.parse(request.review_expires_at)>now())return {...base,state:'indeterminate'};
     // This is negative original-request recovery, never a replay of prepare.
     // Lock order follows activation: original journal, source, lineage, new
     // session, target. The tombstone prevents a late original prepare racing
     // after the absence proof. Any reservation/transition remains fenced.
     return store.withLock({key:sessionKey(request.source.session_id)},async stx=>{
      const source=(await stx.read())?.value;await assertNoCredentialRepair({store,scope:request.source.scope});validSource(request,source);
      return store.withLock({key:lineageKey(source.binding)},async ltx=>{
       const lineage=(await ltx.read())?.value;
       if(lineage&&(lineage.pending||canonical(lineage.pins)!==canonical(continuityPins(source))||lineage.transport_digest!==request.transport_digest||lineage.current.session_id!==source.session_id||canonical(lineage.current.binding)!==canonical(source.binding)))fail('EMAIL_RUNTIME_REATTACH_DENIED');
       if(lineage)validateLineage(lineage,source);
       const current=await custody.withAccount(source.binding,async tx=>eligibility(tx.read(),source));
       if(source.purpose_set.custody_generation!==current.custody_generation)fail('EMAIL_RUNTIME_REATTACH_DENIED');
       return store.withLock({key:sessionKey(request.session_id)},async ntx=>{
        if(await ntx.read())fail('EMAIL_RUNTIME_REATTACH_DENIED');
        return withUnreservedTarget({store,request,check,now},async()=>{
         await persist({schema_version:'email.runtime.reattach_journal.v1',pins:reattachPins(request),state:'closed_unprepared',reason:'prepare_not_started',closed_at:new Date(now()).toISOString(),source_session_id:source.session_id,custody_generation:current.custody_generation,custody_digest:current.custody_digest,lineage_digest:lineage?'sha256:'+digest(lineage):null});
         await check();return {...base,state:'not_connected',reason:'prepare_not_started'};
        });
       });
      });
     });
    }
    if(journal.state==='eligible'){if(request.review!==null&&canonical(request.review)!==canonical({...journal.eligibility,digest:reviewDigest(request,journal.eligibility)}))return {...base,state:'indeterminate'};return await store.withLock({key:sessionKey(request.source.session_id)},async tx=>{const source=(await tx.read())?.value;validSource(request,source);await noEffects(source,check,request);const current=await custody.withAccount(source.binding,async a=>eligibility(a.read(),source));if(canonical(current)!==canonical(journal.eligibility))return {...base,state:'indeterminate'};await check();return {...base,state:'eligible',...current};});}
    if(canonical(journal.review??null)!==canonical(request.review))return {...base,state:'indeterminate'};
    if(!journal.review||!journal.new_session)return {...base,state:'indeterminate'};
    const session=(await read(store,sessionKey(request.session_id)))?.value,lineage=(await read(store,lineageKey(journal.new_session.binding)))?.value;
    if(!session||canonical(session)!==canonical(journal.new_session)||!lineage||lineage.pending||lineage.current.session_id!==request.session_id||lineage.current.receipt_digest!==journal.receipt_digest)return {...base,state:'indeterminate'};
    validateLineage(lineage,session);
    const current=await custody.withAccount(session.binding,async tx=>eligibility(tx.read(),session));if(current.custody_generation!==journal.review.custody_generation+1||current.custody_digest!==journal.new_custody_digest||canonical(lineage.pins)!==canonical(continuityPins(session))||canonical(lineage.current.binding)!==canonical(session.binding))return {...base,state:'indeterminate'};
    await check();return {...base,state:'connected',account:session.account,runtime_session_ref:session.runtime_session_ref,custody_generation:current.custody_generation,receipt_digest:journal.receipt_digest};
   }
   if(journal&&journal.state!=='eligible')return {...base,state:'indeterminate'};
   return store.withLock({key:sessionKey(request.source.session_id)},async stx=>{
    const source=(await stx.read())?.value;await assertNoCredentialRepair({store,scope:request.source.scope});validSource(request,source);await noEffects(source,check,request);
    return store.withLock({key:lineageKey(source.binding)},async ltx=>{
     const lineageRow=await ltx.read(),lineage=lineageRow?.value;
     if(lineage&&(lineage.pending||canonical(lineage.pins)!==canonical(continuityPins(source))||lineage.transport_digest!==request.transport_digest||lineage.current.session_id!==source.session_id||canonical(lineage.current.binding)!==canonical(source.binding)))fail('EMAIL_RUNTIME_REATTACH_DENIED');
     if(lineage)validateLineage(lineage,source);
     const current=await custody.withAccount(source.binding,async tx=>{await check();const record=tx.read();
      if(request.action_consents!==undefined&&(source.purpose_set.custody_generation!==record?.setup_generation||capabilitiesFor(request.action_consents).some(capability=>!grantedOAuthCapabilities({...source.binding,capabilities:capabilitiesFor(request.action_consents)},record.secret.scopes).includes(capability))))fail('EMAIL_RUNTIME_REATTACH_DENIED');
      return eligibility(record,source);});
     if(request.operation==='prepare'){
      if(journal&&canonical(current)!==canonical(journal.eligibility))return {...base,state:'indeterminate'};
      await reserveTarget({store,request,kind:'reattach',check,now});
      await store.withLock({key:'email.runtime.registration.'+digest([registration.org_id,registration.runtime_registration_id,registration.runtime_epoch,registration.profile_digest])},async tx=>{await check();const row=await tx.read(),value={schema_version:'email.runtime.registration_client.v1',registration,client_fingerprint:fingerprint};if(row&&canonical(row.value)!==canonical(value))fail('EMAIL_RUNTIME_CLIENT_REGISTRATION_CHANGED');if(!row&&!await tx.compareAndSwap({expected_revision:null,value}))fail('EMAIL_RUNTIME_CONFLICT');});
      if(!journal)await persist({schema_version:'email.runtime.reattach_journal.v1',pins:reattachPins(request),state:'eligible',eligibility:current,review:null});await check();return {...base,state:'eligible',...current};
     }
     if(!journal||canonical(journal.eligibility)!==canonical(current)||canonical(request.review)!==canonical({...current,digest:reviewDigest(request,current)}))fail('EMAIL_RUNTIME_REATTACH_DENIED');
     const generation=current.custody_generation+1,epoch=source.binding.authority_epoch+1;
     if(generation>2147483646||epoch>2147483646||(lineage?.receipts.length??0)>=1024||request.action_consent&&!grantedOAuthCapabilities({...source.binding,capabilities:['read','search','thread','send']},(await custody.withAccount(source.binding,async tx=>tx.read())).secret.scopes).includes('send'))fail('EMAIL_RUNTIME_REATTACH_DENIED');
     const binding={...source.binding,resource_binding_id:request.scope.resource_binding_id,action_binding_id:request.action_consents!==undefined?(request.action_consents.length?credentialAnchor(source.binding.account_id,source.binding.action_binding_id):source.binding.action_binding_id):request.action_consent?.action_binding_id??null,authority_epoch:epoch,capabilities:request.action_consents!==undefined?capabilitiesFor(request.action_consents):['read','search','thread',...(request.action_consent?['send']:[])]};
     const new_session={session_id:request.session_id,scope:request.scope,...(request.action_consents!==undefined?{action_consents:request.action_consents,purpose_set:sealPurposeSet(binding,request.action_consents,generation)}:{action_consent:request.action_consent??null}),client_fingerprint:fingerprint,runtime_session_ref:randomBytes(32).toString('base64url'),binding,state:'connected',account:source.account,provider_state:null,callback_expires_at:0};
     const receipt_digest=receiptDigest(request,request.review,new_session.runtime_session_ref);
     const new_custody_digest=await custody.withAccount(source.binding,async tx=>{const prior=tx.read();return eligibility({...prior,binding:new_session.binding,setup_generation:generation},new_session).custody_digest;});
     await store.withLock({key:sessionKey(request.session_id)},async ntx=>{
      if(await ntx.read())fail('EMAIL_RUNTIME_REATTACH_DENIED');
      await advanceTarget({store,request,from:'prepared',to:'activating',check});
      await persist({...journal,state:'activation_started',review:request.review,new_session,receipt_digest,new_custody_digest});
      const initial=lineage??{schema_version:'email.runtime.account_lineage.v1',pins:continuityPins(source),transport_digest:request.transport_digest,epochs:[source.binding.authority_epoch],receipts:[],base:{session_id:source.session_id,binding:source.binding,custody_generation:current.custody_generation},current:{session_id:source.session_id,binding:source.binding,custody_generation:current.custody_generation}};
      await check();if(!await ltx.compareAndSwap({expected_revision:lineageRow?.revision??null,value:{...initial,pending:request.session_id}}))fail('EMAIL_RUNTIME_CONFLICT');
      await custody.withAccount(new_session.binding,async tx=>{const prior=tx.read();if(canonical(eligibility(prior,source))!==canonical(current))fail('EMAIL_RUNTIME_REATTACH_DENIED');await check();const next=await tx.write({health:'connected',secret:prior.secret,advance_setup:true});if(next!==generation)fail('EMAIL_RUNTIME_CONFLICT');await check();});
      await check();const latest=await ltx.read(),next={...initial,...(request.action_consents!==undefined?{schema_version:lineageVersion(initial,'email.runtime.account_lineage.v2')}:{}),epochs:[...initial.epochs,epoch],receipts:[...initial.receipts,{...(request.action_consents!==undefined?{kind:'retained_reattach_v2',prior_binding:source.binding,current_binding:binding,purpose_set:new_session.purpose_set}:{}),session_id:request.session_id,source_session_id:source.session_id,review_digest:request.review.digest,receipt_digest,authority_epoch:epoch,custody_generation:generation,pins:reattachPins(request),review:request.review,runtime_session_ref:new_session.runtime_session_ref}],pending:null,current:{session_id:request.session_id,binding:new_session.binding,custody_generation:generation,receipt_digest}};
      if(!await ltx.compareAndSwap({expected_revision:latest.revision,value:next}))fail('EMAIL_RUNTIME_CONFLICT');
      await check();if(!await ntx.compareAndSwap({expected_revision:null,value:new_session}))fail('EMAIL_RUNTIME_CONFLICT');await persist({...journal,state:'connected'});await advanceTarget({store,request,from:'activating',to:'connected',check});await check();
     });
     return {...base,state:'connected',account:source.account,runtime_session_ref:new_session.runtime_session_ref,custody_generation:generation,receipt_digest};
    });
   });
  });}finally{guard.dispose();}
 }});
}


