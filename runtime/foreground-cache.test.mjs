import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createDurableStore} from './durable-store.mjs';
import {createConnectionRuntime} from './connection-runtime.mjs';
import {createDataRuntime} from './data-runtime.mjs';
import {createForegroundCache} from './foreground-cache.mjs';
import {createMailboxStore} from './mailbox-store.mjs';
import {createEncryptedEmailCustody} from './vendor/providers/custody-encrypted.mjs';
import {digest} from './contract.mjs';
import {makeScope,registrationFor,client,twoAccountProviderFixture,authority,beginFor,nextFor} from './test-support.mjs';

async function fixture(t,{authorityLatency=0,now=Date.now}={}){
 const parent=await mkdtemp(join(tmpdir(),'email-foreground-cache-')),root=join(parent,'private'),encryption_key=Buffer.alloc(32,53),scope=makeScope(),registration=registrationFor(scope),provider=twoAccountProviderFixture();
 const store=await createDurableStore({root,encryption_key,key_id:'cache-fixture',allow_windows_fixture:process.platform==='win32'});let providerCalls=0,authorityCalls=0,allowed=true,onAuthority=null,onProvider=null;
 const fetch=async(...args)=>{providerCalls++;if(onProvider){const response=await onProvider(...args);if(response instanceof Response)return response;}return provider(...args);};
 const connections=createConnectionRuntime({registration,client,store,encryption_key,key_id:'cache-fixture',assertCurrent:authority,fetch}),begin=beginFor(scope),begun=await connections.request(begin),callback=nextFor(begin,begun,'callback');callback.callback.code='fixture-first-account';const connected=await connections.request(callback);
 const consent={consent_id:randomUUID(),consent_digest:'sha256:'+'d'.repeat(64),data_policy_digest:'sha256:'+'e'.repeat(64)},connection={session_id:begin.session_id,session_revision:5,runtime_session_ref:begun.runtime_session_ref,account_ref:connected.account.account_ref};
 const dependencies={registrations:[registration],client,store,encryption_key,key_id:'cache-fixture',now,assertCurrent:async input=>{authorityCalls++;await delay(authorityLatency);if(onAuthority)await onAuthority(input);if(!allowed)throw Error('fixture revoked');return {...input,allowed:true};},fetch};let runtime=createDataRuntime(dependencies);
 const request=(operation,input)=>({schema_version:'deft.app_data_runtime.v1',request_id:randomUUID(),scope,connection,authority:consent,operation,expires_at:new Date(now()+29000).toISOString(),input});
 t.after(async()=>{await store.close();await rm(parent,{recursive:true,force:true});});
 const localScope={org_id:scope.org_id,owner_user_id:scope.owner_user_id,account_id:connection.account_ref},mailbox=createMailboxStore({store,now}),binding=(await store.withLock({key:'email.runtime.session.'+begin.session_id},tx=>tx.read())).value.binding,custody=createEncryptedEmailCustody({store,encryption_key,key_id:'cache-fixture',now});
 return {scope,localScope,mailbox,custody,binding,connection,request,store,runtime,run:(...args)=>runtime.request(...args),counts:()=>({provider:providerCalls,authority:authorityCalls}),deny:()=>{allowed=false;},allow:()=>{allowed=true;},onAuthority:fn=>{onAuthority=fn;},onProvider:fn=>{onProvider=fn;},restart:()=>{runtime=createDataRuntime(dependencies);}};
}
const listInput={store_key:'drafts',resource_key:'inbox',cursor:null,limit:25,query:'in:inbox'};
test('repeated foreground query and presentation reuse exact data under fresh current authority',async t=>{
 const f=await fixture(t,{authorityLatency:20});
 const measure=async task=>{const before=f.counts(),start=performance.now(),result=await task(),after=f.counts();return {result,metrics:{provider:after.provider-before.provider,authority:after.authority-before.authority,elapsed_ms:Math.round(performance.now()-start)}};};
 const firstList=await measure(()=>f.run(f.request('resource_list',listInput))),resource=firstList.result.items[0],source={store_key:'drafts',resource_key:'inbox',record_id:resource.record_id,content_digest:resource.content_digest};
 const firstView=await measure(()=>f.run(f.request('resource_read_presentation',source))),secondList=await measure(()=>f.run(f.request('resource_list',listInput))),secondView=await measure(()=>f.run(f.request('resource_read_presentation',source)));
 console.log(JSON.stringify({event:'synthetic_foreground_cache_measurement',authority_latency_ms:20,first_list:firstList.metrics,first_presentation:firstView.metrics,repeated_list:secondList.metrics,repeated_presentation:secondView.metrics}));
 assert.equal(secondList.metrics.provider,0);assert.equal(secondView.metrics.provider,0);assert.ok(secondList.metrics.authority>=2);assert.ok(secondView.metrics.authority>=2);
 assert.deepEqual(secondList.result.items,firstList.result.items);assert.equal(secondList.result.freshness.observed_at,firstList.result.freshness.observed_at);assert.equal(secondList.result.freshness.provider_observed,false);assert.deepEqual(secondView.result.presentation,firstView.result.presentation);
 f.deny();await assert.rejects(f.run(f.request('resource_read_presentation',source)));await assert.rejects(f.run(f.request('resource_list',listInput)));
});


test('memo bounds TTL, reverse clock, size, cloning, full pins and LRU without renewing authority',()=>{
 let time=1000;const memo=createForegroundCache({now:()=>time,maxEntries:2,maxBytes:100,ttl_ms:60}),scope={org_id:'o',owner_user_id:'u',account_id:'a'},stamp={content_generation:1},value={items:[1]},request={scope,connection:{account_ref:'a'},authority:{consent_id:'one'},operation:'resource_list',input:{query:'in:inbox',limit:25,cursor:null}},pin={client_fingerprint:'c',custody_generation:1};
 const key=memo.key(request,pin);memo.set(key,scope,stamp,value);value.items[0]=2;const hit=memo.get(key,stamp);assert.deepEqual(hit.items,[1]);hit.items[0]=3;assert.deepEqual(memo.get(key,stamp).items,[1]);
 for(const changed of [{...request,input:{...request.input,limit:1}},{...request,input:{...request.input,cursor:'cursor'}},{...request,authority:{consent_id:'two'}},{...request,scope:{...scope,owner_user_id:'other'}},{...request,connection:{account_ref:'other'}}])assert.notEqual(memo.key(changed,pin),key);
 assert.notEqual(memo.key(request,{...pin,custody_generation:2}),key);assert.notEqual(memo.key(request,{...pin,client_fingerprint:'d'}),key);
 time=1059;assert.ok(memo.get(key,stamp));time=1060;assert.equal(memo.get(key,stamp),null);
 memo.set('a',scope,stamp,{});memo.set('b',scope,stamp,{});memo.get('a',stamp);memo.set('c',scope,stamp,{});assert.equal(memo.get('b',stamp),null);assert.ok(memo.get('a',stamp));
 memo.set('oversize',scope,stamp,{text:'x'.repeat(101)});assert.equal(memo.get('oversize',stamp),null);time=1050;assert.equal(memo.get('a',stamp),null);
 assert.throws(()=>createForegroundCache({ttl_ms:60001}));
});

test('fresh authority fences each provider request and final disclosure, failed observations never seed memo',async t=>{
 const f=await fixture(t);let calls=0;f.onProvider(()=>{if(++calls===1)f.deny();});const before=f.counts();await assert.rejects(f.run(f.request('resource_list',listInput)));assert.equal(f.counts().provider-before.provider,1);
 f.allow();f.onProvider(null);const first=await f.run(f.request('resource_list',listInput));const source={store_key:'drafts',resource_key:'inbox',record_id:first.items[0].record_id,content_digest:first.items[0].content_digest};
 let checks=0;f.onAuthority(()=>{if(++checks===3)f.deny();});await assert.rejects(f.run(f.request('resource_read_presentation',source)));f.allow();f.onAuthority(null);const beforeRetry=f.counts();await f.run(f.request('resource_read_presentation',source));assert.equal(f.counts().provider-beforeRetry.provider,1);
 checks=0;f.onAuthority(()=>{if(++checks===2)f.deny();});const beforeHit=f.counts();await assert.rejects(f.run(f.request('resource_read_presentation',source)));assert.equal(f.counts().provider-beforeHit.provider,0);
});

test('explicit refresh invalidates query and presentation; restart and TTL are provider misses',async t=>{
 let time=Date.now();const f=await fixture(t,{now:()=>time});const first=await f.run(f.request('resource_list',listInput)),source={store_key:'drafts',resource_key:'inbox',record_id:first.items[0].record_id,content_digest:first.items[0].content_digest};await f.run(f.request('resource_read_presentation',source));
 await f.run(f.request('resource_refresh',{store_key:'drafts',resource_key:'inbox'}));let before=f.counts();await f.run(f.request('resource_list',listInput));assert.equal(f.counts().provider-before.provider,2);before=f.counts();await f.run(f.request('resource_read_presentation',source));assert.equal(f.counts().provider-before.provider,1);
 f.restart();before=f.counts();await f.run(f.request('resource_list',listInput));assert.equal(f.counts().provider-before.provider,2);time+=60001;before=f.counts();await f.run(f.request('resource_list',listInput));assert.equal(f.counts().provider-before.provider,2);
});

test('durable membership and tombstone commits invalidate memo, revoked or drifted custody denies cached disclosure',async t=>{
 const f=await fixture(t);const first=await f.run(f.request('resource_list',listInput)),row=await f.mailbox.get(f.localScope,first.items[0].record_id,()=>{}),item={account_id:f.localScope.account_id,logical_message_id:row.logical_message_id,revision:row.provider_revision,data:row.data,folders:['sent'],flags:row.flags,received_at:row.received_at,provider_source:row.provider_source};
 await f.mailbox.commit(f.localScope,{items:[item],tombstones:[],state_updates:[],observed_at:new Date().toISOString()},()=>{});let before=f.counts();await f.run(f.request('resource_list',listInput));assert.equal(f.counts().provider-before.provider,2);
 await f.mailbox.commit(f.localScope,{items:[],tombstones:[row.logical_message_id],state_updates:[],observed_at:new Date().toISOString()},()=>{});before=f.counts();await f.run(f.request('resource_list',listInput));assert.equal(f.counts().provider-before.provider,2);
 let checks=0;f.onAuthority(async()=>{if(++checks===3)await f.custody.withAccount(f.binding,tx=>tx.advanceSetup());});before=f.counts();await assert.rejects(f.run(f.request('resource_list',listInput)),error=>error.code==='EMAIL_DATA_CONNECTION_DENIED');assert.equal(f.counts().provider-before.provider,0);
 f.onAuthority(null);await f.custody.withAccount(f.binding,tx=>{const row=tx.read();return tx.write({health:'revoked',secret:null});});await assert.rejects(f.run(f.request('resource_list',listInput)));
});

test('local source tampering and concurrent durable change are denied before memo disclosure',async t=>{
 const f=await fixture(t),first=await f.run(f.request('resource_list',listInput)),id=first.items[0].record_id,key='email.data.mailbox.'+digest([f.localScope.org_id,f.localScope.owner_user_id,f.localScope.account_id,id]);
 await f.store.withLock({key},async tx=>{const row=await tx.read();await tx.compareAndSwap({expected_revision:row.revision,value:{...row.value,provider_source:{...row.value.provider_source,account_id:randomUUID()}}});});const before=f.counts();await assert.rejects(f.run(f.request('resource_list',listInput)));assert.equal(f.counts().provider-before.provider,0);
});

test('incoming cancellation and narrowed current deadline stop the injected provider boundary',async t=>{
 const f=await fixture(t);const controller=new AbortController();f.onProvider(()=>controller.abort());const before=f.counts();await assert.rejects(f.run(f.request('resource_list',listInput),controller.signal));assert.equal(f.counts().provider-before.provider,1);
 f.onProvider(null);let time=Date.now();const g=await fixture(t,{now:()=>time});g.onAuthority(input=>{time=Date.parse(input.expires_at);});const beforeDeadline=g.counts();await assert.rejects(g.run(g.request('resource_list',listInput)));assert.equal(g.counts().provider-beforeDeadline.provider,0);
});


test('concurrent durable generation advancement during final authority denies stale memo disclosure',async t=>{
 const f=await fixture(t);await f.run(f.request('resource_list',listInput));let checks=0;f.onAuthority(async()=>{if(++checks===3)await f.mailbox.commit(f.localScope,{items:[],tombstones:[],state_updates:[{state_key:'concurrent',generation:'new',value:{cursor:'new'}}],observed_at:new Date().toISOString(),complete:false,next_cursor:null},()=>{});});const before=f.counts();await assert.rejects(f.run(f.request('resource_list',listInput)),error=>error.code==='EMAIL_DATA_SOURCE_CHANGED');assert.equal(f.counts().provider-before.provider,0);
 f.onAuthority(null);const retry=f.counts();const result=await f.run(f.request('resource_list',listInput));assert.equal(f.counts().provider-retry.provider,2);assert.equal(result.freshness.complete,false);
});

test('a failed explicit refresh invalidates previously successful memos before provider I/O',async t=>{
 const f=await fixture(t);await f.run(f.request('resource_list',listInput));f.onProvider(()=>{throw Error('fixture provider unavailable');});await assert.rejects(f.run(f.request('resource_refresh',{store_key:'drafts',resource_key:'inbox'})));f.onProvider(null);const before=f.counts();await f.run(f.request('resource_list',listInput));assert.equal(f.counts().provider-before.provider,2);
});

test('exact consent and query limit changes cannot reuse another observed page',async t=>{
 const f=await fixture(t),first=await f.run(f.request('resource_list',listInput));let before=f.counts();const changed=f.request('resource_list',listInput);changed.authority.consent_id=randomUUID();await f.run(changed);assert.equal(f.counts().provider-before.provider,2);
 before=f.counts();const bounded=await f.run(f.request('resource_list',{...listInput,limit:1}));assert.equal(f.counts().provider-before.provider,2);assert.equal(bounded.items.length,1);assert.equal(bounded.freshness.complete,first.freshness.complete);assert.equal(bounded.search.query_complete,true);
 await f.custody.withAccount(f.binding,tx=>tx.advanceSetup());before=f.counts();await f.run(f.request('resource_list',listInput));assert.equal(f.counts().provider-before.provider,2);
});


test('token refresh uses the same injected current authority and abort/redirect guards as provider reads',async t=>{
 const f=await fixture(t);await f.custody.withAccount(f.binding,tx=>{const row=tx.read();return tx.write({health:row.health,secret:{...row.secret,expires_at:Date.now()-1}});});let refresh=0;
 f.onProvider((url,options)=>{assert.equal(options.redirect,'error');assert.ok(options.signal instanceof AbortSignal);if(url==='https://oauth2.googleapis.com/token'){refresh++;f.deny();return Response.json({access_token:'fixture-only-access-fixture-first-account',token_type:'Bearer',expires_in:3600,scope:'openid email https://www.googleapis.com/auth/gmail.readonly'});}});
 const before=f.counts();await assert.rejects(f.run(f.request('resource_list',listInput)));assert.equal(refresh,1);assert.equal(f.counts().provider-before.provider,1);
});


test('partial query memo preserves exact cursor, original observation and incomplete coverage',async t=>{
 const f=await fixture(t);f.onProvider(url=>{const parsed=new URL(url);if(parsed.pathname.endsWith('/messages'))return Response.json({messages:[{id:'synthetic-first-message'}],nextPageToken:'fixture-next-page',resultSizeEstimate:2});});const first=await f.run(f.request('resource_list',{...listInput,limit:1})),before=f.counts(),second=await f.run(f.request('resource_list',{...listInput,limit:1}));assert.equal(f.counts().provider-before.provider,0);assert.ok(first.next_cursor);assert.equal(first.search.query_complete,false);assert.equal(first.freshness.complete,false);assert.equal(second.next_cursor,first.next_cursor);assert.equal(second.search.query_complete,false);assert.equal(second.freshness.complete,false);assert.equal(second.freshness.observed_at,first.freshness.observed_at);
});

test('two foreground requests retain the exact session lock and second hit uses fresh authority',async t=>{
 const f=await fixture(t);let entered,release;const ready=new Promise(r=>entered=r),pause=new Promise(r=>release=r);let firstProvider=true;f.onProvider(async()=>{if(firstProvider){firstProvider=false;entered();await pause;}});const first=f.run(f.request('resource_list',listInput));await ready;const before=f.counts();const second=f.run(f.request('resource_list',listInput));try{await delay(30);assert.equal(f.counts().provider,before.provider);assert.ok(f.counts().authority>=before.authority);}finally{release();}const [one,two]=await Promise.all([first,second]);assert.deepEqual(two.items,one.items);assert.equal(two.freshness.provider_observed,false);assert.equal(f.counts().provider-before.provider,1);assert.ok(f.counts().authority-before.authority>=2);
});
