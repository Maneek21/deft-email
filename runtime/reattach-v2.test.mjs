import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {createDurableStore} from './durable-store.mjs';
import {createRegistrationContinuity} from './registration-continuity.mjs';
import {createRegistrationDispatcher} from './registration-dispatch.mjs';
import {createDataRuntime} from './data-runtime.mjs';
import {createHttpHandler} from './http.mjs';
import {createPreparedActions} from './prepared-actions.mjs';
import {sealPurposeSet,purposeFor} from './purpose-set.mjs';
import {createOwnedSourceResolver,validateLineage,lineageKey} from './account-lineage.mjs';
import {canonical,digest} from './contract.mjs';
import {REATTACH_V2_VERSION as REATTACH_VERSION,reviewDigest,receiptDigest} from './reattach-contract.mjs';
import {makeScope,registrationFor,client,authority,beginFor,nextFor,twoAccountProviderFixture} from './test-support.mjs';
const empty={mode:'compose',to:'target@example.test',cc:'',bcc:'',subject:'Unsent',body:'Exact unsent\n',body_html:'',reply_record_id:'',attachments:[]};
const legacyAction=scope=>({action_binding_id:randomUUID(),action_key:'send_message',authority_epoch:scope.runtime_epoch,consent_id:randomUUID(),consent_digest:'sha256:'+'d'.repeat(64),expires_at:scope.consent_expires_at});
const upgraded=scope=>({...scope,app_version_id:randomUUID(),grant_snapshot_id:randomUUID(),resource_binding_id:randomUUID(),runtime_registration_id:randomUUID(),lifecycle_epoch:scope.lifecycle_epoch+1,grant_epoch:scope.grant_epoch+1});
const actions=scope=>['mirror_drafts','organize_messages','send_message'].map(action_key=>{const id=randomUUID();return {action_key,action_binding_id:id,consent_id:id,authority_epoch:scope.runtime_epoch,consent_digest:'sha256:'+'d'.repeat(64),expires_at:scope.consent_expires_at};});
async function fixture(t,{readOnly=false,automatic=false}={}){
 const root=await mkdtemp(join(tmpdir(),'email-reattach-e3-')),key=Buffer.alloc(32,59),scopes=[makeScope()];let store,runtime,data,continuity,calls=0,allowed=true,crash=null,offset=0,authorityLatency=0;const now=()=>Date.now()+offset;const provider=twoAccountProviderFixture(),fetch=async(...args)=>{calls++;return provider(...args);};
 const open=async()=>{store=await createDurableStore({root,encryption_key:key,key_id:'reattach-test',allow_windows_fixture:process.platform==='win32'});const wrapped={withLock(options,work){return store.withLock(options,tx=>work({...tx,async compareAndSwap(input){const result=await tx.compareAndSwap(input);if(crash?.(options,input)){crash=null;throw Error('synthetic committed-write crash');}return result;}}));}},deps={store:wrapped,client,encryption_key:key,key_id:'reattach-test',fetch,assertCurrent:authority,assertV2Current:authority,now};continuity=automatic?await createRegistrationContinuity({registrations:scopes.map(scope=>({...registrationFor(scope),connection_protocol:'v2'})),store:wrapped}):undefined;runtime=createRegistrationDispatcher({...deps,registrationContinuity:continuity,registrations:scopes.map(scope=>({...registrationFor(scope),connection_protocol:'v2'})),assertReattachCurrent:async request=>{offset+=authorityLatency;return {...request,allowed};}});data=createDataRuntime({...deps,getRegistrations:continuity?.all,registrations:scopes.map(scope=>({...registrationFor(scope),connection_protocol:'v2'}))});};await open();
 const begin={...beginFor(scopes[0]),schema_version:'deft.app_connection_runtime.v2',action_consents:readOnly?[]:actions(scopes[0])},begun=await runtime.request(begin),callback={...begin,operation:'callback',runtime_session_ref:begun.runtime_session_ref,callback:{outcome:'authorized',code:'fixture-first-account-both'}};delete callback.callback_state;const connected=await runtime.request(callback);let session_id=begin.session_id,runtime_session_ref=begun.runtime_session_ref,currentScope=scopes[0],account=connected.account;
 const dataRequest=(operation,input)=>({schema_version:'deft.app_data_runtime.v1',request_id:randomUUID(),scope:currentScope,connection:{session_id,session_revision:5,runtime_session_ref,account_ref:account.account_ref},authority:{consent_id:randomUUID(),consent_digest:'sha256:'+'e'.repeat(64),data_policy_digest:'sha256:'+'f'.repeat(64)},operation,expires_at:new Date(Date.now()+29000).toISOString(),input});
 const next=async(send=false,enroll=true)=>{const target=upgraded(currentScope);if(enroll){scopes.push(target);await store.close();await open();}const request={schema_version:REATTACH_VERSION,session_id:randomUUID(),scope:target,source:{session_id,session_revision:5,scope:currentScope,runtime_session_ref,account_ref:account.account_ref},transport_digest:'sha256:'+'1'.repeat(64),review_expires_at:new Date(Date.now()+60000).toISOString(),expires_at:new Date(Date.now()+29000).toISOString(),operation:'prepare',action_consents:readOnly?[]:actions(target)};return request;};
 const prepare=async request=>{const value=await runtime.request(request);const {schema_version,session_id,state,...eligibility}=value;return {...request,operation:'activate',review:{...eligibility,digest:reviewDigest(request,eligibility)}};};
 const activate=async request=>{const value=await runtime.request(request);currentScope=request.scope;session_id=request.session_id;runtime_session_ref=value.runtime_session_ref;return value;};
 t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true});});return {get enrollment(){return continuity;},get store(){return store;},get runtime(){return runtime;},get data(){return data;},get calls(){return calls;},get scope(){return currentScope;},get id(){return session_id;},get account(){return account;},get ref(){return runtime_session_ref;},dataRequest,next,prepare,activate,now,advance(ms){offset+=ms;},latency(ms){authorityLatency=ms;},deny(){allowed=false;},failWrite(predicate){crash=predicate;},async restart(){await store.close();await open();}};
}

test('v2 HTTP reattachment retains exact encrypted secret/account, reseals purposes, and preserves original source history',async t=>{
 const f=await fixture(t),source=(await f.store.withLock({key:'email.runtime.session.'+f.id},tx=>tx.read())).value;
 const beforeCustody=await f.data.custody.withAccount(source.binding,tx=>tx.read()),request=await f.next(),before=f.calls;
 const token='A'.repeat(43),server=createServer(createHttpHandler({runtime:{request:(...args)=>f.runtime.request(...args)},runtime_auth_token:token}));
 await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>server.close(done)));
 const post=async input=>{const response=await fetch('http://127.0.0.1:'+server.address().port+'/v1/connections',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(input)});assert.equal(response.status,200);return response.json();};
 const eligible=await post(request),{schema_version,session_id,state,...eligibility}=eligible,activate={...request,operation:'activate',review:{...eligibility,digest:reviewDigest(request,eligibility)}};
 const connected=await post(activate);assert.equal(connected.state,'connected');assert.deepEqual(await post({...activate,operation:'status'}),connected);
 const session=(await f.store.withLock({key:'email.runtime.session.'+request.session_id},tx=>tx.read())).value,custody=await f.data.custody.withAccount(session.binding,tx=>tx.read());
 assert.deepEqual(custody.secret,beforeCustody.secret);assert.equal(custody.setup_generation,beforeCustody.setup_generation+1);assert.equal(session.account.account_ref,source.account.account_ref);
 assert.deepEqual(session.action_consents,request.action_consents);assert.deepEqual(session.purpose_set,sealPurposeSet(session.binding,request.action_consents,custody.setup_generation));
 assert.equal(purposeFor(session,'mirror_drafts').consent_id,request.action_consents[0].consent_id);
 validateLineage((await f.store.withLock({key:lineageKey(session.binding)},tx=>tx.read())).value,session);
 assert.deepEqual((await f.store.withLock({key:'email.runtime.session.'+source.session_id},tx=>tx.read())).value,source);assert.equal(f.calls,before);
});
test('v2 wrong registration, changed profile/purposes, source and protocol downgrade deny before custody/provider work',async t=>{
 const f=await fixture(t),request=await f.next(),before=f.calls;
 for(const mutate of [r=>r.scope.runtime_registration_id=randomUUID(),r=>r.scope.profile_digest='sha256:'+'9'.repeat(64),r=>r.action_consents.pop(),r=>r.source.runtime_session_ref='wrong',r=>r.scope.lifecycle_epoch=r.source.scope.lifecycle_epoch,r=>{r.schema_version='deft.app_connection_reattach_runtime.v1';delete r.action_consents;}]){
  const bad=structuredClone(request);mutate(bad);await assert.rejects(f.runtime.request(bad));
 }
 assert.equal(f.calls,before);assert.equal((await f.store.withLock({key:'email.runtime.session.'+request.session_id},tx=>tx.read())),null);
});
test('v2 committed lost ACK resolves same UUID across restart; custody-started unknown is inspect-only',async t=>{
 for(const phase of ['custody','journal']){
  const f=await fixture(t),activate=await f.prepare(await f.next()),before=f.calls;
  f.failWrite((options,input)=>phase==='custody'?options.key.startsWith('email.oauth.account.')&&input.value.setup_generation===2:options.key.startsWith('email.runtime.reattach.')&&input.value.state==='connected');
  await assert.rejects(f.runtime.request(activate));await f.restart();const result=await f.runtime.request({...activate,operation:'status'});
  assert.equal(result.state,phase==='custody'?'indeterminate':'connected');assert.equal((await f.runtime.request(activate)).state,'indeterminate');
  await assert.rejects(f.runtime.request({...activate,operation:'prepare',session_id:randomUUID(),review:undefined}));assert.equal(f.calls,before);
 }
});
test('v2 terminal unknown Send remains inspect-only and unchanged across reviewed reattachment and restart',async t=>{
 const f=await fixture(t),scope={org_id:f.scope.org_id,owner_user_id:f.scope.owner_user_id,account_id:f.account.account_ref},id=randomUUID();
 const draft=await f.data.drafts.create(scope,id,empty,{request_id:randomUUID(),user_id:scope.owner_user_id,check:async()=>{}}),run=randomUUID();
 await f.data.drafts.reserveSend(scope,id,1,draft.content_digest,run,async()=>{});await f.data.drafts.recordSendOutcome(scope,id,run,'unknown');
 const before=await f.data.drafts.read(scope,id,async()=>{}),request=await f.next(),calls=f.calls;
 const activate=await f.prepare(request),result=await f.activate(activate);assert.equal(result.state,'connected');
 assert.deepEqual(await f.data.drafts.read(scope,id,async()=>{}),before);assert.equal(f.calls,calls);
 await f.restart();assert.deepEqual(await f.runtime.request({...activate,operation:'status'}),result);
 assert.deepEqual(await f.data.drafts.read(scope,id,async()=>{}),before);assert.equal(f.calls,calls);
});

test('v2 active original Send denies reattachment without altering its effect',async t=>{
 const f=await fixture(t),scope={org_id:f.scope.org_id,owner_user_id:f.scope.owner_user_id,account_id:f.account.account_ref},id=randomUUID();
 const draft=await f.data.drafts.create(scope,id,empty,{request_id:randomUUID(),user_id:scope.owner_user_id,check:async()=>{}}),run=randomUUID();
 await f.data.drafts.reserveSend(scope,id,1,draft.content_digest,run,async()=>{});
 const before=await f.data.drafts.read(scope,id,async()=>{}),request=await f.next(),calls=f.calls;
 await assert.rejects(f.runtime.request(request),{code:'EMAIL_RUNTIME_REATTACH_EFFECT_PENDING'});
 assert.deepEqual(await f.data.drafts.read(scope,id,async()=>{}),before);assert.equal(f.calls,calls);
});
test('v2 status after review/action expiry reads original pins; revocation still denies',async t=>{
 const f=await fixture(t),request=await f.next();request.review_expires_at=new Date(Date.now()+2100).toISOString();request.expires_at=new Date(Date.now()+1500).toISOString();request.action_consents[0].expires_at=new Date(Date.now()+2000).toISOString();
 const activate=await f.prepare(request),result=await f.activate(activate);await new Promise(resolve=>setTimeout(resolve,2200));await f.restart();
 const status={...activate,operation:'status',expires_at:new Date(Date.now()+29000).toISOString()};assert.deepEqual(await f.runtime.request(status),result);
 const bad=structuredClone(status);bad.action_consents.pop();await assert.rejects(f.runtime.request(bad));f.deny();await assert.rejects(f.runtime.request(status));
});

test('v2 read-only retained account preserves null credential anchor and resolves its lineage after restart',async t=>{
 const f=await fixture(t,{readOnly:true}),request=await f.next(),activate=await f.prepare(request),before=f.calls,result=await f.activate(activate);
 assert.equal(result.state,'connected');const session=(await f.store.withLock({key:'email.runtime.session.'+request.session_id},tx=>tx.read())).value;
 assert.equal(session.binding.action_binding_id,null);assert.deepEqual(session.action_consents,[]);await f.restart();assert.deepEqual(await f.runtime.request({...activate,operation:'status'}),result);assert.equal(f.calls,before);
});

 test('automatic upgrade accepts a Host-authorized successor without an operator registration edit',async t=>{
 const f=await fixture(t,{automatic:true}),before=f.calls,request=await f.next(false,false);
 const activated=await f.activate(await f.prepare(request));
 assert.equal(activated.state,'connected');assert.equal(f.calls,before);
 await f.restart();const draft=await f.data.request(f.dataRequest('record_create',{store_key:'drafts',record_id:randomUUID(),value:empty}));assert.equal(draft.outcome,'completed');
 const second=await f.next(false,false);assert.equal((await f.activate(await f.prepare(second))).state,'connected');
 await f.restart();assert.equal((await f.data.request(f.dataRequest('record_read',{store_key:'drafts',record_id:draft.record.record_id}))).record.record_id,draft.record.record_id);
 });

test('automatic enrollment restores a connected journal after a crash before activation ACK',async t=>{
 const f=await fixture(t,{automatic:true}),request=await f.next(false,false),activate=await f.prepare(request),before=f.calls;
 assert.equal(f.enrollment.current().length,1,'prepare does not enroll the target');
 f.failWrite((options,input)=>options.key==='email.runtime.reattach.'+request.session_id&&input.value.state==='connected');
 await assert.rejects(f.activate(activate));await f.restart();
 assert.equal(f.enrollment.current().length,1);assert.equal(f.enrollment.current()[0].runtime_registration_id,request.scope.runtime_registration_id);
 assert.equal((await f.activate({...activate,operation:'status'})).state,'connected');assert.equal(f.calls,before);
});
test('automatic enrollment rejects changed principals and Host denial without enrolling or provider work',async t=>{
 const f=await fixture(t,{automatic:true}),request=await f.next(false,false),before=f.calls;
 for(const field of ['operator_user_id','owner_user_id','installation_id','profile_digest','target_key']){
  const bad=structuredClone(request);bad.scope[field]=field==='profile_digest'?'sha256:'+'9'.repeat(64):field==='target_key'?'other':randomUUID();
  await assert.rejects(f.prepare(bad));
 }
 f.deny();await assert.rejects(f.prepare(request));await f.restart();
 assert.equal(f.enrollment.all().length,1);assert.equal(f.calls,before);
});

test('three-purpose reattachment keeps fresh checks across slow prepare and activate without provider effects',async t=>{
 const f=await fixture(t,{automatic:true}),before=f.calls,request={...await f.next(false,false),review_expires_at:new Date(f.now()+300000).toISOString(),expires_at:new Date(f.now()+110000).toISOString()};
 f.latency(3000);
 const activation=await f.prepare(request);
 const result=await f.activate({...activation,expires_at:new Date(f.now()+110000).toISOString()});
 assert.equal(result.state,'connected');assert.equal(f.calls,before);
 const session=(await f.store.withLock({key:'email.runtime.session.'+request.session_id},tx=>tx.read())).value;
 const journal=(await f.store.withLock({key:'email.runtime.reattach.'+request.session_id},tx=>tx.read())).value;
 assert.equal(session.state,'connected');assert.equal(session.action_consents.length,3);
 assert.equal(journal.state,'connected');assert.equal(journal.receipt_digest,result.receipt_digest);
 assert.ok(f.enrollment.current().some(r=>r.runtime_registration_id===request.scope.runtime_registration_id));
});

test('slow reattachment still stops at the original finite account and purpose deadline',async t=>{
 const f=await fixture(t,{automatic:true}),sourceId=f.id,before=f.calls,expires_at=new Date(f.now()+35000).toISOString();
 const request={...await f.next(false,false),review_expires_at:new Date(f.now()+300000).toISOString(),expires_at};
 request.scope.consent_expires_at=expires_at;request.action_consents=request.action_consents.map(c=>({...c,expires_at}));
 f.latency(5000);await assert.rejects(f.runtime.request(request));
 assert.equal(f.calls,before);
 const source=(await f.store.withLock({key:'email.runtime.session.'+sourceId},tx=>tx.read())).value;
 assert.equal(source.state,'connected');assert.equal(await f.store.withLock({key:'email.runtime.session.'+request.session_id},tx=>tx.read()),null);
});


test('v2 absent expired review status survives a foreign expired prepared review without changing custody or its reservation',async t=>{
 const f=await fixture(t,{automatic:true}),prior=await f.next(false,false),before=f.calls;
 await f.prepare(prior);
 const absent={...prior,session_id:randomUUID(),review_expires_at:new Date(f.now()+300000).toISOString()};
 const reservationKey='email.runtime.target.'+digest(prior.scope);
 const reservation=await f.store.withLock({key:reservationKey},tx=>tx.read());
 const source=await f.store.withLock({key:'email.runtime.session.'+prior.source.session_id},tx=>tx.read());
 const custody=await f.data.custody.withAccount(source.value.binding,tx=>tx.read());
 f.advance(301000);
 const request={...absent,operation:'status',review:null,expires_at:new Date(f.now()+29000).toISOString()};
 const result=await f.runtime.request(request);
 assert.deepEqual(result,{schema_version:REATTACH_VERSION,session_id:absent.session_id,state:'not_connected',reason:'prepare_not_started'});
 assert.deepEqual(await f.store.withLock({key:reservationKey},tx=>tx.read()),reservation);
 assert.deepEqual(await f.store.withLock({key:'email.runtime.session.'+prior.source.session_id},tx=>tx.read()),source);
 assert.deepEqual(await f.data.custody.withAccount(source.value.binding,tx=>tx.read()),custody);
 assert.equal(await f.store.withLock({key:'email.runtime.session.'+absent.session_id},tx=>tx.read()),null);
 const journal=(await f.store.withLock({key:'email.runtime.reattach.'+absent.session_id},tx=>tx.read())).value;
 assert.equal(journal.state,'closed_unprepared');
 await f.restart();assert.deepEqual(await f.runtime.request(request),result);
 await assert.rejects(f.runtime.request(absent),'the expired original prepare cannot replay after the durable status tombstone');
 f.deny();await assert.rejects(f.runtime.request(request),'even a durable negative status rechecks current Host authority');
 assert.equal(f.calls,before);
});


test('v2 absent review status never uses own, live, activated, ended, foreign-scope or other-kind reservations as negative proof',async t=>{
 for(const kind of ['own','live','activating','connected','ended','foreign-scope','other-kind'])await t.test(kind,async t=>{
  const f=await fixture(t,{automatic:true}),prior=await f.next(false,false);await f.prepare(prior);
  const absent={...prior,session_id:randomUUID(),operation:'status',review:null};
  f.advance(301000);absent.expires_at=new Date(f.now()+29000).toISOString();
  const key='email.runtime.target.'+digest(prior.scope);
  await f.store.withLock({key},async tx=>{const row=await tx.read(),value=structuredClone(row.value);
   if(kind==='own')value.session_id=absent.session_id;
   if(kind==='live')value.review_expires_at=f.now()+60000;
   if(['activating','connected','ended'].includes(kind))value.state=kind;
   if(kind==='foreign-scope')value.scope.target_key='foreign';
   if(kind==='other-kind')value.kind='upgrade';
   assert.equal(await tx.compareAndSwap({expected_revision:row.revision,value}),true);
  });
  const before=await f.store.withLock({key},tx=>tx.read()),calls=f.calls;
  await assert.rejects(f.runtime.request(absent),{code:'EMAIL_RUNTIME_REATTACH_DENIED'});
  assert.deepEqual(await f.store.withLock({key},tx=>tx.read()),before);
  assert.equal(await f.store.withLock({key:'email.runtime.reattach.'+absent.session_id},tx=>tx.read()),null);
  assert.equal(f.calls,calls);
 });
});
