import test from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {digestResourceSyncDescriptorV2} from '@deft/app-kit';
import {EMAIL_METADATA_DESCRIPTOR} from './vendor/metadata-resource.mjs';
import {createDurableStore} from './durable-store.mjs';
import {createConnectionRuntime} from './connection-runtime.mjs';
import {createResourceObservationRunner as previousRunner} from './observation-runner-e3-4-fixture.mjs';
import {createResourceObservationRunner as improvedRunner} from './observation-runner.mjs';
import {dataFixtureMessage} from './test-support.mjs';
import {createReattachRuntime} from './connection-reattach-runtime.mjs';
import {createMailboxStore} from './mailbox-store.mjs';
import {createDataRuntime} from './data-runtime.mjs';
import {createEncryptedEmailCustody} from './vendor/providers/custody-encrypted.mjs';
import {reviewDigest,REATTACH_VERSION} from './reattach-contract.mjs';
import {makeScope,registrationFor,client,beginFor,nextFor,authority,twoAccountProviderFixture} from './test-support.mjs';
import {digest,canonical} from './contract.mjs';

async function fixture(t,{factory=improvedRunner,pageSize=25,clockStep=0,authorityLatency=0}={}){let time=Date.now(),authorityCalls=0,onAuthority=null,onProvider=null;const now=()=>time;const parent=await mkdtemp(join(tmpdir(),'email-observation-')),root=join(parent,'private'),encryption_key=Buffer.alloc(32,61),key_id='observation-fixture',scope=makeScope(),registration=registrationFor(scope);let store=await createDurableStore({root,encryption_key,key_id,allow_windows_fixture:process.platform==='win32'});t.after(async()=>{await store.close();await rm(parent,{recursive:true,force:true});});let providerCalls=0,allowed=true,resultCalls=0;const provider=twoAccountProviderFixture(),fetch=async(url,options)=>{providerCalls++;if(onProvider)await onProvider(url,options);const parsed=new URL(url);if(parsed.pathname.endsWith('/messages'))return Response.json({messages:Array.from({length:pageSize},(_,i)=>({id:'synthetic-first-message-'+i})),resultSizeEstimate:pageSize});const match=parsed.pathname.match(/\/messages\/synthetic-first-message-(\d+)$/u);if(match){const metadata=structuredClone(dataFixtureMessage().metadata);metadata.id='synthetic-first-message-'+match[1];metadata.threadId='synthetic-first-thread-'+match[1];return Response.json(metadata);}return provider(url,options);};const connection=createConnectionRuntime({registration,client,store,encryption_key,key_id,assertCurrent:authority,fetch}),begin=beginFor(scope),begun=await connection.request(begin),callback=nextFor(begin,begun,'callback');callback.callback.code='fixture-first-account';const connected=await connection.request(callback);
 const descriptor={...structuredClone(EMAIL_METADATA_DESCRIPTOR),key:'inbox'},descriptor_digest=await digestResourceSyncDescriptorV2(descriptor),claim={schema_version:'deft.app_runtime_channel.v3',audience:'app_resource_sync',work_kind:'sync_page',org_id:scope.org_id,app_installation_id:scope.installation_id,app_version_id:scope.app_version_id,grant_snapshot_id:scope.grant_snapshot_id,lifecycle_epoch:scope.lifecycle_epoch,grant_epoch:scope.grant_epoch,runtime_registration_id:scope.runtime_registration_id,resource_binding_id:scope.resource_binding_id,runtime_epoch:scope.runtime_epoch,session_id:randomUUID(),session_epoch:1,run_id:randomUUID(),attempt_id:randomUUID(),attempt_number:1,claim_token:randomUUID(),sequence:1,lease_expires_at:new Date(Date.now()+60000).toISOString(),descriptor_digest};
 const started={schema_version:claim.schema_version,audience:claim.audience,work_kind:claim.work_kind,resource_binding_id:claim.resource_binding_id,run_id:claim.run_id,attempt_id:claim.attempt_id,sequence:1,lease_expires_at:claim.lease_expires_at,descriptor_digest,descriptor,input:{schema_version:'deft.app_sync_request.v2',cursor:null,max_items:25,attachments:descriptor.attachments}};
 const snapshot={schema_version:'deft.app_resource_observation_consent.v1',consent_id:randomUUID(),scope,connection:{session_id:begin.session_id,runtime_session_ref:begun.runtime_session_ref,account_ref:connected.account.account_ref,expected_custody_generation:null,receipt_digest:null},resource_policy_digest:'sha256:'+'d'.repeat(64),interval_seconds:60,expires_at:scope.consent_expires_at};
 const authorize=async value=>{authorityCalls++;await delay(authorityLatency);if(clockStep)time+=clockStep;else time=Date.now();if(onAuthority)await onAuthority(value);if(!allowed)throw Error('revoked');return {schema_version:'deft.app_resource_observation_authority.v1',audience:'app_resource_sync',session_id:value.session_id,run_id:value.run_id,attempt_id:value.attempt_id,claim_token:value.claim_token,sequence:value.sequence,expires_at:new Date(time+14900).toISOString(),allowed:true,consent_digest:'sha256:'+digest(snapshot),snapshot:structuredClone(snapshot)};};
 const runtime_client={async claim(){return claim;},async start(){return started;},async heartbeat(){return new Date(Date.now()+60000).toISOString();},async result(){resultCalls++;}};
 const binding=(await store.withLock({key:'email.runtime.session.'+begin.session_id},tx=>tx.read())).value.binding;let sealedGeneration=null;
 const runner=options=>factory({now,runtime_client,observation_client:{authorize},registration,client,store:{withLock(input,work){return store.withLock(input,tx=>work({...tx,async compareAndSwap(input){const result=await tx.compareAndSwap(input);if(result&&input.value?.schema_version==='email.app_observation_run.v1')sealedGeneration=input.value.custody_generation;return result;}}));}},encryption_key,key_id,fetch,...options});
 return {claim,started,snapshot,runner,scope,registration,begin,begun,connected,binding,fetch,key_id,encryption_key,get store(){return store;},get sealedGeneration(){return sealedGeneration;},get providerCalls(){return providerCalls;},get resultCalls(){return resultCalls;},get authorityCalls(){return authorityCalls;},advance(ms){time+=ms;},onAuthority(fn){onAuthority=fn;},onProvider(fn){onProvider=fn;},revoke(){allowed=false;},allow(){allowed=true;},async restart(){await store.close();store=await createDurableStore({root,encryption_key,key_id,allow_windows_fixture:process.platform==='win32'});},journalKey:'email.data.request.'+digest(['email.observation.v1',registration,claim.run_id])};
}


test('reproduce25-item observation deadline spent on repeated nested online native checks',async t=>{
 const f=await fixture(t,{factory:previousRunner,clockStep:200}),before=f.providerCalls,result=await f.runner().runOnce();console.log(JSON.stringify({event:'synthetic_observation_before',clock_cost_per_authority_ms:200,authority:f.authorityCalls,provider:f.providerCalls-before,status:result.status}));assert.equal(result.status,'indeterminate');assert.equal(f.resultCalls,0);const journal=(await f.store.withLock({key:f.journalKey},tx=>tx.read())).value;assert.equal(journal.state,'indeterminate');
});

test('request-local pure observation checks retain online provider/commit/disclosure authority within the same budget',async t=>{
 const f=await fixture(t,{clockStep:160}),events=[],before=f.providerCalls,result=await f.runner({onDiagnostic:e=>events.push(e)}).runOnce();console.log(JSON.stringify({event:'synthetic_observation_after',clock_cost_per_authority_ms:160,authority:f.authorityCalls,provider:f.providerCalls-before,status:result.status}));assert.equal(result.status,'returned');assert.equal(result.page.upserts.length,25);assert.equal(f.resultCalls,1);assert.ok(f.authorityCalls<50);assert.equal(f.providerCalls-before,27);assert.deepEqual(events,[]);
});

test('live requested100 still fetches only25 and outputs no file/body handles; late revocation prevents checkpoint/disclosure',async t=>{
 const f=await fixture(t),events=[];f.started.input.max_items=100;const before=f.providerCalls,result=await f.runner({onDiagnostic:e=>events.push(e),onPhase(phase){if(phase==='before_checkpoint')f.revoke();}}).runOnce();assert.equal(result.status,'indeterminate');assert.equal(f.resultCalls,0);assert.equal(f.providerCalls-before,27);assert.ok(events.some(e=>e.phase==='checkpoint'));assert.equal(await createMailboxStore({store:f.store}).cursor({org_id:f.scope.org_id,owner_user_id:f.scope.owner_user_id,account_id:f.connected.account.account_ref},()=>{}),null);const calls=f.providerCalls;f.allow();assert.equal((await f.runner({onDiagnostic:e=>events.push(e)}).runOnce()).status,'indeterminate');assert.equal(f.providerCalls,calls);
});

test('online authority remains fresh between provider requests; frozen locals cannot bypass revocation',async t=>{
 const f=await fixture(t),events=[],before=f.providerCalls;let first=true;f.onProvider(()=>{if(first){first=false;f.revoke();}});assert.equal((await f.runner({onDiagnostic:e=>events.push(e)}).runOnce()).status,'indeterminate');assert.equal(f.providerCalls-before,1);assert.equal(f.resultCalls,0);assert.ok(events.some(e=>e.phase==='provider'));assert.equal((await f.store.withLock({key:f.journalKey},tx=>tx.read())).value.state,'indeterminate');
});

test('current generation changes, caller abort and authority expiry deny local parsing and progress',async t=>{
 for(const kind of ['generation','abort','expiry']){
  const f=await fixture(t),events=[],controller=new AbortController(),before=f.providerCalls;f.onProvider(async()=>{if(kind==='generation')await createEncryptedEmailCustody({store:f.store,encryption_key:f.encryption_key,key_id:f.key_id}).withAccount(f.binding,tx=>tx.advanceSetup());if(kind==='abort')controller.abort();if(kind==='expiry')f.advance(31000);});assert.equal((await f.runner({onDiagnostic:e=>events.push(e)}).runOnce(controller.signal)).status,'indeterminate');assert.equal(f.resultCalls,0);assert.equal(f.providerCalls-before,1);console.log(JSON.stringify({event:'synthetic_fence_diagnostic',kind,events}));assert.ok(events.some(e=>kind==='generation'?['EMAIL_OBSERVATION_CUSTODY_DENIED','EMAIL_ACCOUNT_REVOKED'].includes(e.code):kind==='abort'?e.code==='EMAIL_OBSERVATION_CANCELLED':e.code==='EMAIL_OBSERVATION_EXPIRED'));assert.equal(await createMailboxStore({store:f.store}).cursor({org_id:f.scope.org_id,owner_user_id:f.scope.owner_user_id,account_id:f.connected.account.account_ref},()=>{}),null);
 }
});

test('allowlisted failure diagnostics contain stage/counts only and never reflect arbitrary provider exceptions',async t=>{
 const f=await fixture(t),events=[];const result=await f.runner({onDiagnostic:e=>events.push(e),async fetch(){throw Object.assign(Error('DO_NOT_EMIT_token_and_raw_body'),{code:'DO_NOT_EMIT_ARBITRARY_CODE'});}}).runOnce();assert.equal(result.status,'indeterminate');assert.ok(events.length);const printed=JSON.stringify(events);assert.ok(!printed.includes('DO_NOT_EMIT'));for(const event of events)assert.deepEqual(Object.keys(event).sort(),['event','run_id','phase','code','elapsed_ms','authority_calls','provider_calls'].sort());console.log(JSON.stringify({event:'synthetic_failure_diagnostic',events}));assert.ok(events.every(e=>e.code==='EMAIL_PROVIDER_NETWORK_UNAVAILABLE'));
});


test('same25-item real authority-latency fixture measures requests and elapsed before and after',async t=>{
 const measurements=[];for(const [label,factory]of [['before',previousRunner],['after',improvedRunner]]){const f=await fixture(t,{factory,authorityLatency:10}),before=f.providerCalls,start=performance.now(),result=await f.runner({onDiagnostic:()=>{}}).runOnce();measurements.push({label,authority_latency_ms:10,provider:f.providerCalls-before,authority:f.authorityCalls,elapsed_ms:Math.round(performance.now()-start),status:result.status});assert.equal(result.status,'returned');assert.equal(result.page.upserts.length,25);}
 console.log(JSON.stringify({event:'synthetic_observation_measured',measurements}));assert.equal(measurements[0].provider,measurements[1].provider);// Immutable publication adds current boundary checks; retain at least50% fewer authority roundtrips with the same actual provider reads. Wall-time remains measured evidence because durable filesystem latency varies across platforms.
 assert.ok(measurements[0].authority>=measurements[1].authority*2);
});


test('observation retains every authority check while bounding one peer burst under actual16 slots',async t=>{
 const f=await fixture(t),events=[];let active=0,peak=0,overloaded=0,checks=0;
 // Seven already-admitted same-peer requests leave nine of the real16 slots.
 // This is competing-work evidence, not a claim that10 alone exceeds16.
 f.onAuthority(async()=>{checks++;active++;peak=Math.max(peak,active);try{if(active+7>16){overloaded++;throw Object.assign(Error('static authority overload'),{code:'APP_RESOURCE_SYNC_FAILURE',status:503});}await delay(100);}finally{active--;}});
 const result=await f.runner({onDiagnostic:e=>events.push(e)}).runOnce();
 console.log(JSON.stringify({event:'synthetic_observation_authority_burst',peer_limit:16,competing_requests:7,peak,overloaded,checks,status:result.status,diagnostics:events}));
 assert.equal(result.status,'returned');assert.equal(result.page.upserts.length,25);assert.equal(overloaded,0);assert.equal(peak,1);assert.equal(f.resultCalls,1);assert.ok(checks>25);
});


test('Host503 diagnostics retain their closed origin and queued failures never reach provider or disclosure',async t=>{
 const f=await fixture(t),events=[],before=f.providerCalls;let calls=0;
 f.onAuthority(async()=>{calls++;await delay(10);throw Object.assign(Error('PRIVATE_HOST_BODY_MUST_NOT_ESCAPE'),{code:'APP_RESOURCE_SYNC_FAILURE',status:503});});
 assert.equal((await f.runner({onDiagnostic:e=>events.push(e)}).runOnce()).status,'indeterminate');
 assert.equal(calls,1);assert.equal(f.providerCalls,before);assert.equal(f.resultCalls,0);assert.equal(events.length,1);assert.equal(events[0].code,'APP_RESOURCE_SYNC_FAILURE');assert.equal(events[0].http_status,503);assert.ok(!JSON.stringify(events).includes('PRIVATE_HOST_BODY'));
});


test('queued authority abort remains fenced before provider and never emits a result',async t=>{
 const f=await fixture(t),events=[],controller=new AbortController(),before=f.providerCalls;
 f.onAuthority(async()=>{controller.abort();await delay(20);});
 assert.equal((await f.runner({onDiagnostic:e=>events.push(e)}).runOnce(controller.signal)).status,'indeterminate');assert.equal(f.providerCalls,before);assert.equal(f.resultCalls,0);assert.ok(events.some(e=>e.code==='EMAIL_OBSERVATION_CANCELLED'));
});


test('mid-provider Host503 settles queued checks without further provider I/O or retry',async t=>{
 const f=await fixture(t),events=[],before=f.providerCalls;let denied=0;
 f.onAuthority(async()=>{await delay(5);if(f.providerCalls-before>=2){denied++;throw Object.assign(Error('opaque Host body'),{code:'APP_RESOURCE_SYNC_FAILURE',status:503});}});
 assert.equal((await f.runner({onDiagnostic:e=>events.push(e)}).runOnce()).status,'indeterminate');assert.equal(denied,1);assert.equal(f.providerCalls-before,2);assert.equal(f.resultCalls,0);assert.equal(events.length,1);assert.equal(events[0].code,'APP_RESOURCE_SYNC_FAILURE');assert.equal(events[0].http_status,503);
 const calls=f.providerCalls;assert.equal((await f.runner({onDiagnostic:()=>{}}).runOnce()).status,'indeterminate');assert.equal(f.providerCalls,calls);
});
