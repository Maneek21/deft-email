import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createDurableStore} from './durable-store.mjs';
import {createConnectionRuntime} from './connection-runtime.mjs';
import {createDataRuntime} from './data-runtime.mjs';
import {createMailboxStore} from './mailbox-store.mjs';
import {createEncryptedEmailCustody} from './vendor/providers/custody-encrypted.mjs';
import {createNativeEmailBridge} from './vendor/providers/native-mailbox.mjs';
import {createNativeIdentityScopeResolver} from './native-adoption-identity.mjs';
import {validateEmailAccount} from './vendor/account-registry.mjs';
import {grantedOAuthCapabilities} from './vendor/providers/oauth-provider.mjs';
import {makeScope,registrationFor,client,providerFixture,beginFor,nextFor,dataFixtureMessage} from './test-support.mjs';
import {digest} from './contract.mjs';

const accountFromRecord=(binding,record,{allowNativeReauth=false}={})=>{if(!record?.secret?.identity||record.health!=='connected'&&!(allowNativeReauth&&record.health==='reauth_required'))return null;const identity=record.secret.identity;return validateEmailAccount({account_id:binding.account_id,provider:binding.provider,display_label:identity.display_label,primary_address:identity.primary_address,verified_sender_identities:[...identity.verified_sender_identities],capabilities:grantedOAuthCapabilities(binding,record.secret.scopes),connection_target:binding.connection_target,resource_binding_id:binding.resource_binding_id,action_binding_id:binding.action_binding_id,authority_epoch:binding.authority_epoch,health:record.health});};

async function fixture(t,{authorityLatency=0,providerLatency=0,pageSize=25}={}){
  const parent=await mkdtemp(join(tmpdir(),'email-sync-latency-')),root=join(parent,'private'),encryption_key=Buffer.alloc(32,53),key_id='sync-latency-fixture',scope=makeScope(),registration=registrationFor(scope);
  const message=dataFixtureMessage('fixture@example.test');
  let providerCalls=0,pageCalls=0,authorityCalls=0;
  const provider=async(url,options)=>{
    providerCalls++;const parsed=new URL(url);
    if(parsed.pathname.endsWith('/profile'))return Response.json({emailAddress:'fixture@example.test',historyId:'1'});
    if(parsed.pathname.endsWith('/history'))return Response.json({history:[],historyId:'1'});
    if(parsed.pathname.endsWith('/messages')){
      pageCalls++;if(providerLatency)await delay(providerLatency);
      return Response.json({messages:Array.from({length:pageSize},(_,index)=>({id:'synthetic-sync-message-'+index})),resultSizeEstimate:pageSize});
    }
    const match=parsed.pathname.match(/\/messages\/synthetic-sync-message-(\d+)$/u);
    if(match){pageCalls++;if(providerLatency)await delay(providerLatency);const metadata=structuredClone(message.metadata);metadata.id='synthetic-sync-message-'+match[1];metadata.threadId='synthetic-sync-thread-'+match[1];return Response.json(metadata);}
    return providerFixture(url,options);
  };
  const store=await createDurableStore({root,encryption_key,key_id,allow_windows_fixture:process.platform==='win32'});
  t.after(async()=>{await store.close();await rm(parent,{recursive:true,force:true});});
  const connectionRuntime=createConnectionRuntime({registration,client,store,encryption_key,key_id,assertCurrent:async input=>{await delay(authorityLatency);authorityCalls++;return {...input,allowed:true};},fetch:provider});
  const begin=beginFor(scope),begun=await connectionRuntime.request(begin),connected=await connectionRuntime.request(nextFor(begin,begun,'callback'));
  const events=[];
  const data=createDataRuntime({registrations:[registration],client,store,encryption_key,key_id,onDiagnostic:event=>events.push(event),assertCurrent:async input=>{authorityCalls++;await delay(authorityLatency);return {...input,allowed:true};},fetch:provider});
  const request=(operation,input)=>({schema_version:'deft.app_data_runtime.v1',request_id:randomUUID(),scope,connection:{session_id:begin.session_id,session_revision:5,runtime_session_ref:begun.runtime_session_ref,account_ref:connected.account.account_ref},authority:{consent_id:randomUUID(),consent_digest:'sha256:'+'d'.repeat(64),data_policy_digest:'sha256:'+'e'.repeat(64)},operation,expires_at:new Date(Date.now()+29000).toISOString(),input});
  return {parent,root,store,encryption_key,key_id,scope,registration,client,begin,connected,data,request,events,provider,get providerCalls(){return providerCalls;},get pageCalls(){return pageCalls;},get authorityCalls(){return authorityCalls;}};
}

test('one bounded page uses at most 11 provider calls and one metadata wave',async t=>{
  const f=await fixture(t,{authorityLatency:10,providerLatency:5});
  const authorityBefore=f.authorityCalls,pageBefore=f.pageCalls;
  const result=await f.data.request(f.request('resource_refresh',{store_key:'drafts',resource_key:'inbox'}));
  console.log(JSON.stringify({event:'sync_page_provider_measurement',bounded:true,provider_calls:f.pageCalls-pageBefore,authority_callbacks:f.authorityCalls-authorityBefore,rows:result.items?.length}));
  assert.equal(f.pageCalls-pageBefore,11,'1 list + one ten-message metadata wave');
  assert.ok(f.authorityCalls-authorityBefore<=4,'one admitted page stays within four Host authority callbacks');
  assert.equal(result.outcome,'completed');
  assert.equal(result.items.length,10);
  assert.ok(result.next_cursor===null||/^[a-f0-9-]{36}$/u.test(result.next_cursor),'the page cursor is a mailbox record cursor');
  assert.equal(result.freshness.provider_observed,true);
});

test('the unbounded hydration configuration is measurably worse',async t=>{
  const f=await fixture(t,{pageSize:25}),session=(await f.store.withLock({key:'email.runtime.session.'+f.begin.session_id},tx=>tx.read())).value;
  let checkLocal=0,fetchCurrent=0;
  const check=()=>{checkLocal++;};
  const scope={org_id:f.scope.org_id,owner_user_id:f.scope.owner_user_id,account_id:f.connected.account.account_ref};
  const mailbox=createMailboxStore({store:f.store}),identityScopeFor=createNativeIdentityScopeResolver({store:f.store,scope,session,binding:session.binding,check});
  const custody=createEncryptedEmailCustody({store:f.store,encryption_key:f.encryption_key,key_id:f.key_id});
  const bridge=createNativeEmailBridge({store:f.store,identityScopeFor,selected:session.binding,clients:{gmail:f.client},custody,accountFromRecord,now:Date.now,nativePageHydrationLimit:25,fetch:async(url,options={})=>{fetchCurrent++;check();return f.provider(url,options);},oauthFetch:async(url,options={})=>{check();return f.provider(url,options);}});
  const before=f.pageCalls,page=await bridge.nativeEmailPage({cursor:null,limit:25},{org_id:scope.org_id,owner_user_id:scope.owner_user_id,account_id:scope.account_id,installation_id:f.scope.installation_id,resource_binding_id:f.scope.resource_binding_id,authority_version:digest([scope]),expires_at:Date.now()+29000,recheck:check,signal:new AbortController().signal,owner_capabilities:['read'],provider_state:await mailbox.providerState(scope,check)});
  console.log(JSON.stringify({event:'sync_page_provider_measurement',bounded:false,provider_calls:f.pageCalls-before,authority_callbacks:fetchCurrent,rows:page.items.length}));
  assert.equal(f.pageCalls-before,26,'1 list + 25 metadata calls in three waves');
  assert.ok(fetchCurrent>=5,'the unbounded configuration repeats authority callbacks per wave');
  assert.equal(page.items.length,25);
});

test('a 900 ms authority budget still lands one refresh under ten seconds',async t=>{
  const f=await fixture(t,{authorityLatency:900,providerLatency:1});
  const started=performance.now();
  const result=await f.data.request(f.request('resource_refresh',{store_key:'drafts',resource_key:'inbox'}));
  const oneRequest=Math.round(performance.now()-started);
  const twoStarted=performance.now();
  await f.data.request(f.request('resource_refresh',{store_key:'drafts',resource_key:'inbox'}));
  await f.data.request(f.request('resource_list',{store_key:'drafts',resource_key:'inbox',cursor:null,limit:25}));
  const twoRequests=Math.round(performance.now()-twoStarted);
  console.log(JSON.stringify({event:'sync_page_elapsed_measurement',authority_ms:900,one_request_ms:oneRequest,two_request_ms:twoRequests,rows:result.items?.length}));
  assert.equal(result.outcome,'completed');
  assert.ok(oneRequest<10000,`one-request refresh took ${oneRequest}ms`);
});

test('the committed refresh page is exactly the page a following list returns',async t=>{
  const f=await fixture(t,{authorityLatency:5,providerLatency:1});
  const refreshed=await f.data.request(f.request('resource_refresh',{store_key:'drafts',resource_key:'inbox'}));
  const listed=await f.data.request(f.request('resource_list',{store_key:'drafts',resource_key:'inbox',cursor:null,limit:25}));
  assert.deepEqual(refreshed.items,listed.items);
  assert.equal(refreshed.next_cursor,listed.next_cursor);
  assert.equal(refreshed.freshness.provider_observed,true);
  assert.equal(listed.freshness.provider_observed,false);
});
