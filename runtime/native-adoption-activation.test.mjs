import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {fixture,coreFixture} from './native-activation-fixture.mjs';
import {createNativeActivation,assertNativeSessionVisible,nativeActivationAdmission} from './native-adoption-activation.mjs';
import {makeScope,registrationFor,client} from './test-support.mjs';import {digest} from './contract.mjs';
import {nativeSnapshotDigest,expectedNativeCoverage} from './native-adoption-import.mjs';import {createDataRuntime} from './data-runtime.mjs';
async function setup(t,{legacy=false,health='connected'}={}){
 const f=await (legacy?coreFixture:fixture)(t,'gmail_controlled_sender');f.snapshot.custody.health=health;f.snapshot.coverage=expectedNativeCoverage(f.snapshot);await f.run();
 const destination_scope={...makeScope(),org_id:f.scope.org_id,owner_user_id:f.scope.owner_user_id,installation_id:f.destination_binding.scope.installation_id,resource_binding_id:f.destination_binding.resource_binding_id};
 const admission={schema_version:'email.native_activation_admission.v1',adoption_id:f.snapshot.adoption_id,scope:f.scope,snapshot_digest:nativeSnapshotDigest(f.snapshot),source_principal_digest:digest([f.scope.org_id,f.scope.owner_user_id,'gmail',f.snapshot.custody.secret.identity.provider_subject]),destination_scope,destination_binding:f.destination_binding,session_id:randomUUID()};
 let allowed=true,route={adoption_id:admission.adoption_id,scope:f.scope,state:'runtime_prepared',snapshot_digest:admission.snapshot_digest,source_principal_digest:admission.source_principal_digest,source_binding_digest:digest(f.source_binding),source_generation:f.snapshot.source_evidence.writer_generation,destination_binding_digest:digest(f.destination_binding),destination_admission_digest:digest(admission),runtime_receipt_digest:null},crash=null;
 const wrapped={withLock:(options,work)=>f.store.withLock(options,tx=>work({...tx,compareAndSwap:async args=>{const ok=await tx.compareAndSwap(args);if(ok&&crash?.(options.key,args.value)){crash=null;throw Error('fixture interruption after durable CAS');}return ok;}}))};
 const activation=()=>createNativeActivation({store:wrapped,custody:f.custody,registration:registrationFor(destination_scope),client,assertCurrent:async()=>({allowed,expires_at:new Date(Date.now()+25000).toISOString(),route:structuredClone(route)})});
 const session=async()=>(await f.store.withLock({key:'email.runtime.session.'+admission.session_id},tx=>tx.read()))?.value;
 const request=(receipt,operation,input)=>({schema_version:'deft.app_data_runtime.v1',request_id:randomUUID(),scope:destination_scope,connection:{session_id:admission.session_id,session_revision:1,runtime_session_ref:receipt.runtime_session_ref,account_ref:f.scope.account_id},authority:{consent_id:randomUUID(),consent_digest:'sha256:'+'d'.repeat(64),data_policy_digest:'sha256:'+'e'.repeat(64)},operation,expires_at:new Date(Date.now()+25000).toISOString(),input});
 const data=()=>createDataRuntime({registrations:[registrationFor(destination_scope)],client,store:f.store,encryption_key:Buffer.alloc(32,37),key_id:'synthetic-e5-runtime-key',assertCurrent:async value=>{if(!allowed||route.state!=='runtime_active')throw Error('fresh Host admission denied');return {...value,allowed:true};},fetch:f.fetch});
 return {f,admission,activation,session,request,data,active(receipt){route={...route,state:'runtime_active',runtime_receipt_digest:receipt.receipt_digest};},route(){return route;},deny(){allowed=false;},crash(fn){crash=fn;}};
}
test('native opaque account stages invisible; fresh reviewed session publishes exact ordinary draft/file reads after encrypted reopen',async t=>{
 const x=await setup(t),receipt=await x.activation().prepare(x.admission);assert.equal((await x.session()).state,'native_adoption_prepared');await assert.rejects(assertNativeSessionVisible({store:x.f.store,session:await x.session()}),/NOT_VISIBLE/);
 assert.deepEqual(await x.activation().prepare(x.admission),receipt);await x.f.restart();
 await assert.rejects(x.activation().publish(x.admission,receipt.receipt_digest),/ROUTE_DENIED/);x.active(receipt);assert.deepEqual(await x.activation().publish(x.admission,receipt.receipt_digest),receipt);await x.f.restart();
 await assertNativeSessionVisible({store:x.f.store,session:await x.session()});assert.deepEqual(await x.activation().publish(x.admission,receipt.receipt_digest),receipt);
 const original=x.f.snapshot.drafts[0].draft,read=await x.data().request(x.request(receipt,'record_read',{store_key:'drafts',record_id:original.draft_id}));assert.equal(read.record.record_id,original.draft_id);assert.equal(read.record.revision,original.revision);assert.deepEqual(read.record.value,original.content);
 const file=read.record.files[0],bytes=await x.data().request(x.request(receipt,'file_read',{store_key:'drafts',record_id:original.draft_id,file_id:file.file_id,upload_revision:file.upload_revision,sha256:file.sha256}));assert.deepEqual(bytes.bytes,x.f.data.png);assert.deepEqual((await x.session()).action_consents,[]);assert.deepEqual(x.f.fetch.effectCounts,{send:0,modify:0});
 x.deny();await assert.rejects(x.data().request(x.request(receipt,'record_read',{store_key:'drafts',record_id:original.draft_id})),/admission denied/);
});
test('journal-first interruption resumes exact original session reference without generating another account or receipt',async t=>{
 const x=await setup(t);x.crash((key,value)=>key.startsWith('email.native.activation.')&&value.state==='prepared');await assert.rejects(x.activation().prepare(x.admission),/interruption/);assert.equal(await x.session(),undefined);await x.f.restart();const receipt=await x.activation().prepare(x.admission);assert.equal((await x.session()).runtime_session_ref,receipt.runtime_session_ref);assert.equal((await x.session()).account.account_ref,'gmail_controlled_sender');
});
test('each publication interruption remains invisible until journal finalizes and exact retry is safe',async t=>{
 for(const phase of ['session','target']){const x=await setup(t),receipt=await x.activation().prepare(x.admission);x.active(receipt);x.crash((key,value)=>key.startsWith(phase==='session'?'email.runtime.session.':'email.runtime.target.')&&value.state==='connected');await assert.rejects(x.activation().publish(x.admission,receipt.receipt_digest),/interruption/);await assert.rejects(assertNativeSessionVisible({store:x.f.store,session:await x.session()}),/NOT_VISIBLE/);await x.f.restart();await x.activation().publish(x.admission,receipt.receipt_digest);await assertNativeSessionVisible({store:x.f.store,session:await x.session()});}
});
test('foreign or effect-capable destination binding is rejected before activation',async t=>{
 const x=await setup(t);for(const changed of [{account_id:randomUUID()},{action_binding_id:randomUUID()},{capabilities:['read','search','thread','send']},{scope:{...x.admission.destination_binding.scope,owner_id:randomUUID()}}])assert.throws(()=>nativeActivationAdmission({...x.admission,destination_binding:{...x.admission.destination_binding,...changed}}));assert.equal(await x.session(),undefined);
});
test('wrong original principal, fresh-owner rejection, and changed Host route are fail-closed',async t=>{
 const x=await setup(t);x.route().source_binding_digest='f'.repeat(64);await assert.rejects(x.activation().prepare(x.admission),/IMPORT_DENIED/);x.route().source_binding_digest=digest(x.f.source_binding);x.route().source_principal_digest='e'.repeat(64);await assert.rejects(x.activation().prepare(x.admission),/ROUTE_DENIED/);x.route().source_principal_digest=x.admission.source_principal_digest;x.deny();await assert.rejects(x.activation().prepare(x.admission),/AUTHORITY_DENIED/);assert.equal(await x.session(),undefined);
});
test('current Session UUID and admission cannot replace the retained activation identity',async t=>{const x=await setup(t);await x.activation().prepare(x.admission);const other={...x.admission,session_id:randomUUID()};x.route().destination_admission_digest=digest(other);await assert.rejects(x.activation().prepare(other),/CONFLICT/);});


test('imported cache publishes original logical IDs without a provider resync or invented completeness',async t=>{
 const x=await setup(t),receipt=await x.activation().prepare(x.admission);
 const {createMailboxStore}=await import('./mailbox-store.mjs'),{createSyncPublication}=await import('./sync-publication.mjs');
 const mailbox=createMailboxStore({store:x.f.store}),consumer={scope:x.admission.destination_scope,consent_digest:'sha256:'+'a'.repeat(64)},producer={scope:x.admission.destination_scope,session_id:x.admission.session_id,runtime_session_ref:receipt.runtime_session_ref,custody_generation:receipt.custody_generation,client_fingerprint:(await x.session()).client_fingerprint};
 const beforeCursor=await mailbox.cursor(x.f.scope,async()=>{});let providerCalls=0;
 const request={scope:x.f.scope,consumer,producer,input_cursor:null,limit:25,check:async()=>assertNativeSessionVisible({store:x.f.store,session:await x.session()}),localCheck:async()=>{},readNative:async()=>{providerCalls++;throw Error('native provider must not be called for adopted cache');}};
 await assert.rejects(createSyncPublication({store:x.f.store,mailbox}).page(request),/NOT_VISIBLE/);
 x.active(receipt);await x.activation().publish(x.admission,receipt.receipt_digest);
 const page=await createSyncPublication({store:x.f.store,mailbox}).page(request);
 assert.deepEqual(page.items.map(row=>row.logical_message_id).sort(),x.f.snapshot.mailbox.records.filter(row=>!row.deleted).map(row=>row.logical_message_id).sort());
 assert.equal(page.account_id,'gmail_controlled_sender');assert.equal(page.complete,false);assert.deepEqual(page.tombstones,[]);assert.deepEqual(page.state_updates,[]);assert.equal(providerCalls,0);assert.equal(await mailbox.cursor(x.f.scope,async()=>{}),beforeCursor);
 await x.f.restart();const reopened=createSyncPublication({store:x.f.store,mailbox:createMailboxStore({store:x.f.store})});assert.deepEqual(await reopened.page(request),page);assert.equal(providerCalls,0);
});


test('adopted account consent continuation keeps the original activation and imported history visible under the new session',async t=>{
 const x=await setup(t),receipt=await x.activation().prepare(x.admission);x.active(receipt);await x.activation().publish(x.admission,receipt.receipt_digest);
 const source=await x.session(),before=structuredClone(source),custody=await x.f.custody.withAccount(source.binding,tx=>tx.read());
 const {createConsentContinuationRuntime}=await import('./connection-consent-continuation-runtime.mjs');
 const {CONTINUATION_VERSION,continuationReviewDigest}=await import('./consent-continuation-contract.mjs');
 const request={schema_version:CONTINUATION_VERSION,session_id:randomUUID(),scope:{...source.scope,consent_expires_at:new Date(Date.parse(source.scope.consent_expires_at)+3600000).toISOString()},source:{session_id:source.session_id,session_revision:1,scope:source.scope,runtime_session_ref:source.runtime_session_ref,account_ref:source.account.account_ref,action_consents:[]},action_consents:[],transport_digest:'sha256:'+'7'.repeat(64),review_expires_at:new Date(Date.now()+60000).toISOString(),expires_at:new Date(Date.now()+20000).toISOString(),operation:'prepare'};
 const runtime=createConsentContinuationRuntime({registration:registrationFor(request.scope),client,store:x.f.store,encryption_key:Buffer.alloc(32,37),key_id:'synthetic-e5-runtime-key',assertCurrent:async r=>({...r,allowed:true})});
 const eligible=await runtime.request(request),{schema_version,session_id,state,...eligibility}=eligible;
 const activation={...request,operation:'activate',review:{...eligibility,digest:continuationReviewDigest(request,eligibility)}};
 const result=await runtime.request(activation);assert.equal(result.state,'connected');
 const next=(await x.f.store.withLock({key:'email.runtime.session.'+request.session_id},tx=>tx.read())).value;
 await assertNativeSessionVisible({store:x.f.store,session:next});
 assert.deepEqual(await x.session(),before);assert.deepEqual(await x.f.custody.withAccount(source.binding,tx=>tx.read()),custody);
 const readRequest={...x.request(receipt,'record_read',{store_key:'drafts',record_id:x.f.snapshot.drafts[0].draft.draft_id}),scope:next.scope,connection:{session_id:next.session_id,session_revision:1,runtime_session_ref:next.runtime_session_ref,account_ref:next.account.account_ref}};
 assert.equal((await x.data().request(readRequest)).record.record_id,x.f.snapshot.drafts[0].draft.draft_id);
 await x.f.restart();await assertNativeSessionVisible({store:x.f.store,session:next});
 const forged={...next,session_id:randomUUID()};await assert.rejects(assertNativeSessionVisible({store:x.f.store,session:forged}));
 assert.deepEqual(x.f.fetch.effectCounts,{send:0,modify:0});
});

test('legacy core-only staging cannot activate without complete independently enumerated V2 source manifest',async t=>{const x=await setup(t,{legacy:true});await assert.rejects(x.activation().prepare(x.admission),/COMPLETE_SOURCE_REQUIRED/);assert.equal(await x.session(),undefined);});

test('reauth-required native custody publishes original local records without promoting health or invoking any provider',async t=>{
 const x=await setup(t,{health:'reauth_required'}),receipt=await x.activation().prepare(x.admission);x.active(receipt);await x.activation().publish(x.admission,receipt.receipt_digest);
 const before=await x.f.custody.withAccount(x.f.destination_binding,tx=>tx.read()),session=await x.session();assert.equal(before.health,'reauth_required');
 const original=x.f.snapshot.drafts[0].draft;assert.equal((await x.data().request(x.request(receipt,'record_read',{store_key:'drafts',record_id:original.draft_id}))).record.record_id,original.draft_id);
 const {createEmailOAuth}=await import('./vendor/providers/oauth-account.mjs');let http=0;
 const oauth=createEmailOAuth({clients:{gmail:client},custody:x.f.custody,fetch:async()=>{http++;throw Error('provider forbidden');},host:{resolveAccount:async()=>x.f.destination_binding,assertAuthority:async()=>({allowed:true,expires_at:Date.now()+30000})}});
 const identity=before.secret.identity,account={...x.f.destination_binding,display_label:identity.display_label,primary_address:identity.primary_address,verified_sender_identities:identity.verified_sender_identities,health:'reauth_required'};delete account.scope;
 for(const operation of ['read','search','thread'])await assert.rejects(oauth.getAccessToken({scope:x.f.destination_binding.scope,account,account_id:x.f.scope.account_id,operation,authority_epoch:account.authority_epoch}),/REAUTH_REQUIRED/);
 for(const operation of ['send','modify','permanent_delete'])await assert.rejects(oauth.getAccessToken({scope:x.f.destination_binding.scope,account,account_id:x.f.scope.account_id,operation,authority_epoch:account.authority_epoch}));
 assert.equal(http,0);assert.deepEqual(await x.f.custody.withAccount(x.f.destination_binding,tx=>tx.read()),before);
 await x.f.restart();assert.deepEqual(await x.session(),session);assert.deepEqual(await x.f.custody.withAccount(x.f.destination_binding,tx=>tx.read()),before);assert.deepEqual(x.f.fetch.effectCounts,{send:0,modify:0});
});

for(const health of ['refresh_pending','revoked'])test('native custody '+health+' is rejected before staging',async t=>{await assert.rejects(setup(t,{health}),/CUSTODY_UNSUPPORTED/);});

test('original native adoption survives retained reattachment through its full receipt chain without provider effects',async t=>{
 const x=await setup(t),receipt=await x.activation().prepare(x.admission);x.active(receipt);await x.activation().publish(x.admission,receipt.receipt_digest);
 const source=await x.session(),before=structuredClone(source);
 const {createReattachRuntime}=await import('./connection-reattach-runtime.mjs');
 const {REATTACH_V2_VERSION,reviewDigest}=await import('./reattach-contract.mjs');
 const scope={...source.scope,app_version_id:randomUUID(),grant_snapshot_id:randomUUID(),resource_binding_id:randomUUID(),runtime_registration_id:randomUUID(),lifecycle_epoch:source.scope.lifecycle_epoch+1,grant_epoch:source.scope.grant_epoch+1};
 const request={schema_version:REATTACH_V2_VERSION,session_id:randomUUID(),scope,source:{session_id:source.session_id,session_revision:1,scope:source.scope,runtime_session_ref:source.runtime_session_ref,account_ref:source.account.account_ref},action_consents:[],transport_digest:'sha256:'+'7'.repeat(64),review_expires_at:new Date(Date.now()+60000).toISOString(),expires_at:new Date(Date.now()+20000).toISOString(),operation:'prepare'};
 const runtime=createReattachRuntime({registration:registrationFor(scope),client,store:x.f.store,encryption_key:Buffer.alloc(32,37),key_id:'synthetic-e5-runtime-key',assertCurrent:async r=>({...r,allowed:true})});
 const eligible=await runtime.request(request),{schema_version,session_id,state,...eligibility}=eligible;
 const connected=await runtime.request({...request,operation:'activate',review:{...eligibility,digest:reviewDigest(request,eligibility)}});assert.equal(connected.state,'connected');
 const next=(await x.f.store.withLock({key:'email.runtime.session.'+request.session_id},tx=>tx.read())).value;
 await assertNativeSessionVisible({store:x.f.store,session:next});
 const {readNativeIdentity,createNativeIdentityScopeResolver}=await import('./native-adoption-identity.mjs');
 const identity=await readNativeIdentity(x.f.store,x.f.scope,next.binding,async()=>{},next);assert.deepEqual(identity.destination_binding,x.f.destination_binding);
 assert.deepEqual(await createNativeIdentityScopeResolver({store:x.f.store,scope:x.f.scope,binding:next.binding,session:next,check:async()=>{}})(),identity.source_binding.scope);
 await assert.rejects(readNativeIdentity(x.f.store,x.f.scope,next.binding,async()=>{}));
 await assert.rejects(assertNativeSessionVisible({store:x.f.store,session:{...next,scope:{...next.scope,operator_user_id:randomUUID()}}}));
 assert.deepEqual(await x.session(),before);await x.f.restart();await assertNativeSessionVisible({store:x.f.store,session:next});assert.deepEqual(x.f.fetch.effectCounts,{send:0,modify:0});
});
