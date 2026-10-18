import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './credential-repair-test-support.mjs';
import {createCredentialRepairRuntime} from './connection-credential-repair-runtime.mjs';
import {repairReviewDigest,REPAIR_VERSION} from './credential-repair-contract.mjs';
import {commitCredentialRepairLineage,commitCredentialRepairClosureLineage} from './credential-repair-lineage.mjs';
import {createEncryptedEmailCustody} from './vendor/providers/custody-encrypted.mjs';
import {client,authority,registrationFor} from './test-support.mjs';
import {digest,canonical} from './contract.mjs';
import {lineageKey,validateLineage} from './account-lineage.mjs';
import {assertNoCredentialRepair} from './credential-repair-reservation.mjs';
import {createConnectionRuntime} from './connection-runtime.mjs';

export async function repairFixture(t,options={}){
 const f=await fixture(t),source=(await f.store.withLock({key:'email.runtime.session.'+f.begin.session_id},tx=>tx.read())).value;
 const request={schema_version:REPAIR_VERSION,session_id:randomUUID(),scope:f.scope,source:{scope:f.scope,session_id:f.begin.session_id,session_revision:5,runtime_session_ref:f.begun.runtime_session_ref,account_ref:f.connected.account.account_ref},transport_digest:'sha256:'+'8'.repeat(64),review_expires_at:new Date(Date.now()+300000).toISOString(),expires_at:new Date(Date.now()+29000).toISOString(),action_consents:[],historical_attempts:[{run_id:'98e0de67-c767-4a1c-a282-d752a772f8db',attempt_id:randomUUID(),attempt_digest:'sha256:'+'9'.repeat(64)}],publication_continuity_digest:null,operation:'prepare'};
 let custody=createEncryptedEmailCustody({store:f.store,encryption_key:f.encryption_key,key_id:f.key_id});
 const historicalKey='email.data.request.'+digest(['email.observation.v1',f.registration,request.historical_attempts[0].run_id]);
 const historical={schema_version:'email.app_observation_run.v1',pins:{claim:{run_id:request.historical_attempts[0].run_id,attempt_id:request.historical_attempts[0].attempt_id}},custody_generation:10,state:'indeterminate'};
 await f.store.withLock({key:historicalKey},tx=>tx.compareAndSwap({expected_revision:null,value:historical}));
 let hostAcknowledged=false,failCommit=false;
 const dependencies={registration:f.registration,client,store:f.store,encryption_key:f.encryption_key,key_id:f.key_id,assertCurrent:authority,fetch:f.fetch,inspectHistoricalAttempts:async()=>{const row=(await f.store.withLock({key:historicalKey},tx=>tx.read())).value;assert.deepEqual(row,historical);return true;},inspectPublication:async()=> 'sha256:'+digest({prior_scope:f.scope,source_session_id:f.begin.session_id}),commitClosure:input=>commitCredentialRepairClosureLineage({...input,store:f.store}),commitRepair:async input=>{if(failCommit){failCommit=false;throw Error('synthetic local commit interrupted');}return commitCredentialRepairLineage({...input,store:f.store});},assertHostAcknowledgement:async({request:raw,receipt_digest})=>{assert.equal(hostAcknowledged,true);const ack=raw.acknowledged_receipt??raw.acknowledged_closure;assert.equal(ack.receipt_digest,receipt_digest);assert.equal(ack.session_id,request.session_id);assert.equal(ack.session_revision,5);},...options};
 let runtime=createCredentialRepairRuntime(dependencies);
 return {...f,request,source,get store(){return f.store;},get custody(){return custody;},async reopenStore(){await f.restart();dependencies.store=f.store;custody=createEncryptedEmailCustody({store:f.store,encryption_key:f.encryption_key,key_id:f.key_id});runtime=createCredentialRepairRuntime(dependencies);},get providerCalls(){return f.providerCalls;},get runtime(){return runtime;},restart(){runtime=createCredentialRepairRuntime(dependencies);},acknowledge(){hostAcknowledged=true;},failLocalCommit(){failCommit=true;}};
}
test('known awaiting callback expiry has durable consumed closure and never exchanges',async t=>{
 let clock=Date.now();const f=await repairFixture(t,{now:()=>clock}),eligible=await f.runtime.request(f.request),review=reviewed(f.request,eligible),begun=await f.runtime.request({...f.request,operation:'begin',review,callback_state:'c'.repeat(43)}),calls=f.providerCalls;
 clock=Date.parse(f.request.review_expires_at)+1;
 const status={...f.request,operation:'status',expires_at:new Date(clock+29000).toISOString(),review,runtime_session_ref:begun.runtime_session_ref,close_expired:true};
 const closed=await f.runtime.request(status);assert.equal(closed.state,'expired');assert.equal(closed.closure.custody_generation,11);assert.equal(f.providerCalls,calls);f.restart();assert.deepEqual(await f.runtime.request(status),closed);
 f.acknowledge();const {close_expired:ignored,...ack}=status;assert.equal((await f.runtime.request({...ack,acknowledged_closure:{session_id:f.request.session_id,session_revision:5,receipt_digest:closed.closure.receipt_digest}})).reservation_closed,true);assert.equal(f.providerCalls,calls);
});

test('uncertain consumed Begin cannot repeat or silently expire its reservation',async t=>{
 const f=await repairFixture(t),eligible=await f.runtime.request(f.request),review=reviewed(f.request,eligible);let interrupted=false;
 const store={withLock(input,work){return f.store.withLock(input,tx=>work({...tx,async compareAndSwap(next){if(next.value?.state==='awaiting_callback'&&!interrupted){interrupted=true;throw Error('synthetic begin journal interrupted');}return tx.compareAndSwap(next);}}));}};
 const runtime=createCredentialRepairRuntime({registration:f.registration,client,store,encryption_key:f.encryption_key,key_id:f.key_id,assertCurrent:authority,fetch:f.fetch,commitRepair:async()=>{},assertHostAcknowledgement:async()=>{},inspectPublication:async()=>eligible.fence.publication_continuity_digest});
 const begin={...f.request,operation:'begin',review,callback_state:'c'.repeat(43)};await assert.rejects(runtime.request(begin),/synthetic begin journal interrupted/);assert.equal((await f.custody.withAccount(f.source.binding,tx=>tx.read())).setup_generation,11);
 assert.equal((await runtime.request(begin)).state,'indeterminate');assert.equal((await runtime.request({...f.request,operation:'status',review,runtime_session_ref:null,close_expired:true})).state,'indeterminate');await assert.rejects(assertNoCredentialRepair({store:f.store,scope:f.scope}));assert.equal((await f.custody.withAccount(f.source.binding,tx=>tx.read())).setup_generation,11);
});
function reviewed(request,result){const eligibility=Object.fromEntries(['account','custody_generation','custody_digest','fence'].map(k=>[k,result[k]]));return {...eligibility,digest:repairReviewDigest(request,eligibility)};}
test('deterministic missing publication proof never reserves or advances custody',async t=>{
 const f=await repairFixture(t,{inspectPublication:async()=>{throw Error('synthetic missing original publication');}}),calls=f.providerCalls;
 await assert.rejects(f.runtime.request(f.request),/synthetic missing original publication/);await assertNoCredentialRepair({store:f.store,scope:f.scope});f.restart();await assert.rejects(f.runtime.request(f.request));await assertNoCredentialRepair({store:f.store,scope:f.scope});assert.equal((await f.custody.withAccount(f.source.binding,tx=>tx.read())).setup_generation,10);assert.equal(f.providerCalls,calls);
});
test('reserved prepare interruption recovers exact eligible proof on status before reviewed cancellation',async t=>{
 const f=await repairFixture(t);let interrupted=false;
 const store={withLock(input,work){return f.store.withLock(input,tx=>work({...tx,async compareAndSwap(next){if(next.value?.state==='eligible'&&!interrupted){interrupted=true;throw Error('synthetic eligible journal interrupted');}return tx.compareAndSwap(next);}}));}};
 const runtime=createCredentialRepairRuntime({registration:f.registration,client,store,encryption_key:f.encryption_key,key_id:f.key_id,assertCurrent:authority,fetch:f.fetch,commitRepair:async()=>{},assertHostAcknowledgement:async()=>{},inspectHistoricalAttempts:async()=>true,inspectPublication:async()=> 'sha256:'+digest({source_session_id:f.begin.session_id})});
 const calls=f.providerCalls;await assert.rejects(runtime.request(f.request),/synthetic eligible journal interrupted/);await assert.rejects(assertNoCredentialRepair({store:f.store,scope:f.scope}));const status={...f.request,operation:'status',review:null,runtime_session_ref:null},eligible=await runtime.request(status);assert.equal(eligible.state,'eligible');assert.equal(eligible.custody_generation,10);const result=await runtime.request({...status,review:reviewed(f.request,eligible),close_prepared:true});assert.equal(result.state,'cancelled');assert.equal(result.closure.custody_generation,10);assert.equal(f.providerCalls,calls);
});
test('permanent final prepare proof failure can only close its exact unconsumed durable intent',async t=>{
 let inspections=0;const f=await repairFixture(t,{inspectPublication:async()=>{if(++inspections>1)throw Error('synthetic final proof permanently unavailable');return 'sha256:'+digest({preflight:true});}}),calls=f.providerCalls;
 await assert.rejects(f.runtime.request(f.request),/synthetic final proof permanently unavailable/);await assert.rejects(assertNoCredentialRepair({store:f.store,scope:f.scope}));f.restart();
 const status={...f.request,operation:'status',review:null,runtime_session_ref:null};await assert.rejects(f.runtime.request(status),/synthetic final proof permanently unavailable/);
 const closed=await f.runtime.request({...status,close_prepared:true});assert.equal(closed.state,'cancelled');assert.equal(closed.closure.reason,'intent_cancelled');assert.equal(closed.closure.custody_generation,10);assert.equal(closed.reservation_closed,false);await assert.rejects(assertNoCredentialRepair({store:f.store,scope:f.scope}));
 assert.equal((await f.custody.withAccount(f.source.binding,tx=>tx.read())).setup_generation,10);f.acknowledge();const released=await f.runtime.request({...status,acknowledged_closure:{session_id:f.request.session_id,session_revision:5,receipt_digest:closed.closure.receipt_digest}});assert.equal(released.reservation_closed,true);await assertNoCredentialRepair({store:f.store,scope:f.scope});assert.equal(f.providerCalls,calls);
});

test('typed repair preserves epoch10 binding, consumes generation once at Begin, commits real lineage and requires Host acknowledgement',async t=>{
 const f=await repairFixture(t),eligible=await f.runtime.request(f.request),review=reviewed(f.request,eligible);
 assert.equal(eligible.custody_generation,10);assert.equal(eligible.fence.planned_custody_generation,11);assert.equal((await f.custody.withAccount(f.source.binding,tx=>tx.read())).setup_generation,10);
 await assert.rejects(assertNoCredentialRepair({store:f.store,scope:f.scope}),{code:'EMAIL_RUNTIME_CREDENTIAL_REPAIR_RESERVED'});
 const ordinary=createConnectionRuntime({registration:f.registration,client,store:f.store,encryption_key:f.encryption_key,key_id:f.key_id,assertCurrent:authority,fetch:f.fetch});await assert.rejects(ordinary.request({...f.begin,session_id:randomUUID()}),{code:'EMAIL_RUNTIME_CREDENTIAL_REPAIR_RESERVED'});
 const begun=await f.runtime.request({...f.request,operation:'begin',review,callback_state:'c'.repeat(43)});assert.equal(begun.custody_generation,11);
 const callback={...f.request,operation:'callback',review,runtime_session_ref:begun.runtime_session_ref,callback:{outcome:'authorized',code:'fixture-first-account'}};
 const connected=await f.runtime.request(callback);assert.equal(connected.state,'connected');assert.equal(connected.reservation_closed,false);assert.equal(connected.custody_generation,11);
 const session=(await f.store.withLock({key:'email.runtime.session.'+f.request.session_id},tx=>tx.read())).value;assert.deepEqual(session.binding,f.source.binding);assert.equal(session.binding.authority_epoch,10);assert.equal(session.account.account_ref,f.source.account.account_ref);
 const lineage=(await f.store.withLock({key:lineageKey(session.binding)},tx=>tx.read())).value;validateLineage(lineage,session);assert.deepEqual(lineage.epochs,[10]);assert.equal(lineage.current.custody_generation,11);
 const calls=f.providerCalls;assert.equal((await f.runtime.request(callback)).state,'indeterminate');assert.equal(f.providerCalls,calls);
 const status={...f.request,operation:'status',review,runtime_session_ref:connected.runtime_session_ref,acknowledged_receipt:{session_id:f.request.session_id,session_revision:5,receipt_digest:connected.receipt_digest}};
 await assert.rejects(f.runtime.request(status));await assert.rejects(assertNoCredentialRepair({store:f.store,scope:f.scope}));
 f.acknowledge();assert.equal((await f.runtime.request(status)).reservation_closed,true);await assertNoCredentialRepair({store:f.store,scope:f.scope});f.restart();assert.equal((await f.runtime.request(status)).reservation_closed,true);assert.equal(f.providerCalls,calls);assert.equal((await f.custody.withAccount(f.source.binding,tx=>tx.read())).setup_generation,11);
});

test('durable provider result recovers only exact local commit without repeating exchange',async t=>{
 const f=await repairFixture(t),eligible=await f.runtime.request(f.request),review=reviewed(f.request,eligible),begun=await f.runtime.request({...f.request,operation:'begin',review,callback_state:'c'.repeat(43)});
 f.failLocalCommit();await assert.rejects(f.runtime.request({...f.request,operation:'callback',review,runtime_session_ref:begun.runtime_session_ref,callback:{outcome:'authorized',code:'fixture-first-account'}}),/synthetic local commit interrupted/);
 const calls=f.providerCalls;f.restart();const status={...f.request,operation:'status',review,runtime_session_ref:begun.runtime_session_ref};const result=await f.runtime.request(status);assert.equal(result.state,'connected');assert.equal(result.reservation_closed,false);assert.equal(f.providerCalls,calls);assert.equal((await f.custody.withAccount(f.source.binding,tx=>tx.read())).setup_generation,11);
});

test('wrong provider principal leaves uncertain exchange fenced and never retries it',async t=>{
 const f=await repairFixture(t),eligible=await f.runtime.request(f.request),review=reviewed(f.request,eligible),begun=await f.runtime.request({...f.request,operation:'begin',review,callback_state:'c'.repeat(43)}),callback={...f.request,operation:'callback',review,runtime_session_ref:begun.runtime_session_ref,callback:{outcome:'authorized',code:'fixture-second-account'}};
 await assert.rejects(f.runtime.request(callback));const calls=f.providerCalls;f.restart();assert.equal((await f.runtime.request(callback)).state,'indeterminate');assert.equal((await f.runtime.request({...f.request,operation:'status',review,runtime_session_ref:begun.runtime_session_ref})).state,'indeterminate');assert.equal(f.providerCalls,calls);await assert.rejects(assertNoCredentialRepair({store:f.store,scope:f.scope}));
});

test('prepared cancellation consumes no generation and only exact Host closure acknowledgement opens admission',async t=>{
 const f=await repairFixture(t),eligible=await f.runtime.request(f.request),review=reviewed(f.request,eligible),status={...f.request,operation:'status',review,runtime_session_ref:null,close_prepared:true};
 const result=await f.runtime.request(status);assert.equal(result.state,'cancelled');assert.equal(result.closure.custody_generation,10);assert.equal(result.reservation_closed,false);assert.equal((await f.custody.withAccount(f.source.binding,tx=>tx.read())).setup_generation,10);await assert.rejects(assertNoCredentialRepair({store:f.store,scope:f.scope}));
 f.acknowledge();const {close_prepared:ignored,...ackStatus}=status;const closed=await f.runtime.request({...ackStatus,acknowledged_closure:{session_id:f.request.session_id,session_revision:5,receipt_digest:result.closure.receipt_digest}});assert.equal(closed.reservation_closed,true);await assertNoCredentialRepair({store:f.store,scope:f.scope});const calls=f.providerCalls;f.restart();assert.equal((await f.runtime.request(status)).reservation_closed,true);assert.equal(f.providerCalls,calls);
});

test('provider denial receipts consumed generation11, preserves old custody, and permits reviewed fresh generation12 after closure',async t=>{
 const f=await repairFixture(t),eligible=await f.runtime.request(f.request),review=reviewed(f.request,eligible),old=await f.custody.withAccount(f.source.binding,tx=>tx.read()),begun=await f.runtime.request({...f.request,operation:'begin',review,callback_state:'c'.repeat(43)}),calls=f.providerCalls;
 const denied=await f.runtime.request({...f.request,operation:'callback',review,runtime_session_ref:begun.runtime_session_ref,callback:{outcome:'denied'}});assert.equal(denied.state,'denied');assert.equal(denied.closure.custody_generation,11);assert.equal(f.providerCalls,calls);assert.deepEqual((await f.custody.withAccount(f.source.binding,tx=>tx.read())).secret,old.secret);
 f.acknowledge();const status={...f.request,operation:'status',review,runtime_session_ref:begun.runtime_session_ref,acknowledged_closure:{session_id:f.request.session_id,session_revision:5,receipt_digest:denied.closure.receipt_digest}};assert.equal((await f.runtime.request(status)).reservation_closed,true);f.restart();assert.equal((await f.runtime.request(status)).reservation_closed,true);
 const fresh={...f.request,session_id:randomUUID()},next=await f.runtime.request(fresh);assert.equal(next.custody_generation,11);const nextReview=reviewed(fresh,next),nextBegin=await f.runtime.request({...fresh,operation:'begin',review:nextReview,callback_state:'d'.repeat(43)});assert.equal(nextBegin.custody_generation,12);const result=await f.runtime.request({...fresh,operation:'callback',review:nextReview,runtime_session_ref:nextBegin.runtime_session_ref,callback:{outcome:'authorized',code:'fixture-first-account'}});assert.equal(result.state,'connected');assert.equal(result.custody_generation,12);
});


