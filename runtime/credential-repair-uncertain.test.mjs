import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {digest} from './contract.mjs';
import {repairFixture} from './credential-repair.test.mjs';
import {repairReviewDigest} from './credential-repair-contract.mjs';
import {assertNoCredentialRepair} from './credential-repair-reservation.mjs';

test('admitted repair callback retains bounded lifetime across the review cutoff',async t=>{
 let clock=Date.now(),provider;
 const f=await repairFixture(t,{now:()=>clock,fetch:async(...args)=>{if(args[0]==='https://oauth2.googleapis.com/token')clock+=21000;return provider(...args);}});provider=f.fetch;
 f.request.review_expires_at=new Date(clock+20000).toISOString();f.request.expires_at=new Date(clock+19900).toISOString();
 const eligible=await f.runtime.request(f.request),eligibility=Object.fromEntries(['account','custody_generation','custody_digest','fence'].map(k=>[k,eligible[k]])),review={...eligibility,digest:repairReviewDigest(f.request,eligibility)};
 const begun=await f.runtime.request({...f.request,operation:'begin',review,callback_state:'c'.repeat(43)});
 const result=await f.runtime.request({...f.request,expires_at:new Date(clock+29000).toISOString(),operation:'callback',review,runtime_session_ref:begun.runtime_session_ref,callback:{outcome:'authorized',code:'fixture-first-account'}});
 assert.equal(result.state,'connected');assert.equal(result.custody_generation,11);assert.ok(clock>Date.parse(f.request.review_expires_at));
});

test('uncertain exchange: consumed callback is never replayed and needs an explicit fenced closure',async t=>{
 let clock=Date.now(),posts=0,failExchange=true,provider;
 const f=await repairFixture(t,{now:()=>clock,fetch:async(...args)=>{if(args[0]==='https://oauth2.googleapis.com/token')posts++;if(failExchange)throw Error('synthetic lost provider response');return provider(...args);}});provider=f.fetch;
 // Match the original deployed state: credentials were already unusable before Begin.
 await f.custody.withAccount(f.source.binding,async tx=>{const r=tx.read();await tx.write({health:'reauth_required',secret:{...r.secret,access_token:'discarded',refresh_token:'discarded',expires_at:0}});});
 const eligible=await f.runtime.request(f.request),eligibility=Object.fromEntries(['account','custody_generation','custody_digest','fence'].map(k=>[k,eligible[k]])),review={...eligibility,digest:repairReviewDigest(f.request,eligibility)};
 const begun=await f.runtime.request({...f.request,operation:'begin',review,callback_state:'c'.repeat(43)});
 const callback={...f.request,operation:'callback',review,runtime_session_ref:begun.runtime_session_ref,callback:{outcome:'authorized',code:'synthetic-once-only-code'}};
 await assert.rejects(f.runtime.request(callback));assert.equal(posts,1);
 await f.reopenStore();assert.equal((await f.runtime.request(callback)).state,'indeterminate');assert.equal(posts,1);
 await assert.rejects(f.runtime.request({...f.request,operation:'status',review,runtime_session_ref:begun.runtime_session_ref,close_uncertain:true}));
 clock=Date.parse(f.request.review_expires_at)+1;
 const status={...f.request,operation:'status',expires_at:new Date(clock+29000).toISOString(),review,runtime_session_ref:begun.runtime_session_ref};
 assert.equal((await f.runtime.request(status)).state,'indeterminate');await assert.rejects(assertNoCredentialRepair({store:f.store,scope:f.scope}));
 await assert.rejects(f.runtime.request({...status,runtime_session_ref:'wrong-reference',close_uncertain:true}));
 const prior=await f.custody.withAccount(f.source.binding,tx=>tx.read());
 await f.custody.withAccount(f.source.binding,tx=>tx.write({health:'connected',secret:prior.secret}));
 await assert.rejects(f.runtime.request({...status,close_uncertain:true}));
 await f.custody.withAccount(f.source.binding,tx=>tx.write({health:prior.health,secret:prior.secret}));
 const reservationKey='email.runtime.credential_repair_reservation.'+digest([f.scope.org_id,f.scope.installation_id,f.scope.resource_binding_id]);
 const reserved=await f.store.withLock({key:reservationKey},tx=>tx.read());
 await f.store.withLock({key:reservationKey},tx=>tx.compareAndSwap({expected_revision:reserved.revision,value:{...reserved.value,state:'closed'}}));
 await assert.rejects(f.runtime.request({...status,close_uncertain:true}));
 const stillClosed=await f.store.withLock({key:reservationKey},tx=>tx.read());assert.equal(stillClosed.value.state,'closed');assert.equal(stillClosed.revision,reserved.revision+1);
 await f.store.withLock({key:reservationKey},tx=>tx.compareAndSwap({expected_revision:stillClosed.revision,value:reserved.value}));
 const closed=await f.runtime.request({...status,close_uncertain:true});
 assert.equal(closed.state,'cancelled');assert.equal(closed.closure.reason,'exchange_abandoned');assert.equal(closed.closure.custody_generation,11);assert.equal(closed.reservation_closed,false);assert.equal(posts,1);
 const j=(await f.store.withLock({key:'email.runtime.credential_repair.'+f.request.session_id},tx=>tx.read())).value;
 assert.equal(j.exchange_outcome,'unknown');assert.equal(j.abandoned_from_state,'exchange_started');assert.equal(j.new_session,undefined);
 await assert.rejects(assertNoCredentialRepair({store:f.store,scope:f.scope}));
 f.acknowledge();const result=await f.runtime.request({...status,acknowledged_closure:{session_id:f.request.session_id,session_revision:5,receipt_digest:closed.closure.receipt_digest}});
 assert.equal(result.reservation_closed,true);await assertNoCredentialRepair({store:f.store,scope:f.scope});assert.equal(posts,1);
 assert.equal((await f.custody.withAccount(f.source.binding,tx=>tx.read())).health,'reauth_required');
 await f.reopenStore();assert.deepEqual(await f.runtime.request({...status,close_uncertain:true}),{...closed,reservation_closed:true});assert.equal(posts,1);
 failExchange=false;const fresh={...f.request,session_id:randomUUID(),review_expires_at:new Date(clock+300000).toISOString(),expires_at:new Date(clock+29000).toISOString()};
 const next=await f.runtime.request(fresh),nextEligibility=Object.fromEntries(['account','custody_generation','custody_digest','fence'].map(k=>[k,next[k]])),nextReview={...nextEligibility,digest:repairReviewDigest(fresh,nextEligibility)};
 assert.equal(next.custody_generation,11);const nextBegin=await f.runtime.request({...fresh,operation:'begin',review:nextReview,callback_state:'d'.repeat(43)});
 const nextResult=await f.runtime.request({...fresh,operation:'callback',review:nextReview,runtime_session_ref:nextBegin.runtime_session_ref,callback:{outcome:'authorized',code:'fixture-first-account'}});
 assert.equal(nextResult.state,'connected');assert.equal(nextResult.custody_generation,12);assert.equal(posts,2);
});

test('uncertain closure waits for original callback and cannot admit a late custody write',async t=>{
 let clock=Date.now(),entered,release,posts=0;const started=new Promise(r=>entered=r),blocked=new Promise(r=>release=r);
 const f=await repairFixture(t,{now:()=>clock,fetch:async()=>{posts++;entered();await blocked;return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',token_type:'Bearer',expires_in:3600,scope:'openid email https://www.googleapis.com/auth/gmail.readonly'});}});
 await f.custody.withAccount(f.source.binding,async tx=>{const r=tx.read();await tx.write({health:'reauth_required',secret:{...r.secret,access_token:'discarded',refresh_token:'discarded',expires_at:0}});});
 const eligible=await f.runtime.request(f.request),eligibility=Object.fromEntries(['account','custody_generation','custody_digest','fence'].map(k=>[k,eligible[k]])),review={...eligibility,digest:repairReviewDigest(f.request,eligibility)},begun=await f.runtime.request({...f.request,operation:'begin',review,callback_state:'c'.repeat(43)});
 const callback=f.runtime.request({...f.request,operation:'callback',review,runtime_session_ref:begun.runtime_session_ref,callback:{outcome:'authorized',code:'synthetic-once-only-code'}}).then(()=>{throw Error('expired callback unexpectedly succeeded');},()=>{});
 await started;clock=Date.parse(f.request.review_expires_at)+1;let finished=false;
 const closure=f.runtime.request({...f.request,operation:'status',expires_at:new Date(clock+29000).toISOString(),review,runtime_session_ref:begun.runtime_session_ref,close_uncertain:true}).then(r=>{finished=true;return r;});
 await new Promise(r=>setTimeout(r,20));assert.equal(finished,false);release();await callback;const result=await closure;
 assert.equal(result.closure.reason,'exchange_abandoned');assert.equal(posts,1);const record=await f.custody.withAccount(f.source.binding,tx=>tx.read());assert.equal(record.health,'reauth_required');assert.equal(record.setup_generation,11);
});
