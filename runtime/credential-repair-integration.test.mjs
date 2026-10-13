import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './credential-repair-test-support.mjs';
import {client,authority} from './test-support.mjs';
import {digest} from './contract.mjs';
import {createRegistrationDispatcher} from './registration-dispatch.mjs';
import {createCredentialRepairPorts} from './credential-repair-ports.mjs';
import {createEncryptedEmailCustody} from './vendor/providers/custody-encrypted.mjs';
import {REPAIR_VERSION,repairReviewDigest} from './credential-repair-contract.mjs';

for(const denial of [false,true,'unknown'])test('registered repair preserves publication through '+(denial==='unknown'?'abandoned UNKNOWN then generation12':denial?'denied closure then generation12':'generation11')+' using immutable journal and real lineage',async t=>{
 const f=await fixture(t),first=await f.runner().runOnce();assert.equal(first.status,'returned');
 const old=(await f.store.withLock({key:f.journalKey},tx=>tx.read())).value;
 const unknown={...old,state:'indeterminate'};delete unknown.page;
 await f.store.withLock({key:f.journalKey},async tx=>{const row=await tx.read();await tx.compareAndSwap({expected_revision:row.revision,value:unknown});});
 let request={schema_version:REPAIR_VERSION,session_id:randomUUID(),scope:f.scope,source:{scope:f.scope,session_id:f.begin.session_id,session_revision:5,runtime_session_ref:f.begun.runtime_session_ref,account_ref:f.connected.account.account_ref},transport_digest:'sha256:'+'8'.repeat(64),review_expires_at:new Date(Date.now()+300000).toISOString(),expires_at:new Date(Date.now()+29000).toISOString(),action_consents:[],historical_attempts:[{run_id:f.claim.run_id,attempt_id:f.claim.attempt_id,attempt_digest:'sha256:'+'9'.repeat(64)}],publication_continuity_digest:null,operation:'prepare'};
 let clock=Date.now(),lose=false;
 if(denial==='unknown')await createEncryptedEmailCustody({store:f.store,encryption_key:f.encryption_key,key_id:f.key_id}).withAccount(f.binding,async tx=>{const r=tx.read();await tx.write({health:'reauth_required',secret:{...r.secret,access_token:'discarded',refresh_token:'discarded',expires_at:0}});});
 const runtime=createRegistrationDispatcher({registrations:[{...f.registration,connection_protocol:'v2'}],client,store:f.store,encryption_key:f.encryption_key,key_id:f.key_id,assertCurrent:authority,assertV2Current:authority,assertUpgradeCurrent:authority,now:()=>clock,fetch:async(...args)=>{if(lose)throw Error('synthetic response lost');return f.fetch(...args);}});
 const eligible=await runtime.request(request);assert.equal(eligible.state,'eligible');assert.equal((await runtime.request(request)).fence.publication_continuity_digest,eligible.fence.publication_continuity_digest);
 const eligibility=Object.fromEntries(['account','custody_generation','custody_digest','fence'].map(k=>[k,eligible[k]]));let review={...eligibility,digest:repairReviewDigest(request,eligibility)};
 let begun=await runtime.request({...request,operation:'begin',review,callback_state:'c'.repeat(43)});
 if(denial){let closed;if(denial==='unknown'){
  lose=true;await assert.rejects(runtime.request({...request,operation:'callback',review,runtime_session_ref:begun.runtime_session_ref,callback:{outcome:'authorized',code:'synthetic-lost-code'}}));lose=false;clock=Date.parse(request.review_expires_at)+1;request={...request,expires_at:new Date(clock+29000).toISOString()};closed=await runtime.request({...request,operation:'status',review,runtime_session_ref:begun.runtime_session_ref,close_uncertain:true});assert.equal(closed.closure.reason,'exchange_abandoned');
 }else closed=await runtime.request({...request,operation:'callback',review,runtime_session_ref:begun.runtime_session_ref,callback:{outcome:'denied'}});await runtime.request({...request,operation:'status',review,runtime_session_ref:begun.runtime_session_ref,acknowledged_closure:{session_id:request.session_id,session_revision:5,receipt_digest:closed.closure.receipt_digest}});f.snapshot.connection={...f.snapshot.connection,expected_custody_generation:11,receipt_digest:closed.closure.receipt_digest};f.claim.run_id=randomUUID();f.claim.attempt_id=randomUUID();f.started.run_id=f.claim.run_id;f.started.attempt_id=f.claim.attempt_id;const beforeCalls=f.providerCalls,closurePorts=createCredentialRepairPorts({store:f.store,registration:f.registration});const afterClosure=await f.runner({repairContinuity:closurePorts.repairContinuity}).runOnce();assert.equal(afterClosure.status,denial==='unknown'?'indeterminate':'returned');if(denial!=='unknown')assert.deepEqual(afterClosure.page,first.page);assert.equal(f.providerCalls,beforeCalls);request={...request,session_id:randomUUID(),review_expires_at:new Date(clock+300000).toISOString(),expires_at:new Date(clock+29000).toISOString()};const fresh=await runtime.request(request),pins=Object.fromEntries(['account','custody_generation','custody_digest','fence'].map(k=>[k,fresh[k]]));review={...pins,digest:repairReviewDigest(request,pins)};begun=await runtime.request({...request,operation:'begin',review,callback_state:'d'.repeat(43)});}
 const connected=await runtime.request({...request,operation:'callback',review,runtime_session_ref:begun.runtime_session_ref,callback:{outcome:'authorized',code:'fixture-first-account'}});
 assert.equal(connected.state,'connected');assert.equal(connected.custody_generation,denial?12:11);
 await runtime.request({...request,operation:'status',review,runtime_session_ref:connected.runtime_session_ref,acknowledged_receipt:{session_id:request.session_id,session_revision:5,receipt_digest:connected.receipt_digest}});
 assert.deepEqual((await f.store.withLock({key:f.journalKey},tx=>tx.read())).value,unknown);
 f.snapshot.connection={session_id:request.session_id,runtime_session_ref:connected.runtime_session_ref,account_ref:connected.account.account_ref,expected_custody_generation:connected.custody_generation,receipt_digest:connected.receipt_digest};
 f.claim.run_id=randomUUID();f.claim.attempt_id=randomUUID();f.started.run_id=f.claim.run_id;f.started.attempt_id=f.claim.attempt_id;
 const calls=f.providerCalls,ports=createCredentialRepairPorts({store:f.store,registration:f.registration});
 const preserved=await f.runner({repairContinuity:ports.repairContinuity}).runOnce();assert.equal(preserved.status,'returned');assert.deepEqual(preserved.page,first.page);assert.equal(f.providerCalls,calls);
 const oldConsumer={snapshot:old.pins.snapshot,consent_digest:old.pins.consent_digest,descriptor_digest:old.pins.claim.descriptor_digest,custody_generation:10,client_fingerprint:(await f.store.withLock({key:'email.runtime.session.'+f.begin.session_id},tx=>tx.read())).value.client_fingerprint,max_items:old.pins.started.input.max_items};
 const scope={org_id:f.scope.org_id,owner_user_id:f.scope.owner_user_id,account_id:connected.account.account_ref},publicationKey='email.data.sync_publication.'+digest([scope,digest(oldConsumer)]);
 assert.equal((await f.store.withLock({key:publicationKey},tx=>tx.read())).value.result.next_cursor,first.page.next_cursor);
});


