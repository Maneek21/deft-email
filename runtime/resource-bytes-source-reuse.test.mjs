import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createDurableStore} from './durable-store.mjs';
import {createConnectionRuntime} from './connection-runtime.mjs';
import {createDataRuntime} from './data-runtime.mjs';
import {makeScope,registrationFor,client,providerFixture,authority,beginFor,nextFor,dataFixtureMessage} from './test-support.mjs';

async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),'email-source-reuse-')),encryption_key=Buffer.alloc(32,41),scope=makeScope(),registration=registrationFor(scope),message=dataFixtureMessage('fixture@example.test');
 const store=await createDurableStore({root:join(directory,'private'),encryption_key,key_id:'source-reuse',allow_windows_fixture:process.platform==='win32'});
 let rawReads=0,currentMime=message.mime,holdProfile=false,entered,release,holdRaw=false,rawEntered,rawRelease;
 const rawStarted=new Promise(resolve=>{rawEntered=resolve;}),rawReleased=new Promise(resolve=>{rawRelease=resolve;});
 const backgroundEntered=new Promise(resolve=>{entered=resolve;}),backgroundReleased=new Promise(resolve=>{release=resolve;});
 const provider=async(url,options)=>{
  const parsed=new URL(url);
  if(parsed.pathname.endsWith('/profile')){if(holdProfile){entered();await backgroundReleased;}return Response.json({emailAddress:'fixture@example.test',historyId:'1'});}
  if(parsed.pathname.endsWith('/threads/'+message.metadata.threadId))return Response.json({id:message.metadata.threadId,messages:[message.metadata]});
  if(parsed.pathname.endsWith('/history'))return Response.json({history:[],historyId:'1'});
  if(parsed.pathname.endsWith('/messages'))return Response.json({messages:[{id:message.metadata.id}],resultSizeEstimate:1});
  if(parsed.pathname.endsWith('/messages/'+message.metadata.id)){
   if(parsed.searchParams.get('format')==='raw'){rawReads++;if(holdRaw){rawEntered();await rawReleased;}return Response.json({id:message.metadata.id,threadId:message.metadata.threadId,raw:currentMime.toString('base64url')});}
   return Response.json(message.metadata);
  }
  return providerFixture(url,options);
 };
 const connection=createConnectionRuntime({registration,client,store,encryption_key,key_id:'source-reuse',assertCurrent:authority,fetch:provider}),begin=beginFor(scope),begun=await connection.request(begin),connected=await connection.request(nextFor(begin,begun,'callback'));
 const runtime=createDataRuntime({registrations:[registration],client,store,encryption_key,key_id:'source-reuse',assertCurrent:async input=>({...input,allowed:true}),fetch:provider,onDiagnostic:()=>{}});
 const request=(operation,input)=>({schema_version:'deft.app_data_runtime.v1',request_id:randomUUID(),scope,connection:{session_id:begin.session_id,session_revision:5,runtime_session_ref:begun.runtime_session_ref,account_ref:connected.account.account_ref},authority:{consent_id:randomUUID(),consent_digest:'sha256:'+'d'.repeat(64),data_policy_digest:'sha256:'+'e'.repeat(64)},operation,expires_at:new Date(Date.now()+29000).toISOString(),input});
 t.after(async()=>{release();rawRelease();runtime.close();await store.close();await rm(directory,{recursive:true,force:true});});
 const list=await runtime.request(request('resource_list',{store_key:'drafts',resource_key:'inbox',query:'in:inbox',cursor:null,limit:10})),record=list.items[0];
 const input={store_key:'drafts',resource_key:'inbox',record_id:record.record_id,content_digest:record.content_digest};
 return {runtime,request,input,message,get rawReads(){return rawReads;},changeMime:()=>{currentMime=Buffer.concat([message.mime,Buffer.from('\r\nbody-only change')]);},holdBackground:()=>{holdProfile=true;},backgroundEntered,releaseBackground:release,holdRaw:()=>{holdRaw=true;},rawStarted,releaseRaw:rawRelease,async revokeSession(){return store.withLock({key:'email.runtime.session.'+begin.session_id},async tx=>{const row=await tx.read();assert.equal(await tx.compareAndSwap({expected_revision:row.revision,value:{...row.value,state:'revoked'}}),true);});}};
}

test('source reuse RED: presentation and repeated exact CID reads should not refetch whole MIME per image',async t=>{
 const f=await fixture(t),view=await f.runtime.request(f.request('resource_read_presentation',f.input)),cid=view.presentation.images.find(row=>row.kind==='cid');
 assert.equal(f.rawReads,1);
 for(let i=0;i<2;i++){
  const result=await f.runtime.request(f.request('resource_read_image',{...f.input,image_ref:cid.image_ref,external_images:'blocked'}));
  assert.deepEqual(Buffer.from(result.bytes),f.message.png);
 }
 assert.equal(f.rawReads,2,'Presentation plus the first image fetch MIME; subsequent images reuse exact immutable Gmail bytes');
});

test('source reuse invariant: unchanged metadata alone cannot authorize a stale MIME body',async t=>{
 const f=await fixture(t),view=await f.runtime.request(f.request('resource_read_presentation',f.input)),cid=view.presentation.images.find(row=>row.kind==='cid');
 f.changeMime();
 await assert.rejects(f.runtime.request(f.request('resource_read_image',{...f.input,image_ref:cid.image_ref,external_images:'blocked'})));
 assert.equal(f.rawReads,2,'The existing read detects body-only changes despite identical metadata');
});

test('source reuse RED: a background refresh provider wait should not monopolize the foreground metadata session',async t=>{
 const f=await fixture(t);f.holdBackground();
 const background=f.runtime.request(f.request('resource_refresh',{store_key:'drafts',resource_key:'inbox'}));
 await f.backgroundEntered;
 let completed=false;
 const foreground=f.runtime.request(f.request('resource_read_metadata',f.input)).then(result=>{completed=true;return result;});
 const timeout=new Promise(resolve=>setTimeout(resolve,3000));
 await Promise.race([foreground,timeout]);
 const completedBeforeRelease=completed;
 f.releaseBackground();await background;await foreground;
 assert.equal(completedBeforeRelease,true,'Foreground metadata is blocked by a background request holding the same session during provider I/O');
});

test('source reuse preserves not_found for a record absent from this account',async t=>{
 const f=await fixture(t);
 for(const operation of ['resource_read_metadata','resource_read_presentation']){
  const result=await f.runtime.request(f.request(operation,{...f.input,record_id:randomUUID()}));
  assert.equal(result.outcome,'not_found');
 }
 assert.equal(f.rawReads,0);
});

test('source reuse rejects session revocation during provider I/O before MIME disclosure',async t=>{
 const f=await fixture(t);f.holdRaw();
 const reading=f.runtime.request(f.request('resource_read_presentation',f.input));
 await f.rawStarted;await f.revokeSession();f.releaseRaw();
 await assert.rejects(reading,error=>error.code==='EMAIL_DATA_CONNECTION_DENIED');
});
