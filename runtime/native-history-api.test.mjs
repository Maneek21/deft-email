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

test('ordinary generic history reads retain original UNKNOWN and MIME while provider stays reauth_required',async t=>{
 const x=await setup(t,{health:'reauth_required'}),receipt=await x.activation().prepare(x.admission);x.active(receipt);await x.activation().publish(x.admission,receipt.receipt_digest);await x.f.restart();
 const effects=x.f.fetch.effectCounts;x.f.fetch=async()=>{throw Error('HISTORY_PROVIDER_ACCESS_FORBIDDEN');};const list=await x.data().request(x.request(receipt,'record_list',{store_key:'native_history',cursor:null,limit:25}));assert.ok(list.items.length);const original=x.f.snapshot.history.find(row=>row.kind==='send'&&row.mime),item=list.items.find(row=>row.summary.receipt_id===original.id);assert.ok(item);const read=await x.data().request(x.request(receipt,'record_read',{store_key:'native_history',record_id:item.record_id}));assert.equal(read.record.value.original_state,original.state);assert.equal(read.record.value.original_revision,original.revision);const file=read.record.files[0],binary=await x.data().request(x.request(receipt,'file_read',{store_key:'native_history',record_id:item.record_id,file_id:file.file_id,upload_revision:file.upload_revision,sha256:file.sha256}));assert.deepEqual(binary.bytes,original.mime.bytes);
 const custody=await x.f.custody.withAccount(x.f.destination_binding,tx=>tx.read());assert.equal(custody.health,'reauth_required');assert.deepEqual(effects,{send:0,modify:0});
 await assert.rejects(x.data().request(x.request(receipt,'record_save',{store_key:'native_history',record_id:item.record_id,expected_revision:1,expected_content_digest:item.content_digest,value:{}})),/NATIVE_HISTORY_DENIED/);
 const stale=x.request(receipt,'record_read',{store_key:'native_history',record_id:item.record_id});stale.connection.runtime_session_ref+='stale';await assert.rejects(x.data().request(stale),/DATA_CONNECTION_DENIED/);x.deny();await assert.rejects(x.data().request(x.request(receipt,'record_read',{store_key:'native_history',record_id:item.record_id})),/admission denied/);
});

test('imported connected health does not establish fresh provider authority',async t=>{
 const x=await setup(t,{health:'connected'}),receipt=await x.activation().prepare(x.admission);x.active(receipt);await x.activation().publish(x.admission,receipt.receipt_digest);
 let fetches=0;x.f.fetch=async()=>{fetches++;throw Error('PROVIDER_FETCH_MUST_NOT_RUN');};
 await assert.rejects(x.data().request(x.request(receipt,'resource_list',{store_key:'drafts',resource_key:x.admission.destination_scope.resource_key,cursor:null,limit:25,query:'in:inbox'})),/EMAIL_PROVIDER_NETWORK_UNAVAILABLE/);
 assert.equal(fetches,0);const record=await x.f.custody.withAccount(x.f.destination_binding,tx=>tx.read());assert.equal(record.health,'connected');
 const history=await x.data().request(x.request(receipt,'record_list',{store_key:'native_history',cursor:null,limit:25}));assert.ok(history.items.length);assert.equal(fetches,0);
});
