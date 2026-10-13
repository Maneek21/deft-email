import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setup} from './credential-repair-send-test-support.mjs';
import {createCredentialRepairRuntime} from './connection-credential-repair-runtime.mjs';
import {REPAIR_VERSION} from './credential-repair-contract.mjs';
import {client,authority,registrationFor} from './test-support.mjs';
import {digest} from './contract.mjs';
import {reserveCredentialRepair} from './credential-repair-reservation.mjs';
import {fixture as mirrorFixture} from './credential-repair-mirror-test-support.mjs';
import {createEncryptedEmailCustody} from './vendor/providers/custody-encrypted.mjs';
import {sealPurposeSet} from './purpose-set.mjs';
import {repairReviewDigest} from './credential-repair-contract.mjs';
import {commitCredentialRepairLineage} from './credential-repair-lineage.mjs';
import {providerFixture} from './test-support.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function requestFor(f,source){return {schema_version:REPAIR_VERSION,session_id:randomUUID(),operation:'prepare',scope:f.scope,source:{...f.connection,scope:f.scope},transport_digest:'sha256:'+'8'.repeat(64),review_expires_at:new Date(Date.now()+60000).toISOString(),expires_at:new Date(Date.now()+29000).toISOString(),action_consents:source.action_consents??[source.action_consent],historical_attempts:[],publication_continuity_digest:null};}

test('actual Send response headers cannot release repair drain while body decode remains pending',async t=>{
 const headers=deferred(),body=deferred(),reserved=deferred();t.after(()=>body.resolve());
 const f=await setup(t,{sendProvider:async()=>{const stream=new ReadableStream({async start(controller){headers.resolve();await body.promise;controller.enqueue(new TextEncoder().encode(JSON.stringify({id:'synthetic-accepted',threadId:'synthetic-thread'})));controller.close();}});return new Response(stream,{headers:{'content-type':'application/json'}});}});
 const source=(await f.store.withLock({key:'email.runtime.session.'+f.connection.session_id},tx=>tx.read())).value,request=requestFor(f,source);let attested=false;
 const wrapped={withLock(input,work){return f.store.withLock(input,tx=>work({...tx,async compareAndSwap(next){const result=await tx.compareAndSwap(next);if(next.value?.pins?.schema_version==='email.runtime.credential_repair_reservation.v1')reserved.resolve();return result;}}));}};
 const runtime=createCredentialRepairRuntime({registration:registrationFor(f.scope),client,store:wrapped,encryption_key:f.encryption_key,key_id:f.key_id,assertCurrent:authority,commitRepair:async()=>{},assertHostAcknowledgement:async()=>{},inspectPublication:async()=> 'sha256:'+digest({source_session_id:f.connection.session_id})});
 const send=f.execute();await headers.promise;const prepare=runtime.request(request).then(result=>{attested=true;return result;});await reserved.promise;await Promise.resolve();assert.equal(attested,false);assert.equal(f.sendCalls,1);assert.equal(f.resultCalls,0);
 body.resolve();const [sent,eligible]=await Promise.all([send,prepare]);assert.equal(sent.status,'indeterminate');assert.equal(eligible.state,'eligible');assert.equal(attested,true);assert.equal(f.sendCalls,1);assert.equal(f.resultCalls,0);
});

test('actual late Send with a current leased claim cannot cross a prepared repair reservation',async t=>{
 const f=await setup(t),source=(await f.store.withLock({key:'email.runtime.session.'+f.connection.session_id},tx=>tx.read())).value,request=requestFor(f,source);
 await reserveCredentialRepair({store:f.store,request,check:async()=>{}});await assert.rejects(f.execute(),{code:'EMAIL_RUNTIME_CREDENTIAL_REPAIR_RESERVED'});assert.equal(f.sendCalls,0);assert.equal(f.resultCalls,0);
});
test('actual late mirror with a current leased claim cannot cross a prepared repair reservation',async t=>{
 const f=await mirrorFixture(t),source=(await f.store.withLock({key:'email.runtime.session.'+f.connection.session_id},tx=>tx.read())).value,request=requestFor(f,source);
 await reserveCredentialRepair({store:f.store,request,check:async()=>{}});await assert.rejects(f.execute(),{code:'EMAIL_RUNTIME_CREDENTIAL_REPAIR_RESERVED'});assert.equal(f.writes(),0);assert.equal(f.deletes(),0);
});
test('actual old Send lease cannot acquire generation11 after success and durable reservation release',async t=>{
 const f=await setup(t),key='email.runtime.session.'+f.connection.session_id;let source=(await f.store.withLock({key},tx=>tx.read())).value;
 const custody=createEncryptedEmailCustody({store:f.store,encryption_key:f.encryption_key,key_id:f.key_id});await custody.withAccount(source.binding,async tx=>{while(tx.read().setup_generation<10)await tx.advanceSetup();});
 const binding={...source.binding,authority_epoch:10};await custody.withAccount(binding,async tx=>{const row=tx.read();await tx.write({health:row.health,secret:row.secret});});
 const actions=[source.action_consent];source={...source,binding,action_consents:actions,purpose_set:sealPurposeSet(binding,actions,10)};delete source.action_consent;
 await f.store.withLock({key},async tx=>{const row=await tx.read();await tx.compareAndSwap({expected_revision:row.revision,value:source});});
 const request=requestFor(f,source),runtime=createCredentialRepairRuntime({registration:registrationFor(f.scope),client,store:f.store,encryption_key:f.encryption_key,key_id:f.key_id,assertCurrent:authority,fetch:async(url,options)=>url==='https://oauth2.googleapis.com/token'?Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',token_type:'Bearer',expires_in:3600,scope:'openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send'}):providerFixture(url,options),inspectPublication:async()=> 'sha256:'+digest({synthetic:true}),commitRepair:input=>commitCredentialRepairLineage({...input,store:f.store}),assertHostAcknowledgement:async()=>{}});
 const eligible=await runtime.request(request),pins=Object.fromEntries(['account','custody_generation','custody_digest','fence'].map(k=>[k,eligible[k]])),review={...pins,digest:repairReviewDigest(request,pins)},begun=await runtime.request({...request,operation:'begin',review,callback_state:'c'.repeat(43)}),connected=await runtime.request({...request,operation:'callback',review,runtime_session_ref:begun.runtime_session_ref,callback:{outcome:'authorized',code:'synthetic-code'}});
 await runtime.request({...request,operation:'status',review,runtime_session_ref:connected.runtime_session_ref,acknowledged_receipt:{session_id:request.session_id,session_revision:5,receipt_digest:connected.receipt_digest}});
 assert.equal((await custody.withAccount(binding,tx=>tx.read())).setup_generation,11);await assert.rejects(f.execute(),{code:'EMAIL_DATA_SOURCE_CHANGED'});assert.equal(f.sendCalls,0);assert.equal(f.resultCalls,0);
});

