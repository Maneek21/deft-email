import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDurableStore} from './durable-store.mjs';
import {createConnectionRuntime} from './connection-runtime.mjs';
import {createDataRuntime} from './data-runtime.mjs';
import {makeScope,registrationFor,client,providerFixture,authority,beginFor,nextFor} from './test-support.mjs';

async function fixture(t){
  const parent=await mkdtemp(join(tmpdir(),'email-sync-busy-')),root=join(parent,'private'),encryption_key=Buffer.alloc(32,51),key_id='sync-busy-fixture',scope=makeScope(),registration=registrationFor(scope);
  const store=await createDurableStore({root,encryption_key,key_id,allow_windows_fixture:process.platform==='win32'});
  let providerCalls=0,allowed=true;const fetch=async(url,options)=>{providerCalls++;return providerFixture(url,options);};
  const connectionRuntime=createConnectionRuntime({registration,client,store,encryption_key,key_id,assertCurrent:authority,fetch});
  const begin=beginFor(scope),begun=await connectionRuntime.request(begin),connected=await connectionRuntime.request(nextFor(begin,begun,'callback'));
  const events=[];
  const createRuntime=()=>createDataRuntime({registrations:[registration],client,store,encryption_key,key_id,onDiagnostic:event=>events.push(event),assertCurrent:async(input,signal)=>{if(!allowed)throw Object.assign(Error('revoked'),{code:'EMAIL_DATA_AUTHORITY_DENIED'});return await authority(input,signal);},fetch});
  let runtime=createRuntime();
  t.after(async()=>{await store.close();await rm(parent,{recursive:true,force:true});});
  const request=(operation,input={store_key:'drafts',resource_key:'inbox'})=>({schema_version:'deft.app_data_runtime.v1',request_id:randomUUID(),scope,connection:{session_id:begin.session_id,session_revision:5,runtime_session_ref:begun.runtime_session_ref,account_ref:connected.account.account_ref},authority:{consent_id:randomUUID(),consent_digest:'sha256:'+'d'.repeat(64),data_policy_digest:'sha256:'+'e'.repeat(64)},operation,expires_at:new Date(Date.now()+29000).toISOString(),input});
  return {root,store,begin,request,run:(...args)=>runtime.request(...args),events,fetch,deny(){allowed=false;},get providerCalls(){return providerCalls;},async restart(){await store.close();},get runtime(){return runtime;}};
}

test('refresh does not queue behind a running observation holding the account session lock',async t=>{
  const f=await fixture(t),sessionKey='email.runtime.session.'+f.begin.session_id;
  let release,enteredResolve;const gate=new Promise(done=>release=done),entered=new Promise(done=>enteredResolve=done);let callsAtGate;
  // Simulate the observation's provider phase: real durable lock plus a gated
  // provider request, exactly the span a foreground refresh used to queue behind.
  const observation=f.store.withLock({key:sessionKey},async tx=>{
    await f.fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile',{headers:{}});
    callsAtGate=f.providerCalls;enteredResolve();await gate;return tx.read();
  });
  await entered;
  let result,elapsed,pending;
  try{
    assert.equal(f.store.isHeld(sessionKey),true);
    const before=f.providerCalls,eventsBefore=f.events.length,start=performance.now();
    pending=f.run(f.request('resource_refresh'));
    try{
      result=await Promise.race([pending,delay(1500).then(()=>{throw Error('BUSY_REFRESH_QUEUED_BEHIND_SESSION_LOCK');})]);
    }finally{elapsed=performance.now()-start;}
    assert.ok(elapsed<300,`busy refresh must return promptly, took ${elapsed.toFixed(1)}ms`);
    assert.equal(f.providerCalls,before,'busy fast path performs no provider I/O');
    assert.equal(result.outcome,'completed');
    assert.equal(Object.hasOwn(result,'items'),false,'busy fast path discloses no rows');
    assert.equal(result.freshness.provider_observed,false);
    assert.equal(result.freshness.observed_at,null);
    assert.equal(result.freshness.complete,false);
    assert.ok(Number.isSafeInteger(result.freshness.checkpoint_generation));
    assert.ok(Number.isSafeInteger(result.freshness.coverage_generation));
    const timing=f.events.slice(eventsBefore).find(event=>event.event==='email_foreground_timing');
    assert.ok(timing,'the request keeps its ordinary diagnostic envelope');
    assert.equal(timing.timings.session_queue,undefined,'the fast path never enters the session queue');
    assert.equal(timing.timings.session_hold,undefined,'the fast path never holds the session lock');
    assert.ok(timing.timings.authority.calls>=1,'the opening Host authority still ran');
  }finally{
    release();await observation;await pending?.catch(()=>{});
  }
  assert.equal(f.store.isHeld(sessionKey),false,'the observation completes normally after release');
});

test('a busy fast path cannot bypass a denying Host authority',async t=>{
  const f=await fixture(t),sessionKey='email.runtime.session.'+f.begin.session_id;
  let release,enteredResolve;const gate=new Promise(done=>release=done),entered=new Promise(done=>enteredResolve=done);
  const observation=f.store.withLock({key:sessionKey},async tx=>{enteredResolve();await gate;return tx.read();});
  await entered;f.deny();
  try{
    await assert.rejects(f.run(f.request('resource_refresh')),error=>error.code==='EMAIL_DATA_AUTHORITY_DENIED');
  }finally{release();await observation;}
});

test('isHeld is a side-effect-free read of the in-process queue',async t=>{
  const parent=await mkdtemp(join(tmpdir(),'email-durable-held-')),root=join(parent,'private'),key='synthetic.unheld.key';
  const store=await createDurableStore({root,encryption_key:Buffer.alloc(32,52),key_id:'sync-held-fixture',allow_windows_fixture:process.platform==='win32'});
  t.after(async()=>{await store.close();await rm(parent,{recursive:true,force:true});});
  const before=await readdir(root);
  assert.equal(store.isHeld(key),false);
  assert.equal(store.isHeld(key),false);
  assert.deepEqual(await readdir(root),before,'probing a fresh key creates no file or directory');
  let observed=false;const start=performance.now();
  await store.withLock({key},async tx=>{observed=store.isHeld(key);assert.equal(await tx.read(),null);});
  assert.ok(performance.now()-start<300,'a probe never leaves a queue entry behind');
  assert.equal(observed,true);
  assert.equal(store.isHeld(key),false,'the queue clears after release');
});
