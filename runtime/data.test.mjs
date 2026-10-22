import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {nativeComposeImageCid,parseNativeSafeComposeHtml} from './domain/safe-compose-html.mjs';
import {createDurableStore} from './durable-store.mjs';
import {createConnectionRuntime} from './connection-runtime.mjs';
import {createDataRuntime} from './data-runtime.mjs';
import {makeScope,registrationFor,client,providerFixture,authority,beginFor,nextFor,dataFixtureMessage} from './test-support.mjs';
import {digest} from './contract.mjs';
import {encodeFileFrame,decodeFileFrame,createDataChecker} from './data-contract.mjs';
import {createServer} from 'node:http';
import {createHttpHandler,createAuthorityClient} from './http.mjs';
const sha=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const empty={mode:'compose',to:'recipient@example.test',cc:'',bcc:'',subject:'Synthetic draft',body:'Exact body\n',body_html:'',reply_record_id:'',attachments:[]};

test('actual query-only arrival is consumable by the unchanged signed Host sync page contract',async t=>{
 const message=dataFixtureMessage('fixture@example.test');
 const provider=(url,options)=>{const path=new URL(url).pathname;if(path.endsWith('/messages'))return Response.json({messages:[{id:message.metadata.id}],resultSizeEstimate:1});if(path.endsWith('/messages/'+message.metadata.id))return Response.json(message.metadata);return providerFixture(url,options);};
 const f=await fixture(t,provider),request=f.request('resource_list',{store_key:'drafts',resource_key:'inbox',cursor:null,limit:25,query:'subject:controlled'}),result=await f.run(request);
 assert.equal(result.items.length,1);
 const [{createMailboxStore},{createSyncPublication},{integrationSourceProjection},{EMAIL_METADATA_DESCRIPTOR},{parseSyncPageV2}]=await Promise.all([import('./mailbox-store.mjs'),import('./sync-publication.mjs'),import('./integration-source.mjs'),import('./vendor/metadata-resource.mjs'),import('@deft/app-kit/core')]);
 const scope={org_id:request.scope.org_id,owner_user_id:request.scope.owner_user_id,account_id:request.connection.account_ref},mailbox=createMailboxStore({store:f.store});
 const stored=await f.store.withLock({key:'email.data.sync_handoff.'+digest([scope,'slot:1'])},tx=>tx.read());assert.ok(stored,'foreground query must create a consumable publication');
 const before=await mailbox.cacheSnapshot(scope,[],async()=>{}),cursor=await mailbox.cursor(scope,async()=>{});
 const page=await createSyncPublication({store:f.store,mailbox}).page({scope,consumer:{fixture:'current-host-consumer'},producer:stored.value.producer,input_cursor:null,limit:25,check:async()=>{},localCheck:async()=>{},readNative:()=>assert.fail('No native rescan for a query-observed source')});
 const descriptor=structuredClone(EMAIL_METADATA_DESCRIPTOR),mapping={record_id_field:'source_record_id',content_digest_field:'source_content_digest',observed_at_field:'source_observed_at'};
 for(const [field,maxLength]of [['source_record_id',36],['source_content_digest',71],['source_observed_at',64]]){descriptor.record_schema.properties[field]={type:'string',maxLength};descriptor.record_schema.required.push(field);}
 const parsed=parseSyncPageV2(descriptor,{schema_version:'deft.app_sync_request.v2',cursor:null,max_items:25,attachments:descriptor.attachments},{schema_version:'deft.app_sync_page.v2',upserts:page.items.map(item=>integrationSourceProjection(scope,item,page.observed_at,mapping)),tombstones:[],next_cursor:page.next_cursor,has_more:page.has_more});
 assert.equal(parsed.upserts[0].data.source_record_id,result.items[0].record_id);assert.equal(parsed.upserts[0].data.source_content_digest,result.items[0].content_digest);assert.equal(parsed.has_more,true);assert.deepEqual(parsed.tombstones,[]);assert.equal(page.complete,false);
 assert.equal(await mailbox.cursor(scope,async()=>{}),cursor);assert.deepEqual((await mailbox.cacheSnapshot(scope,[],async()=>{})).stamp,before.stamp);
 const stale=f.request('resource_read_metadata',{store_key:'drafts',resource_key:'inbox',record_id:result.items[0].record_id,content_digest:'sha256:'+'0'.repeat(64)});await assert.rejects(f.run(stale),error=>error.code==='EMAIL_DATA_SOURCE_CHANGED');
 f.deny();await assert.rejects(f.run(f.request('resource_read_metadata',{store_key:'drafts',resource_key:'inbox',record_id:result.items[0].record_id,content_digest:result.items[0].content_digest})),/revoked/);
});
async function fixture(t,provider=providerFixture,options={}){const parent=await mkdtemp(join(tmpdir(),'email-e2-data-')),root=join(parent,'private');let store;const encryption_key=Buffer.alloc(32,41),scope={...makeScope(),...(options.persistent?{consent_expires_at:null,consent_lifetime:'until_revoked'}:{})},registration=registrationFor(scope);let calls=0,allowed=true;const fetch=async(...args)=>{calls++;return provider(...args);};store=await createDurableStore({root,encryption_key,key_id:'fixture-data',allow_windows_fixture:process.platform==='win32'});const connectionRuntime=createConnectionRuntime({registration,client,store,encryption_key,key_id:'fixture-data',assertCurrent:authority,fetch});const begin=beginFor(scope);if(options.sessionId)begin.session_id=options.sessionId;const begun=await connectionRuntime.request(begin),connected=await connectionRuntime.request(nextFor(begin,begun,'callback'));
  let lose=false;const dataStore={withLock(lockOptions,work){options.onStoreLock?.(lockOptions.key);return store.withLock(lockOptions,tx=>work({...tx,async compareAndSwap(value){options.onStoreWrite?.(lockOptions.key);if(lose&&value.value.schema_version==='email.app_mutation.v1'&&value.value.state==='completed'){lose=false;throw Error('synthetic response journal loss after draft CAS');}return tx.compareAndSwap(value);}}));}};
  const dependencies=()=>({registrations:[registration],client,store:dataStore,encryption_key,key_id:'fixture-data',imageDependencies:options.imageDependencies,onDiagnostic:options.onDiagnostic??(()=>{}),assertCurrent:async(input,signal)=>{if(!allowed)throw Error('revoked');return await options.onAuthority?.(input,signal)??{...input,allowed:true};},fetch});let runtime=createDataRuntime(dependencies());
  const request=(operation,input)=>{const result={schema_version:'deft.app_data_runtime.v1',request_id:randomUUID(),scope,connection:{session_id:begin.session_id,session_revision:5,runtime_session_ref:begun.runtime_session_ref,account_ref:connected.account.account_ref},authority:{consent_id:randomUUID(),consent_digest:'sha256:'+'d'.repeat(64),data_policy_digest:'sha256:'+'e'.repeat(64)},operation,expires_at:new Date(Date.now()+29000).toISOString(),input};if(operation==='connection_metadata'&&input.seed?.operation_key==='record_seed_snapshot'&&!input.seed.value.expected)input.seed.value.expected=compoundSeedPins(result);return result;};
  const binding=(await store.withLock({key:'email.runtime.session.'+begin.session_id},tx=>tx.read())).value.binding;
  t.after(async()=>{await store.close();await rm(parent,{recursive:true,force:true});});return {root,binding,store,request,run:(...args)=>runtime.request(...args),get runtime(){return runtime;},loseNextCompletion(){lose=true;},get calls(){return calls;},deny(){allowed=false;},async restart(){await store.close();store=await createDurableStore({root,encryption_key,key_id:'fixture-data',allow_windows_fixture:process.platform==='win32'});runtime=createDataRuntime(dependencies());}};
}
test('Host UUIDv5 connection reaches actual HTTP inbox read and retained draft reads',async t=>{
 const provider=(url,options)=>new URL(url).pathname.endsWith('/messages')?Response.json({messages:[],resultSizeEstimate:0}):providerFixture(url,options);const f=await fixture(t,provider,{sessionId:'11111111-1111-5111-8111-111111111111'}),id=randomUUID();let record=(await f.run(f.request('record_create',{store_key:'drafts',record_id:id,value:empty}))).record;await f.restart();assert.equal((await f.run(f.request('record_read',{store_key:'drafts',record_id:id}))).record.content_digest,record.content_digest);
 const token='V'.repeat(43),server=createServer(createHttpHandler({runtime_auth_token:token,runtime:{},data_runtime:f.runtime}));await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>server.close(done)));const q=f.request('resource_list',{store_key:'drafts',resource_key:'inbox',cursor:null,limit:10,query:'in:inbox'});const response=await fetch('http://127.0.0.1:'+server.address().port+'/v1/data',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(q)});assert.equal(response.status,200);assert.equal((await response.json()).outcome,'completed');const foreign=f.request('record_read',{store_key:'drafts',record_id:id});foreign.connection.account_ref=randomUUID();await assert.rejects(f.run(foreign),{code:'EMAIL_DATA_CONNECTION_DENIED'});
});
test('native-sized rich draft durable CAS, conflict, acknowledgement replay, restart and account isolation',async t=>{const f=await fixture(t),id=randomUUID(),text='x'.repeat(200000),value={...empty,body:text,body_html:'<p>'+text+'</p>'},create=f.request('record_create',{store_key:'drafts',record_id:id,value}),created=await f.run(create);assert.equal(created.record.value.body.length,200000);assert.equal(created.record.revision,1);assert.equal(f.calls,3);assert.deepEqual((await f.run(create)).record,created.record);const save=f.request('record_save',{store_key:'drafts',record_id:id,expected_revision:1,expected_content_digest:created.record.content_digest,value:{...value,subject:'Changed'}}),saved=await f.run(save);assert.equal(saved.record.revision,2);assert.equal((await f.run(save)).record.revision,2);const conflict=await f.run(f.request('record_save',{...save.input,value:{...value,subject:'Lost local edit'}}));assert.equal(conflict.outcome,'conflict');await f.restart();const read=await f.run(f.request('record_read',{store_key:'drafts',record_id:id}));assert.equal(read.record.value.subject,'Changed');assert.equal(read.record.value.body_html,value.body_html);const foreign=f.request('record_read',{store_key:'drafts',record_id:id});foreign.connection.account_ref=randomUUID();await assert.rejects(f.run(foreign),error=>error.code==='EMAIL_DATA_CONNECTION_DENIED');assert.equal(f.calls,3);for(const name of await readdir(f.root)){if(name.endsWith('.json'))assert.ok(!(await readFile(join(f.root,name),'utf8')).includes('Changed'));}});
test('file bytes survive restart, scoped inline CID blocks detach until save; upload request replay does not duplicate files',async t=>{const f=await fixture(t),id=randomUUID(),file_id=randomUUID(),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/wAAAABJRU5ErkJggg==','base64');let record=(await f.run(f.request('record_create',{store_key:'drafts',record_id:id,value:empty}))).record;const upload=f.request('file_upload',{store_key:'drafts',record_id:id,expected_revision:record.revision,expected_content_digest:record.content_digest,file_id,filename:'owned.png',media_type:'image/png',size_bytes:png.length,sha256:sha(png)});record=(await f.run(upload,undefined,png)).record;assert.equal((await f.run(upload,undefined,png)).record.revision,record.revision);assert.equal(record.files.length,1);const html=`<p>Image <img src="cid:${nativeComposeImageCid(file_id)}" alt="Example"></p>`,body=parseNativeSafeComposeHtml(html,{inlineAttachments:record.value.attachments}).plainText;record=(await f.run(f.request('record_save',{store_key:'drafts',record_id:id,expected_revision:record.revision,expected_content_digest:record.content_digest,value:{...record.value,body,body_html:html}}))).record;const file=record.files[0];await assert.rejects(f.run(f.request('file_detach',{store_key:'drafts',record_id:id,expected_revision:record.revision,expected_content_digest:record.content_digest,file_id,upload_revision:file.upload_revision,sha256:file.sha256})),error=>error.code==='EMAIL_DRAFT_FILE_REFERENCED');await f.restart();const read=await f.run(f.request('file_read',{store_key:'drafts',record_id:id,file_id,upload_revision:file.upload_revision,sha256:file.sha256}));assert.deepEqual(read.bytes,png);record=(await f.run(f.request('record_save',{store_key:'drafts',record_id:id,expected_revision:record.revision,expected_content_digest:record.content_digest,value:{...record.value,body:'Removed image',body_html:'<p>Removed image</p>'}}))).record;record=(await f.run(f.request('file_detach',{store_key:'drafts',record_id:id,expected_revision:record.revision,expected_content_digest:record.content_digest,file_id,upload_revision:file.upload_revision,sha256:file.sha256}))).record;assert.equal(record.files.length,0);await assert.rejects(f.run(f.request('file_read',{store_key:'drafts',record_id:id,file_id,upload_revision:file.upload_revision,sha256:file.sha256})));const reconciled=await f.run(f.request('request_status',{store_key:'drafts',request_id:upload.request_id}));assert.equal(reconciled.request_status.state,'completed');assert.equal(reconciled.request_status.revision,2);});
test('native draft quota, foreign attachment nomination, corrupt upload, revoked authority reject before mutation or provider',async t=>{const f=await fixture(t),id=randomUUID();await assert.rejects(f.run(f.request('record_create',{store_key:'drafts',record_id:id,value:{...empty,body:'x'.repeat(256*1024+1)}})));const created=await f.run(f.request('record_create',{store_key:'drafts',record_id:id,value:empty}));const file_id=randomUUID(),bytes=Buffer.from('binary bytes');await assert.rejects(f.run(f.request('file_upload',{store_key:'drafts',record_id:id,expected_revision:1,expected_content_digest:created.record.content_digest,file_id,filename:'test.bin',media_type:'application/octet-stream',size_bytes:bytes.length,sha256:sha(Buffer.from('different'))}),undefined,bytes));await assert.rejects(f.run(f.request('record_save',{store_key:'drafts',record_id:id,expected_revision:1,expected_content_digest:created.record.content_digest,value:{...empty,attachments:[{file_id,filename:'test.bin',media_type:'application/octet-stream',size_bytes:bytes.length,sha256:sha(bytes).slice(7)}]}})));f.deny();await assert.rejects(f.run(f.request('record_read',{store_key:'drafts',record_id:id})));assert.equal(f.calls,3);});
test('binary frame validates exact sizes and narrowed data authority expiry aborts operation signal',async()=>{const bytes=Buffer.from([0,255,5,13,10]),header={a:1},frame=encodeFileFrame(header,bytes),decoded=decodeFileFrame(frame);assert.deepEqual(decoded.header,header);assert.deepEqual(decoded.bytes,bytes);assert.throws(()=>decodeFileFrame(Buffer.from([0,0,80,0])));const scope=makeScope(),request={scope,request_id:randomUUID(),connection:{},authority:{},operation:'record_read',input:{},expires_at:new Date(Date.now()+29000).toISOString()},guard=createDataChecker({request,assertCurrent:async input=>({...input,allowed:true,expires_at:new Date(Date.now()+40).toISOString()})});try{await guard.check();await new Promise(done=>setTimeout(done,70));assert.equal(guard.signal.aborted,true);}finally{guard.dispose();}});
test('frozen Gmail inventory/catchup/sweep/delta refresh, cached UUID locator, exact EML/presentation/file and restart use actual provider bridge',async t=>{
  const attachment=Buffer.from('EXACT_RECEIVED_FILE'),mime=Buffer.from('From: sender@example.test\r\nTo: fixture@example.test\r\nSubject: Synthetic source\r\nMessage-ID: <source@example.test>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=test\r\n\r\n--test\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Native body<img src="https://public.example.test/image.png" alt="Remote"></p>\r\n--test\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename="received.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\n'+attachment.toString('base64')+'\r\n--test--\r\n');
  const metadata={id:'synthetic-message',threadId:'synthetic-thread',labelIds:['INBOX'],historyId:'1',internalDate:String(Date.now()),payload:{headers:[{name:'From',value:'sender@example.test'},{name:'To',value:'fixture@example.test'},{name:'Subject',value:'Synthetic source'},{name:'Message-ID',value:'<source@example.test>'}]}};
  const provider=async(url,options)=>{const parsed=new URL(url);if(url==='https://gmail.googleapis.com/gmail/v1/users/me/profile')return Response.json({emailAddress:'fixture@example.test',historyId:'1'});if(parsed.pathname.endsWith('/history'))return Response.json({history:[],historyId:'1'});if(parsed.pathname.endsWith('/threads/'+metadata.threadId))return Response.json({id:metadata.threadId,messages:[metadata]});if(parsed.pathname.endsWith('/messages'))return Response.json({messages:[{id:metadata.id}],resultSizeEstimate:1});if(parsed.pathname.endsWith('/messages/'+metadata.id))return Response.json(parsed.searchParams.get('format')==='raw'?{id:metadata.id,threadId:metadata.threadId,raw:mime.toString('base64url')}:metadata);return providerFixture(url,options);};
  const f=await fixture(t,provider),refresh=()=>f.run(f.request('resource_refresh',{store_key:'drafts',resource_key:'inbox'}));let observed=await refresh();assert.equal(observed.freshness.provider_observed,true);assert.equal(observed.freshness.complete,false);for(let i=0;i<4&&!observed.freshness.complete;i++)observed=await refresh();assert.equal(observed.freshness.complete,true);const before=f.calls,listInput={store_key:'drafts',resource_key:'inbox',cursor:null,limit:25},page=await f.run(f.request('resource_list',listInput));assert.equal(page.items.length,1);assert.equal(page.freshness.provider_observed,false);assert.equal(f.calls,before);const resource=page.items[0],sourceInput={store_key:'drafts',resource_key:'inbox',record_id:resource.record_id,content_digest:resource.content_digest},view=await f.run(f.request('resource_read_presentation',sourceInput));assert.match(view.presentation.content,/Native body/);assert.equal(view.files.length,1);const source=await f.run(f.request('resource_read_source',sourceInput));assert.deepEqual(Buffer.from(source.bytes),mime);assert.equal(source.sha256,sha(mime));const file=await f.run(f.request('resource_read_file',{...sourceInput,file_ref:view.files[0].file_ref}));assert.deepEqual(Buffer.from(file.bytes),attachment);assert.equal(file.sha256,sha(attachment));const imageBefore=f.calls;await assert.rejects(f.run(f.request('resource_read_image',{...sourceInput,image_ref:view.presentation.images[0].image_ref,external_images:'blocked'})),error=>error.code==='EMAIL_DATA_IMAGE_DENIED');assert.equal(f.calls,imageBefore+1);await f.restart();const restarted=await f.run(f.request('resource_list',listInput));assert.equal(restarted.items[0].record_id,resource.record_id);assert.equal(restarted.items[0].content_digest,resource.content_digest);const invalid=f.request('resource_read_source',{...sourceInput,content_digest:'sha256:'+'0'.repeat(64)}),invalidBefore=f.calls;await assert.rejects(f.run(invalid),error=>error.code==='EMAIL_DATA_SOURCE_CHANGED');assert.equal(f.calls,invalidBefore);
});
test('foreground Refresh invalidates current inbox memo while cache-only Gmail history needs continuation',async t=>{
  const original=dataFixtureMessage('fixture@example.test'),arrived=structuredClone(original.metadata);
  arrived.id='synthetic-arrived-message';arrived.threadId='synthetic-arrived-thread';arrived.historyId='2';
  arrived.payload.headers=arrived.payload.headers.map(header=>header.name==='Subject'?{...header,value:'New controlled arrival'}:header);
  let arrival=false,historyCalls=0,queryCalls=0,metadataCalls=0;
  const provider=async(url,options)=>{
    const parsed=new URL(url);
    if(parsed.pathname.endsWith('/profile'))return Response.json({emailAddress:'fixture@example.test',historyId:arrival?'2':'1'});
    if(parsed.pathname.endsWith('/history')){historyCalls++;return Response.json({history:arrival&&parsed.searchParams.get('startHistoryId')==='1'?[{id:'2',messagesAdded:[{message:{id:arrived.id,threadId:arrived.threadId}}]}]:[],historyId:arrival?'2':'1'});}
    if(parsed.pathname.endsWith('/messages')){const queried=Boolean(parsed.searchParams.get('q'))||parsed.searchParams.getAll('labelIds').includes('INBOX');if(queried)queryCalls++;return Response.json({messages:[{id:original.metadata.id},...(queried&&arrival?[{id:arrived.id}]:[])],resultSizeEstimate:queried&&arrival?2:1});}
    if(parsed.pathname.endsWith('/messages/'+original.metadata.id)){metadataCalls++;return Response.json(original.metadata);}
    if(parsed.pathname.endsWith('/messages/'+arrived.id)){metadataCalls++;return Response.json(arrived);}
    return providerFixture(url,options);
  };
  const f=await fixture(t,provider),input={store_key:'drafts',resource_key:'inbox'},refresh=()=>f.run(f.request('resource_refresh',input)),list=()=>f.run(f.request('resource_list',{...input,cursor:null,limit:25}));
  const queryAuthority=f.request('resource_list',{}).authority,query=()=>{const request=f.request('resource_list',{...input,cursor:null,limit:25,query:'in:inbox'});request.authority=queryAuthority;return f.run(request);};
  let initial;
  for(let page=0;page<8;page++){initial=await refresh();if(initial.freshness.complete)break;}
  assert.equal(initial.freshness.complete,true);
  assert.equal((await list()).items.length,1);
  assert.equal((await query()).items.length,1);assert.equal(queryCalls,1);
  arrival=true;
  const beforeMemo={queryCalls,metadataCalls};assert.equal((await query()).items.length,1);assert.deepEqual({queryCalls,metadataCalls},beforeMemo,'An unchanged warm query uses its bounded memo');
  const queued=await refresh();
  assert.equal(queued.freshness.complete,false);
  assert.equal((await list()).items.length,1,'One refresh page queues history without claiming fresh new rows');
  const beforeQuery={queryCalls,metadataCalls},freshQuery=await query();
  assert.equal(freshQuery.items.length,2,'Ordinary UI inbox query sees newly arrived mail after ONE Refresh');
  assert.equal(queryCalls-beforeQuery.queryCalls,1);assert.equal(metadataCalls-beforeQuery.metadataCalls,2);assert.equal(freshQuery.freshness.complete,false);
  console.log(JSON.stringify({event:'foreground_refresh_query_characterization',refresh_pages_for_ui_arrival:1,query_requests_after_refresh:queryCalls-beforeQuery.queryCalls,metadata_reads_after_refresh:metadataCalls-beforeQuery.metadataCalls,cache_only_requires_continuation:true}));
  const materialized=await refresh();
  assert.equal(materialized.freshness.complete,false);
  assert.equal((await list()).items.length,2,'Foreground continuation materializes the newly arrived message');
  let completed=materialized;
  for(let page=0;page<8&&!completed.freshness.complete;page++)completed=await refresh();
  assert.equal(completed.freshness.complete,true);
  await f.restart();
  const persisted=await list();assert.equal(persisted.items.length,2);assert.ok(persisted.items.some(item=>item.data.subject==='New controlled arrival'));
  assert.ok(historyCalls>=3);
});

test('native 25MiB exact file budget accepts boundary and rejects aggregate overflow without changing the draft',async t=>{const f=await fixture(t),id=randomUUID(),file_id=randomUUID(),bytes=Buffer.alloc(25*1024*1024,0xA5);let record=(await f.run(f.request('record_create',{store_key:'drafts',record_id:id,value:empty}))).record;record=(await f.run(f.request('file_upload',{store_key:'drafts',record_id:id,expected_revision:1,expected_content_digest:record.content_digest,file_id,filename:'boundary.bin',media_type:'application/octet-stream',size_bytes:bytes.length,sha256:sha(bytes)}),undefined,bytes)).record;await assert.rejects(f.run(f.request('file_upload',{store_key:'drafts',record_id:id,expected_revision:record.revision,expected_content_digest:record.content_digest,file_id:randomUUID(),filename:'overflow.bin',media_type:'application/octet-stream',size_bytes:1,sha256:sha(Buffer.from([1]))}),undefined,Buffer.from([1])),error=>error.code==='EMAIL_DRAFT_LIMIT');await f.restart();const read=await f.run(f.request('file_read',{store_key:'drafts',record_id:id,file_id,upload_revision:record.files[0].upload_revision,sha256:record.files[0].sha256}));assert.equal(read.bytes.length,bytes.length);assert.equal(sha(read.bytes),sha(bytes));});
test('draft CAS followed by lost response journal reconciles after restart without replay;32files enforce native boundary',async t=>{
  const f=await fixture(t),id=randomUUID(),create=f.request('record_create',{store_key:'drafts',record_id:id,value:empty});f.loseNextCompletion();await assert.rejects(f.run(create));await f.restart();assert.equal((await f.run(create)).outcome,'indeterminate');const status=await f.run(f.request('request_status',{store_key:'drafts',request_id:create.request_id}));assert.equal(status.request_status.state,'completed');assert.equal(status.request_status.revision,1);let record=(await f.run(f.request('record_read',{store_key:'drafts',record_id:id}))).record;
  const bytes=Buffer.from([1]);for(let i=0;i<32;i++)record=(await f.run(f.request('file_upload',{store_key:'drafts',record_id:id,expected_revision:record.revision,expected_content_digest:record.content_digest,file_id:randomUUID(),filename:'file-'+i+'.bin',media_type:'application/octet-stream',size_bytes:1,sha256:sha(bytes)}),undefined,bytes)).record;assert.equal(record.files.length,32);await assert.rejects(f.run(f.request('file_upload',{store_key:'drafts',record_id:id,expected_revision:record.revision,expected_content_digest:record.content_digest,file_id:randomUUID(),filename:'overflow.bin',media_type:'application/octet-stream',size_bytes:1,sha256:sha(bytes)}),undefined,bytes));assert.equal((await f.run(f.request('record_read',{store_key:'drafts',record_id:id}))).record.revision,33);
});
test('actual HTTP full rich draft and exact25MiB binary frame preserve budgets and byte digests',async t=>{
  const f=await fixture(t),token='T'.repeat(43),server=createServer(createHttpHandler({runtime_auth_token:token,runtime:{request(){throw Error();}},data_runtime:f.runtime}));await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>server.close(done)));const url='http://127.0.0.1:'+server.address().port+'/v1/data',post=async(input,bytes)=>fetch(url,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':bytes?'application/vnd.deft.app-data-frame.v1':'application/json'},body:bytes?encodeFileFrame(input,bytes):JSON.stringify(input)});
  const text='q'.repeat(240000),id=randomUUID(),create=f.request('record_create',{store_key:'drafts',record_id:id,value:{...empty,body:text,body_html:'<p>'+text+'</p>'}}),created=await post(create);assert.equal(created.status,200);let record=(await created.json()).record;assert.equal(record.value.body,text);const bytes=Buffer.alloc(25*1024*1024,0x5A),file_id=randomUUID(),upload=await post(f.request('file_upload',{store_key:'drafts',record_id:id,expected_revision:record.revision,expected_content_digest:record.content_digest,file_id,filename:'http-boundary.bin',media_type:'application/octet-stream',size_bytes:bytes.length,sha256:sha(bytes)}),bytes);assert.equal(upload.status,200);record=(await upload.json()).record;const response=await post(f.request('file_read',{store_key:'drafts',record_id:id,file_id,upload_revision:record.files[0].upload_revision,sha256:sha(bytes)}));assert.equal(response.status,200);const frame=decodeFileFrame(new Uint8Array(await response.arrayBuffer()));assert.equal(frame.header.schema_version,'deft.app_data_binary.v1');assert.equal(frame.header.sha256,sha(bytes));assert.deepEqual(frame.bytes,bytes);
});

test('actual data final-disclosure revocation clears binary image after one scoped MIME fetch',async t=>{
 const message=dataFixtureMessage('fixture@example.test');let rawCalls=0,imageBytes,checks=0,denyAt=Infinity,denyDns=false,dnsRevoked=false,advanceAfterImage=false,imageReturned=false,imageRequests=0;
 const provider=async(url,options)=>{const parsed=new URL(url);if(parsed.pathname.endsWith('/threads/'+message.metadata.threadId))return Response.json({id:message.metadata.threadId,messages:[message.metadata]});if(parsed.pathname.endsWith('/messages'))return Response.json({messages:[{id:message.metadata.id}]});if(parsed.pathname.endsWith('/messages/'+message.metadata.id)){if(parsed.searchParams.get('format')==='raw'){rawCalls++;return Response.json({id:message.metadata.id,threadId:message.metadata.threadId,raw:message.mime.toString('base64url')});}return Response.json(message.metadata);}return providerFixture(url,options);};
 const f=await fixture(t,provider,{onAuthority:async input=>{if(input.operation==='resource_read_image'){checks++;if(checks===denyAt||dnsRevoked)throw Object.assign(Error('synthetic final disclosure revoked'),{code:'EMAIL_DATA_AUTHORITY_DENIED'});if(advanceAfterImage&&imageReturned)await f.runtime.custody.withAccount(f.binding,async tx=>{const row=tx.read();await tx.write({health:row.health,secret:row.secret,advance_setup:true});});}},imageDependencies:{async lookup(){if(denyDns)dnsRevoked=true;return [{address:'8.8.8.8',family:4}];},async request(){imageRequests++;imageReturned=true;imageBytes=Buffer.from(message.png);return {bytes:imageBytes,media_type:'image/png'};}}});
 const list=await f.run(f.request('resource_list',{store_key:'drafts',resource_key:'inbox',cursor:null,limit:25,query:'in:inbox'})),record=list.items[0],source={store_key:'drafts',resource_key:'inbox',record_id:record.record_id,content_digest:record.content_digest};
 const view=await f.run(f.request('resource_read_presentation',source)),image=view.presentation.images.find(value=>value.kind==='remote');assert.ok(image);
 const input={...source,image_ref:image.image_ref,external_images:'allowed'};checks=0;const before=rawCalls,result=await f.run(f.request('resource_read_image',input));assert.equal(rawCalls,before+1);assert.deepEqual(Buffer.from(result.bytes),message.png);result.bytes.fill(0);
 checks=0;const currentRaw=rawCalls,warm=await f.run(f.request('resource_read_image',input));assert.equal(rawCalls,currentRaw,'current Gmail anchor validation permits exact MIME reuse');assert.deepEqual(Buffer.from(warm.bytes),message.png);denyAt=checks;warm.bytes.fill(0);checks=0;
 const imagesBeforeFinal=imageRequests;await assert.rejects(f.run(f.request('resource_read_image',input)),{code:'EMAIL_DATA_AUTHORITY_DENIED'});assert.equal(rawCalls,currentRaw);assert.equal(checks,denyAt);assert.equal(imageRequests,imagesBeforeFinal+1,'final denial occurs after image HTTP completion');assert.ok(imageBytes.every(value=>value===0));
 const dispatched=rawCalls;checks=0;denyAt=3;await assert.rejects(f.run(f.request('resource_read_image',input)));assert.equal(rawCalls,dispatched,'fresh pre-provider denial must prevent MIME HTTP dispatch');
 denyAt=Infinity;checks=0;denyDns=true;const imagesBefore=imageRequests;await assert.rejects(f.run(f.request('resource_read_image',input)));assert.equal(imageRequests,imagesBefore,'revocation during DNS must prevent image HTTP dispatch');
 denyDns=false;dnsRevoked=false;checks=0;advanceAfterImage=true;imageReturned=false;const imagesBeforeCustody=imageRequests;await assert.rejects(f.run(f.request('resource_read_image',input)),{code:'EMAIL_DATA_CONNECTION_DENIED'});assert.equal(imageRequests,imagesBeforeCustody+1);assert.ok(imageBytes.every(value=>value===0),'custody generation change at final disclosure must clear image bytes');
});

test('cache-only data reads retain current custody health checks without provider IO',async t=>{
 const f=await fixture(t),inputs=[['resource_list',{store_key:'drafts',resource_key:'inbox',cursor:null,limit:25}],['record_list',{store_key:'drafts',cursor:null,limit:25}],['request_status',{store_key:'drafts',request_id:randomUUID()}]];
 for(const [operation,input] of inputs)assert.equal((await f.run(f.request(operation,input))).outcome,'completed');
 const before=f.calls;await f.runtime.custody.withAccount(f.binding,async tx=>{const row=tx.read();await tx.write({health:'reauth_required',secret:row.secret});});
 for(const [operation,input] of inputs)await assert.rejects(f.run(f.request(operation,input)));
 assert.equal(f.calls,before);
});




test('public readonly mailbox status counts cached Inbox beyond visible pages and survives restart without provider IO',async t=>{
 const f=await fixture(t),request=f.request('record_list',{store_key:'mailbox_status',cursor:null,limit:10}),scope={org_id:request.scope.org_id,owner_user_id:request.scope.owner_user_id,account_id:request.connection.account_ref},items=Array.from({length:76},(_,i)=>({account_id:scope.account_id,logical_message_id:'mail_'+i.toString(16).padStart(64,'0'),revision:'1',data:{subject:'Synthetic unread '+i},folders:[i%2?'inbox':'sent'],flags:{seen:false},received_at:'2026-10-09T00:00:00Z',provider_source:{provider:'gmail'}}));
 await f.runtime.mailbox.commit(scope,{items,tombstones:[],state_updates:[{state_key:'synthetic',generation:'one',value:{cursor:null}}],complete:true,observed_at:'2026-10-09T00:00:00Z',next_cursor:null},async()=>{});
 const before=f.calls,result=await f.run(request);assert.equal(result.items.length,1);assert.equal(result.items[0].summary.unread_count,38);assert.equal(Object.hasOwn(result.items[0],'value'),false);
 await f.restart();const restored=await f.run(f.request('record_read',{store_key:'mailbox_status',record_id:result.items[0].record_id}));assert.equal(restored.record.value.unread_count,38);assert.equal(f.calls,before);
 await assert.rejects(f.run(f.request('record_create',{store_key:'mailbox_status',record_id:randomUUID(),value:{unread_count:0}})));
 f.deny();await assert.rejects(f.run(f.request('record_list',request.input)));assert.equal(f.calls,before);
});

test('until-revoked account retains draft across restart and still denies revoked or foreign reads',async t=>{
 const f=await fixture(t,providerFixture,{persistent:true}),id=randomUUID();
 const created=await f.run(f.request('record_create',{store_key:'drafts',record_id:id,value:empty}));
 await f.restart();const read=f.request('record_read',{store_key:'drafts',record_id:id});
 assert.equal((await f.run(read)).record.content_digest,created.record.content_digest);
 const foreign=structuredClone(read);foreign.request_id=randomUUID();foreign.scope.owner_user_id=randomUUID();
 await assert.rejects(f.run(foreign));const before=f.calls;f.deny();await assert.rejects(f.run({...read,request_id:randomUUID()}));assert.equal(f.calls,before);
});

test('saved draft reads keep fresh outer authority without nested network round trips',async t=>{
 let calls=0,denyFinal=false;const f=await fixture(t,providerFixture,{persistent:true,onAuthority:async()=>{calls++;if(denyFinal&&calls===3)throw Object.assign(Error('revoked before disclosure'),{code:'EMAIL_DATA_AUTHORITY_DENIED'});}}),id=randomUUID();
 const created=await f.run(f.request('record_create',{store_key:'drafts',record_id:id,value:empty}));
 for(const [operation,input]of [['record_list',{store_key:'drafts',cursor:null,limit:25}],['record_read',{store_key:'drafts',record_id:id}]]){
  calls=0;const providers=f.calls,result=await f.run(f.request(operation,input));assert.equal(result.outcome,'completed');assert.equal(calls,3,'entry, after session-lock wait and final disclosure must be freshly authorized');assert.equal(f.calls,providers,'saved reads must not contact the provider');
  calls=0;denyFinal=true;await assert.rejects(f.run(f.request(operation,input)),{code:'EMAIL_DATA_AUTHORITY_DENIED'});assert.equal(calls,3);denyFinal=false;
 }
 assert.equal((await f.run(f.request('record_read',{store_key:'drafts',record_id:id}))).record.content_digest,created.record.content_digest);
});


test('inflight data authority checker shares only identical inflight authority, never sequential results',async()=>{
 const request={scope:makeScope(),request_id:randomUUID(),connection:{},authority:{},operation:'record_read',input:{},expires_at:new Date(Date.now()+29000).toISOString()};let calls=0,release;
 const checker=createDataChecker({request,assertCurrent:async input=>{calls++;await new Promise(done=>release=done);return {...input,allowed:true};}});
 try{const batch=Array.from({length:10},()=>checker.check());assert.equal(calls,1);release();await Promise.all(batch);const next=checker.check();assert.equal(calls,2);release();await next;const pending=checker.check(),firstRelease=release;request.input={different:true};const distinct=checker.check();assert.equal(calls,4);firstRelease();release();await Promise.all([pending,distinct]);}finally{checker.dispose();}
});

test('inflight data authority keeps local abort expiry and fresh final denial',async()=>{
 for(const mode of ['abort','expiry','denial']){let clock=Date.now(),calls=0,release;const controller=new AbortController(),request={scope:makeScope(),request_id:randomUUID(),connection:{},authority:{},operation:'record_read',input:{},expires_at:new Date(clock+29000).toISOString()};const checker=createDataChecker({request,signal:controller.signal,now:()=>clock,assertCurrent:async input=>{calls++;await new Promise(done=>release=done);return {...input,allowed:mode!=='denial'||calls===1};}});
 try{const work=Promise.all([checker.check(),checker.check()]);assert.equal(calls,1);if(mode==='abort')controller.abort();if(mode==='expiry')clock+=30000;release();if(mode==='denial'){await work;const final=checker.check();assert.equal(calls,2);release();await assert.rejects(final);}else await assert.rejects(work);}finally{checker.dispose();}}
});

test('inflight data authority actual cold ten-message query shares concurrent authority and keeps final disclosure fresh',async t=>{
 let callbacks=0,providers=0;
 const provider=async(url,options)=>{const p=new URL(url);if(p.pathname.endsWith('/messages')){providers++;return Response.json({messages:Array.from({length:10},(_,i)=>({id:'synthetic-cold-'+i})),resultSizeEstimate:10});}if(/\/messages\/synthetic-cold-\d+$/u.test(p.pathname)){providers++;const value=structuredClone(dataFixtureMessage().metadata);value.id=p.pathname.split('/').at(-1);return Response.json(value);}return providerFixture(url,options);};
 const f=await fixture(t,provider,{onAuthority:async()=>{callbacks++;await new Promise(done=>setTimeout(done,20));}});
 const input={store_key:'drafts',resource_key:'inbox',cursor:null,limit:10,query:'in:inbox'};const result=await f.run(f.request('resource_list',input));assert.equal(result.items.length,10);assert.equal(providers,11);assert.equal(callbacks,8);
 callbacks=0;providers=0;const revoked=await fixture(t,provider,{onAuthority:async()=>{callbacks++;await new Promise(done=>setTimeout(done,20));if(callbacks===8)throw Error('revoked before final disclosure');}});await assert.rejects(revoked.run(revoked.request('resource_list',input)));assert.equal(providers,11);assert.equal(callbacks,8);
});

test('local settings reads retain fresh entry lock and disclosure fences',async t=>{
 let calls=0,denyFinal=false;const f=await fixture(t,providerFixture,{persistent:true,onAuthority:async()=>{calls++;if(denyFinal&&calls===3)throw Object.assign(Error('revoked before disclosure'),{code:'EMAIL_DATA_AUTHORITY_DENIED'});}}),id=randomUUID();
 const created=await f.run(f.request('record_create',{store_key:'preferences',record_id:id,value:{external_images:'ask'}}));
 for(const [operation,input] of [['record_list',{store_key:'preferences',cursor:null,limit:1}],['record_read',{store_key:'preferences',record_id:id}]]){
  calls=0;const before=f.calls,result=await f.run(f.request(operation,input));assert.equal(result.outcome,'completed');assert.equal(calls,3);assert.equal(f.calls,before);
  calls=0;denyFinal=true;await assert.rejects(f.run(f.request(operation,input)),{code:'EMAIL_DATA_AUTHORITY_DENIED'});assert.equal(calls,3);denyFinal=false;
 }
 assert.equal(created.record.value.external_images,'ask');
});

test('local preferences disclosure still rejects custody change and abort',async t=>{
 for(const mode of ['generation','health','abort']){
  let calls=0,armed=false,f;const controller=new AbortController();
  f=await fixture(t,providerFixture,{onAuthority:async()=>{calls++;if(armed&&calls===3){if(mode==='abort')controller.abort();else await f.runtime.custody.withAccount(f.binding,async tx=>{const row=tx.read();await tx.write({health:mode==='health'?'reauth_required':row.health,secret:row.secret,advance_setup:mode==='generation'});});}}});
  await f.run(f.request('record_create',{store_key:'preferences',record_id:randomUUID(),value:{external_images:'ask'}}));
  calls=0;armed=true;const before=f.calls;await assert.rejects(f.run(f.request('record_list',{store_key:'preferences',cursor:null,limit:1}),controller.signal));assert.equal(calls,3);assert.equal(f.calls,before);
 }
});


test('foreground diagnostics cross actual data runtime with safe correlated authority and lock phases',async t=>{
 const events=[],f=await fixture(t,providerFixture,{onDiagnostic:event=>events.push(event)}),id=randomUUID();
 await f.run(f.request('record_create',{store_key:'drafts',record_id:id,value:empty}));events.length=0;
 const q=f.request('record_read',{store_key:'drafts',record_id:id});await f.run(q);
 assert.equal(events.length,1);const event=events[0];assert.equal(event.request_id,q.request_id);assert.equal(event.operation,'record_read');assert.equal(event.outcome,'completed');assert.ok(event.timings.authority.calls>=2);assert.equal(event.timings.session_queue.calls,1);assert.equal(event.timings.session_hold.calls,1);assert.ok(!JSON.stringify(event).includes(empty.subject));
 events.length=0;f.deny();await assert.rejects(f.run(q));assert.equal(events[0].failure.phase,'authority');assert.equal(events[0].outcome,'failed');
});


test('reply seed read is read-only; first edited save revalidates the pinned source and preserves exact edits and origin',async t=>{
 const message=dataFixtureMessage('fixture@example.test'),provider=(url,options)=>{const parsed=new URL(url);if(parsed.pathname.endsWith('/messages'))return Response.json({messages:[{id:message.metadata.id}],resultSizeEstimate:1});if(parsed.pathname.endsWith('/messages/'+message.metadata.id))return Response.json(parsed.searchParams.get('format')==='raw'?{id:message.metadata.id,threadId:message.metadata.threadId,raw:message.mime.toString('base64url')}:message.metadata);return providerFixture(url,options);};
 const f=await fixture(t,provider),page=await f.run(f.request('resource_list',{store_key:'drafts',resource_key:'inbox',cursor:null,limit:25,query:'in:inbox'})),source={resource_key:'inbox',record_id:page.items[0].record_id,content_digest:page.items[0].content_digest};
 const initial={...empty,mode:'reply',to:'',subject:'',body:'',record_seed:{schema_version:'deft.email_reply_seed.v1',source}};
 const seedRequest=()=>f.request('connection_metadata',{store_key:'drafts',seed:{operation_key:'record_seed',destination_store_key:'drafts',value:initial}}),before=await f.run(f.request('record_list',{store_key:'drafts',cursor:null,limit:25}));
 const opened=await f.run(seedRequest());assert.match(opened.record_seed_value.body,/> /);assert.equal(opened.record_seed_value.mode,'reply');assert.ok(opened.record_seed_value.record_seed.source_digest);assert.equal((await f.run(f.request('record_list',{store_key:'drafts',cursor:null,limit:25}))).items.length,before.items.length);
 const edited={...opened.record_seed_value,to:'edited@example.test',subject:'User subject',body:'User exact edited body',author_note:'Private note'},created=await f.run(f.request('record_create',{store_key:'drafts',record_id:randomUUID(),value:edited}));
 assert.equal(created.record.value.to,edited.to);assert.equal(created.record.value.subject,edited.subject);assert.equal(created.record.value.body,edited.body);assert.equal(created.record.value.author_note,edited.author_note);assert.equal(created.record.value.record_seed,undefined);assert.deepEqual(created.record.source_refs,[source]);
 const changed=structuredClone(edited);changed.record_seed.source.content_digest='sha256:'+'f'.repeat(64);await assert.rejects(f.run(f.request('record_create',{store_key:'drafts',record_id:randomUUID(),value:changed})),error=>error.code==='EMAIL_DATA_SOURCE_CHANGED');
 const changedMode={...edited,mode:'forward'};await assert.rejects(f.run(f.request('record_create',{store_key:'drafts',record_id:randomUUID(),value:changedMode})),error=>error.code==='EMAIL_DATA_SOURCE_CHANGED');
 const changedSource=structuredClone(edited);changedSource.record_seed.source_digest='sha256:'+'f'.repeat(64);await assert.rejects(f.run(f.request('record_create',{store_key:'drafts',record_id:randomUUID(),value:changedSource})),error=>error.code==='EMAIL_DATA_SOURCE_CHANGED');
 f.deny();await assert.rejects(f.run(seedRequest()),/revoked/);await assert.rejects(f.run(f.request('record_create',{store_key:'drafts',record_id:randomUUID(),value:edited})),/revoked/);
});


test('reply seed read: warm presentation opens with its original quote under two seconds across slow fresh authority checks',async t=>{
 const message=dataFixtureMessage('fixture@example.test');let tracing=false,authorityCalls=0,rawReads=0;
 const provider=(url,options)=>{const parsed=new URL(url);if(parsed.pathname.endsWith('/messages'))return Response.json({messages:[{id:message.metadata.id}],resultSizeEstimate:1});if(parsed.pathname.endsWith('/messages/'+message.metadata.id)){if(parsed.searchParams.get('format')==='raw'){rawReads++;return Response.json({id:message.metadata.id,threadId:message.metadata.threadId,raw:message.mime.toString('base64url')});}return Response.json(message.metadata);}return providerFixture(url,options);};
 const f=await fixture(t,provider,{onAuthority:async input=>{if(tracing&&input.operation==='connection_metadata'){authorityCalls++;await new Promise(resolve=>setTimeout(resolve,350));}}});
 const page=await f.run(f.request('resource_list',{store_key:'drafts',resource_key:'inbox',cursor:null,limit:25,query:'in:inbox'})),source={resource_key:'inbox',record_id:page.items[0].record_id,content_digest:page.items[0].content_digest};
 const presentationRequest=f.request('resource_read_presentation',{store_key:'drafts',...source}),presentation=await f.run(presentationRequest),seed=f.request('connection_metadata',{store_key:'drafts',seed:{operation_key:'record_seed',destination_store_key:'drafts',value:{mode:'reply',to:'',cc:'',bcc:'',subject:'',body:'',body_html:'',reply_record_id:'',attachments:[],author_note:'',record_seed:{schema_version:'deft.email_reply_seed.v1',source}}}});seed.authority=presentationRequest.authority;
 const before=rawReads,started=performance.now();tracing=true;const opened=await f.run(seed);tracing=false;const elapsed=performance.now()-started;
 assert.match(opened.record_seed_value.body,/> /);assert.equal(opened.record_seed_value.record_seed.source_digest,presentation.presentation.source_digest);console.log(JSON.stringify({event:'reply_seed_latency_characterization',elapsed_ms:Math.round(elapsed),authorityCalls,repeatSourceReads:rawReads-before}));
 assert.equal(authorityCalls,3,'fresh entry, session acquisition and final disclosure remain online');assert.equal(rawReads-before,0,'a just-read exact source is reused as data, never as authority');assert.ok(elapsed<2000,`warm seed took ${Math.round(elapsed)}ms`);
 const local={org_id:seed.scope.org_id,owner_user_id:seed.scope.owner_user_id,account_id:seed.connection.account_ref};assert.equal((await f.runtime.drafts.list(local,{cursor:null,limit:25},()=>{})).items.length,0);
 authorityCalls=0;const cold=structuredClone(seed);cold.request_id=randomUUID();cold.authority.consent_id=randomUUID();const rawBeforeCold=rawReads,coldStarted=performance.now();tracing=true;const coldOpened=await f.run(cold);tracing=false;const coldElapsed=performance.now()-coldStarted;
 assert.deepEqual(coldOpened.record_seed_value,opened.record_seed_value);assert.equal(authorityCalls,4,'a cold source retains its fresh pre-provider boundary');assert.equal(rawReads-rawBeforeCold,1);assert.ok(coldElapsed<2000,`cold seed took ${Math.round(coldElapsed)}ms`);assert.equal((await f.runtime.drafts.list(local,{cursor:null,limit:25},()=>{})).items.length,0);
 console.log(JSON.stringify({event:'reply_seed_cold_latency',elapsed_ms:Math.round(coldElapsed),authorityCalls,repeatSourceReads:rawReads-rawBeforeCold}));
});


test('reply seed read: memo keeps final source, custody, session, revocation, cancellation and expiry fences',async t=>{
 for(const scenario of ['source','custody','session','revoke','abort','expiry']){
  const message=dataFixtureMessage('fixture@example.test');let checkSeed=false,checks=0,rawReads=0,hook=async()=>{};
  const provider=(url,options)=>{const parsed=new URL(url);if(parsed.pathname.endsWith('/messages'))return Response.json({messages:[{id:message.metadata.id}],resultSizeEstimate:1});if(parsed.pathname.endsWith('/messages/'+message.metadata.id)){if(parsed.searchParams.get('format')==='raw'){rawReads++;return Response.json({id:message.metadata.id,threadId:message.metadata.threadId,raw:message.mime.toString('base64url')});}return Response.json(message.metadata);}return providerFixture(url,options);};
  const f=await fixture(t,provider,{onAuthority:async input=>{if(checkSeed&&input.operation==='connection_metadata'){checks++;await hook(input);}}}),page=await f.run(f.request('resource_list',{store_key:'drafts',resource_key:'inbox',cursor:null,limit:25,query:'in:inbox'})),source={resource_key:'inbox',record_id:page.items[0].record_id,content_digest:page.items[0].content_digest};
  const view=f.request('resource_read_presentation',{store_key:'drafts',...source});await f.run(view);const seed=f.request('connection_metadata',{store_key:'drafts',seed:{operation_key:'record_seed',destination_store_key:'drafts',value:{mode:'reply',to:'',cc:'',bcc:'',subject:'',body:'',body_html:'',reply_record_id:'',attachments:[],record_seed:{schema_version:'deft.email_reply_seed.v1',source}}}});seed.authority=view.authority;
  const local={org_id:seed.scope.org_id,owner_user_id:seed.scope.owner_user_id,account_id:seed.connection.account_ref},controller=new AbortController();
  hook=async input=>{if(scenario==='revoke'&&checks===2)f.deny();if(checks!==3)return;if(scenario==='source')await f.runtime.mailbox.invalidateContent(local,()=>{});if(scenario==='custody')await f.runtime.custody.withAccount(f.binding,tx=>tx.advanceSetup());if(scenario==='account_switch')await f.store.withLock({key:'email.runtime.session.'+input.connection.session_id},async tx=>{const row=await tx.read(),account_ref=randomUUID();await tx.compareAndSwap({expected_revision:row.revision,value:{...row.value,account:{...row.value.account,account_ref},binding:{...row.value.binding,account_id:account_ref}}});});
   if(scenario==='session')await f.store.withLock({key:'email.runtime.session.'+seed.connection.session_id},async tx=>{const row=await tx.read();await tx.compareAndSwap({expected_revision:row.revision,value:{...row.value,state:'revoked'}});});if(scenario==='abort')controller.abort(Error('synthetic opening cancelled'));if(scenario==='expiry')input.expires_at=new Date(Date.now()-1).toISOString();};
  const before=rawReads;checkSeed=true;await assert.rejects(f.run(seed,controller.signal),undefined,scenario);assert.equal(rawReads,before,scenario+' cannot repeat provider work or disclose a cached source');assert.equal((await f.runtime.drafts.list(local,{cursor:null,limit:25},()=>{})).items.length,0,scenario+' must not create a draft');
 }
});


test('reply seed read: exact plain and HTML attachment presentations support every mode with freshly repeated authority',async t=>{
 for(const kind of ['plain','html_with_attachment']){
  const message=dataFixtureMessage('fixture@example.test');if(kind==='plain')message.mime=Buffer.from('From: sender@example.test\r\nTo: fixture@example.test\r\nCc: peer@example.test\r\nSubject: Synthetic plain source\r\nMessage-ID: <first-source@example.test>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nFirst exact plain line\r\nSecond original line');let rawReads=0,authorityCalls=0;
  const provider=(url,options)=>{const parsed=new URL(url);if(parsed.pathname.endsWith('/messages'))return Response.json({messages:[{id:message.metadata.id}],resultSizeEstimate:1});if(parsed.pathname.endsWith('/messages/'+message.metadata.id)){if(parsed.searchParams.get('format')==='raw'){rawReads++;return Response.json({id:message.metadata.id,threadId:message.metadata.threadId,raw:message.mime.toString('base64url')});}return Response.json(message.metadata);}return providerFixture(url,options);};
  const f=await fixture(t,provider,{onAuthority:async input=>{if(input.operation==='connection_metadata')authorityCalls++;}}),page=await f.run(f.request('resource_list',{store_key:'drafts',resource_key:'inbox',cursor:null,limit:25,query:'in:inbox'})),source={resource_key:'inbox',record_id:page.items[0].record_id,content_digest:page.items[0].content_digest},view=f.request('resource_read_presentation',{store_key:'drafts',...source}),presentation=await f.run(view);
  assert.equal(presentation.files.filter(file=>file.disposition==='attachment').length,kind==='plain'?0:1);const before=rawReads;
  for(const mode of ['reply','reply_all','forward']){const seed=f.request('connection_metadata',{store_key:'drafts',seed:{operation_key:'record_seed',destination_store_key:'drafts',value:{mode,to:'',cc:'',bcc:'',subject:'',body:'',body_html:'',reply_record_id:'',attachments:[],record_seed:{schema_version:'deft.email_reply_seed.v1',source}}}});seed.authority=view.authority;const checks=authorityCalls,opened=(await f.run(seed)).record_seed_value;
   assert.equal(authorityCalls-checks,3,'data reuse never replaces a fresh authority check');assert.equal(opened.mode,mode);assert.equal(opened.record_seed.mode,mode);assert.equal(opened.record_seed.source_digest,presentation.presentation.source_digest);assert.equal(opened.to,mode==='forward'?'':'sender@example.test');assert.equal(opened.cc,mode==='reply_all'?'peer@example.test':'');assert.deepEqual(opened.attachments,[]);assert.match(opened.body,kind==='plain'?/First exact plain line\n(?:> )?Second original line/:/Native first body/);assert.equal(rawReads,before,'all modes use the current exact source presentation');
  }
  const local={org_id:view.scope.org_id,owner_user_id:view.scope.owner_user_id,account_id:view.connection.account_ref};assert.equal((await f.runtime.drafts.list(local,{cursor:null,limit:25},()=>{})).items.length,0);
 }
});

const compoundSeedPins=request=>({account_ref:request.connection.account_ref,target_key:request.scope.target_key,...request.authority});
const compoundSeedInput=(record_id,value)=>({store_key:'drafts',seed:{operation_key:'record_seed_snapshot',destination_store_key:'drafts',value:{schema_version:'deft.record_seed_snapshot_request.v1',record_id,value}}});
async function compoundSeedFixture(t,{kind='html_with_attachment',onAuthority=async()=>{}}={}){
 const message=dataFixtureMessage('fixture@example.test');
 if(kind==='plain')message.mime=Buffer.from('From: sender@example.test\r\nTo: fixture@example.test\r\nCc: peer@example.test\r\nSubject: Synthetic plain source\r\nMessage-ID: <first-source@example.test>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nFirst exact plain line\r\nSecond original line');
 if(kind==='html')message.mime=Buffer.from('From: sender@example.test\r\nTo: fixture@example.test\r\nSubject: Synthetic HTML source\r\nMessage-ID: <first-source@example.test>\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Native first body</p>');
 let rawReads=0;
 const provider=(url,options)=>{const parsed=new URL(url);if(parsed.pathname.endsWith('/messages'))return Response.json({messages:[{id:message.metadata.id}],resultSizeEstimate:1});if(parsed.pathname.endsWith('/messages/'+message.metadata.id)){if(parsed.searchParams.get('format')==='raw'){rawReads++;return Response.json({id:message.metadata.id,threadId:message.metadata.threadId,raw:message.mime.toString('base64url')});}return Response.json(message.metadata);}return providerFixture(url,options);};
 const f=await fixture(t,provider,{onAuthority}),page=await f.run(f.request('resource_list',{store_key:'drafts',resource_key:'inbox',cursor:null,limit:25,query:'in:inbox'})),source={resource_key:'inbox',record_id:page.items[0].record_id,content_digest:page.items[0].content_digest},view=f.request('resource_read_presentation',{store_key:'drafts',...source});view.authority={...view.authority,consent_id:null,consent_digest:null};const presentation=await f.run(view);
 const seed=mode=>({mode,to:'',cc:'',bcc:'',subject:'',body:'',body_html:'',reply_record_id:'',attachments:[],record_seed:{schema_version:'deft.email_reply_seed.v1',source}});
 const request=(id,value)=>{const result=f.request('connection_metadata',compoundSeedInput(id,value));result.authority.data_policy_digest=view.authority.data_policy_digest;result.input.seed.value.expected=compoundSeedPins(result);return result;};
 return {...f,baseRequest:f.request,get runtime(){return f.runtime;},request,seed,source,presentation,readerAuthority:view.authority,local:{org_id:view.scope.org_id,owner_user_id:view.scope.owner_user_id,account_id:view.connection.account_ref},get rawReads(){return rawReads;}};
}

test('reply seed read: compound snapshot combines exact destination existence and quoted seed without a write',async t=>{
 const f=await fixture(t),id=randomUUID(),request=f.request('connection_metadata',compoundSeedInput(id,{...empty,to:'',subject:'',body:''})),opened=await f.run(request);
 assert.deepEqual(opened.record_seed_value,{schema_version:'deft.record_seed_snapshot.v1',record_id:id,account_ref:request.connection.account_ref,record:null,value:{...empty,to:'',subject:'',body:''}});
 const local={org_id:request.scope.org_id,owner_user_id:request.scope.owner_user_id,account_id:request.connection.account_ref};
 assert.equal((await f.runtime.drafts.list(local,{cursor:null,limit:25},()=>{})).items.length,0);
 const denied=f.request('connection_metadata',compoundSeedInput(randomUUID(),{...empty,to:'',subject:'',body:''}));denied.authority={...denied.authority,consent_id:null,consent_digest:null};
 await assert.rejects(f.run(denied),{code:'EMAIL_DATA_AUTHORITY_DENIED'});
 for(const field of ['account_ref','target_key','data_policy_digest','consent_id','consent_digest']){
  const mismatch=f.request('connection_metadata',compoundSeedInput(randomUUID(),{...empty,to:'',subject:'',body:''}));mismatch.input.seed.value.expected[field]=field.endsWith('digest')?'sha256:'+'f'.repeat(64):field==='target_key'?'different':randomUUID();
  const before=f.calls;await assert.rejects(f.run(mismatch),{code:'EMAIL_DATA_AUTHORITY_DENIED'});assert.equal(f.calls,before,field+' mismatch must prevent provider or record disclosure');
 }
});

test('reply seed read: actual Host null reader and consented compound snapshots keep slow online boundaries and first-save pins',async t=>{
 for(const kind of ['plain','html_with_attachment']){
  let armed=false,checks=0;const f=await compoundSeedFixture(t,{kind,onAuthority:async input=>{if(armed&&input.operation==='connection_metadata'){checks++;await new Promise(done=>setTimeout(done,350));}}});
  assert.equal(f.presentation.files.filter(file=>file.disposition==='attachment').length,kind==='plain'?0:1);
  for(const mode of ['reply','reply_all','forward']){
   const id=randomUUID(),request=f.request(id,f.seed(mode)),before=f.rawReads,start=performance.now();assert.equal(f.readerAuthority.consent_id,null);assert.equal(f.readerAuthority.consent_digest,null);assert.notEqual(request.authority.consent_id,null);assert.notEqual(request.authority.consent_digest,null);checks=0;armed=true;const result=(await f.run(request)).record_seed_value;armed=false;const elapsed=Math.round(performance.now()-start);
   assert.equal(result.record_id,id);assert.equal(result.account_ref,request.connection.account_ref);assert.equal(result.record,null);assert.equal(result.value.mode,mode);assert.equal(result.value.record_seed.mode,mode);assert.equal(result.value.record_seed.source_digest,f.presentation.presentation.source_digest);assert.match(result.value.body,kind==='plain'?/First exact plain line/:/Native first body/);assert.deepEqual(result.value.attachments,[]);assert.equal(checks,3);assert.equal(f.rawReads,before);assert.ok(elapsed<2000,`${kind} ${mode} warm snapshot ${elapsed}ms`);
   assert.equal((await f.runtime.drafts.list(f.local,{cursor:null,limit:25},()=>{})).items.length,0);
   if(mode==='reply'){const denied=f.request(randomUUID(),f.seed(mode));denied.authority={...denied.authority,consent_id:null,consent_digest:null};denied.input.seed.value.expected=compoundSeedPins(denied);await assert.rejects(f.run(denied),{code:'EMAIL_DATA_AUTHORITY_DENIED'});assert.equal(f.rawReads,before,'cached reader data cannot authorize a consentless snapshot');}
   console.log(JSON.stringify({event:'compound_seed_warm_latency',kind,mode,reader_has_draft_consent:false,snapshot_has_draft_consent:true,elapsed_ms:elapsed,authority_calls:checks,provider_calls:f.rawReads-before,draft_writes:0}));
  }
  await f.restart();const cold=f.request(randomUUID(),f.seed('reply'));cold.authority.consent_id=randomUUID();cold.input.seed.value.expected=compoundSeedPins(cold);checks=0;const before=f.rawReads,start=performance.now();armed=true;const opened=(await f.run(cold)).record_seed_value;armed=false;const elapsed=Math.round(performance.now()-start);assert.equal(checks,4);assert.equal(f.rawReads-before,1);assert.ok(elapsed<2000,`${kind} cold snapshot ${elapsed}ms`);console.log(JSON.stringify({event:'compound_seed_cold_latency',kind,elapsed_ms:elapsed,authority_calls:checks,provider_calls:f.rawReads-before,draft_writes:0}));
  const edited={...opened.value,to:'edited@example.test',subject:'Exact edited subject',body:'Exact edited body',body_html:'',author_note:'Exact private note'},id=cold.input.seed.value.record_id;
  for(const changed of [{...edited,mode:'forward'},{...edited,record_seed:{...edited.record_seed,source_digest:'sha256:'+'f'.repeat(64)}},{...edited,record_seed:{...edited.record_seed,source:{...f.source,content_digest:'sha256:'+'f'.repeat(64)}}}])await assert.rejects(f.run(f.baseRequest('record_create',{store_key:'drafts',record_id:id,value:changed})),{code:'EMAIL_DATA_SOURCE_CHANGED'});
  const created=await f.run(f.baseRequest('record_create',{store_key:'drafts',record_id:id,value:edited}));assert.equal(created.record.revision,1);assert.deepEqual(created.record.source_refs,[f.source]);assert.equal(created.record.value.body,edited.body);assert.equal(created.record.value.author_note,edited.author_note);assert.equal(created.record.value.record_seed,undefined);
 }
});


test('reply seed read: compound existing saved record wins with files and source references and no original hydration',async t=>{
 const f=await compoundSeedFixture(t),id=randomUUID(),opened=(await f.run(f.request(id,f.seed('reply')))).record_seed_value;
 let record=(await f.run(f.baseRequest('record_create',{store_key:'drafts',record_id:id,value:{...opened.value,subject:'Existing saved subject'}}))).record;
 const bytes=Buffer.from('fixture attachment'),file_id=randomUUID();record=(await f.run(f.baseRequest('file_upload',{store_key:'drafts',record_id:id,expected_revision:record.revision,expected_content_digest:record.content_digest,file_id,filename:'existing.txt',media_type:'text/plain',size_bytes:bytes.length,sha256:sha(bytes)}),undefined,bytes)).record;
 await f.restart();const before=f.rawReads,result=await f.run(f.request(id,{...f.seed('forward'),record_seed:{schema_version:'deft.email_reply_seed.v1',source:{...f.source,record_id:randomUUID(),content_digest:'sha256:'+'f'.repeat(64)}}}));
 assert.deepEqual(result.record_seed_value,{schema_version:'deft.record_seed_snapshot.v1',record_id:id,account_ref:f.baseRequest('record_read',{}).connection.account_ref,record,value:null});assert.equal(f.rawReads,before);assert.deepEqual(result.record_seed_value.record.source_refs,[f.source]);assert.equal(result.record_seed_value.record.files.length,1);assert.ok(result.identities.length);
});

test('reply seed read: compound final disclosure denies source custody session revoke cancel expiry and destination races',async t=>{
 for(const scenario of ['source','custody','session','revoke','abort','expiry','account','account_switch','created','saved','archived']){
  let armed=false,checks=0,hook=async()=>{};const f=await compoundSeedFixture(t,{onAuthority:async input=>{if(armed&&input.operation==='connection_metadata'){checks++;await hook(input);}}}),id=randomUUID(),controller=new AbortController();let saved;
  if(['saved','archived'].includes(scenario))saved=(await f.run(f.baseRequest('record_create',{store_key:'drafts',record_id:id,value:empty}))).record;
  hook=async input=>{if(scenario==='revoke'&&checks===2)f.deny();if(checks!==3)return;
   if(scenario==='source')await f.runtime.mailbox.invalidateContent(f.local,()=>{});
   if(scenario==='custody')await f.runtime.custody.withAccount(f.binding,tx=>tx.advanceSetup());
   if(scenario==='account_switch')await f.store.withLock({key:'email.runtime.session.'+input.connection.session_id},async tx=>{const row=await tx.read(),account_ref=randomUUID();await tx.compareAndSwap({expected_revision:row.revision,value:{...row.value,account:{...row.value.account,account_ref},binding:{...row.value.binding,account_id:account_ref}}});});
   if(scenario==='session')await f.store.withLock({key:'email.runtime.session.'+input.connection.session_id},async tx=>{const row=await tx.read();await tx.compareAndSwap({expected_revision:row.revision,value:{...row.value,state:'revoked'}});});
   if(scenario==='abort')controller.abort();if(scenario==='expiry')input.expires_at=new Date(Date.now()-1).toISOString();
   if(scenario==='created')await f.run(f.baseRequest('record_create',{store_key:'drafts',record_id:id,value:empty}));
   if(scenario==='archived')await f.run(f.baseRequest('record_archive',{store_key:'drafts',record_id:id,expected_revision:saved.revision}));
   if(scenario==='saved')await f.run(f.baseRequest('record_save',{store_key:'drafts',record_id:id,expected_revision:saved.revision,expected_content_digest:saved.content_digest,value:{...empty,subject:'Concurrent update'}}));
  };
  const before=f.rawReads,request=f.request(id,f.seed('reply'));if(scenario==='account')request.connection.account_ref=randomUUID();armed=true;await assert.rejects(f.run(request,controller.signal),undefined,scenario);assert.equal(f.rawReads,before,scenario+' cannot rehydrate or disclose');
 }
});

test('reply seed read: compound saved native record preserves reauth-required local access without provider permission',async t=>{
 const {importNativeIdentity,nativeAdoptionKey}=await import('./native-adoption-identity.mjs'),{writeNativeImportRow}=await import('./native-adoption-records.mjs'),{NATIVE_TABLES}=await import('./native-adoption-retained.mjs');
 const f=await fixture(t),id=randomUUID(),request=f.request('record_create',{store_key:'drafts',record_id:id,value:empty}),created=(await f.run(request)).record,scope={org_id:request.scope.org_id,owner_user_id:request.scope.owner_user_id,account_id:request.connection.account_ref},snapshot_digest='a'.repeat(64);
 const session=(await f.store.withLock({key:'email.runtime.session.'+request.connection.session_id},tx=>tx.read())).value,adoption_id=randomUUID();
 await importNativeIdentity(f.store,{scope,source_binding:f.binding,destination_binding:f.binding,snapshot_digest},()=>{});
 // The already-imported local reader uses the same operator-only identity,
 // complete-stage and active-session receipt fences as native activation.
 await writeNativeImportRow(f.store,nativeAdoptionKey(scope),{state:'staged_verified',snapshot_digest,adoption_id,source_manifest:Object.fromEntries(NATIVE_TABLES.map(table=>[table,{count:table==='email_accounts'?1:0,digest:'a'.repeat(64)}]))},()=>{});
 await writeNativeImportRow(f.store,'email.native.activation.'+digest(scope),{state:'active',admission:{snapshot_digest,adoption_id},session},()=>{});
 await f.runtime.custody.withAccount(f.binding,async tx=>{const row=tx.read();await tx.write({health:'reauth_required',secret:row.secret});});
 const before=f.calls,ordinary=await f.run(f.request('record_read',{store_key:'drafts',record_id:id}));assert.deepEqual(ordinary.record,created);
 const result=await f.run(f.request('connection_metadata',compoundSeedInput(id,{...empty,to:'',subject:'',body:''})));assert.deepEqual(result.record_seed_value.record,created);assert.equal(result.record_seed_value.value,null);assert.equal(f.calls,before,'native local access must never obtain a provider token');
 await assert.rejects(f.run(f.request('connection_metadata',compoundSeedInput(randomUUID(),{...empty,to:'',subject:'',body:''}))));
 await f.runtime.custody.withAccount(f.binding,async tx=>{const row=tx.read();await tx.write({health:'revoked',secret:{...row.secret,access_token:'discarded',refresh_token:'discarded',expires_at:0}});});await assert.rejects(f.run(f.request('connection_metadata',compoundSeedInput(id,empty))));assert.equal(f.calls,before);
});

test('reply seed read: actual reader quote handoff never drops the current policy or connection revision from the data key',async t=>{
 for(const changed of ['policy','session_revision']){
  let checks=0;const f=await compoundSeedFixture(t,{onAuthority:async input=>{if(input.operation==='connection_metadata')checks++;}}),request=f.request(randomUUID(),f.seed('reply'));
  // The test Host grants a distinct current pin. Its source must be read afresh
  // rather than borrowing data from the original reader's different context.
  if(changed==='policy')request.authority.data_policy_digest='sha256:'+'f'.repeat(64);else request.connection.session_revision++;
  request.input.seed.value.expected=compoundSeedPins(request);const before=f.rawReads,result=await f.run(request);
  assert.equal(checks,4);assert.equal(f.rawReads,before+1,changed+' must miss the exact reader data key');assert.match(result.record_seed_value.value.body,/Native first body/);
  assert.equal((await f.runtime.drafts.list(f.local,{cursor:null,limit:25},()=>{})).items.length,0);
 }
});


test('inflight data authority fresh opening calls stay independent and use per-dispatch deadline ceilings',async()=>{
 let clock=Date.now();const ends=[],request={scope:makeScope(),request_id:randomUUID(),connection:{},authority:{},operation:'connection_metadata',input:{},expires_at:new Date(clock+29000).toISOString()},checker=createDataChecker({request,now:()=>clock,assertCurrent:async input=>new Promise(resolve=>ends.push(expires_at=>resolve({...input,allowed:true,expires_at})))});
 try{
  assert.equal(typeof checker.checkFresh,'function');const first=checker.checkFresh(),second=checker.checkFresh();assert.equal(ends.length,2,'both independent checks dispatch before either completes');
  ends[1](new Date(clock+1000).toISOString());await second;assert.equal(checker.expires_at,clock+1000);
  ends[0](new Date(clock+2000).toISOString());await first;assert.equal(checker.expires_at,clock+1000,'late longer response cannot extend the shorter shared deadline');
  const final=checker.check();assert.equal(ends.length,3);ends[2](new Date(clock+1001).toISOString());await assert.rejects(final,{code:'EMAIL_DATA_AUTHORITY_DENIED'});
 }finally{checker.dispose();}
});

test('reply seed read: compound entry and admission start independently before private reads and retain final freshness',async t=>{
 let armed=false,calls=0;const pending=[],locks=[],writes=[],f=await fixture(t,providerFixture,{onAuthority:async(input,signal)=>{
  if(!armed)return;calls++;if(calls<=2)await new Promise((resolve,reject)=>{pending.push({resolve,reject,signal});signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
 },onStoreLock:key=>{if(armed)locks.push(key);},onStoreWrite:key=>{if(armed)writes.push(key);}}),request=f.request('connection_metadata',compoundSeedInput(randomUUID(),{...empty,to:'',subject:'',body:''})),before=f.calls;
 armed=true;const opening=f.run(request);opening.catch(()=>{});
 try{
  for(let i=0;i<100&&calls<2;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(calls,2,'admission must start while entry is still held');
  const opaque=key=>key.startsWith('email.runtime.session.')||key.startsWith('email.data.native_adoption.')||key.startsWith('email.native.activation.')||key.startsWith('email.native.continuity.');
  assert.ok(locks.length>0);assert.deepEqual(locks.filter(key=>!opaque(key)),[],'only opaque session/visibility capture before both checks');assert.equal(f.calls,before);assert.deepEqual(writes,[]);
  pending[1].resolve();await new Promise(resolve=>setTimeout(resolve,20));assert.equal(calls,2);assert.deepEqual(locks.filter(key=>!opaque(key)),[]);assert.equal(f.calls,before);
  pending[0].resolve();const result=await opening;assert.equal(calls,3,'entry admission and final disclosure all dispatch independently');assert.equal(result.record_seed_value.record,null);assert.equal(result.record_seed_value.value.body,'');assert.equal(f.calls,before);assert.deepEqual(writes,[]);
 }finally{armed=false;for(const call of pending)call.resolve();await Promise.allSettled([opening]);}
});


test('inflight data authority fresh opening calls fail closed on denial schema pins cancellation and shortened expiry',async()=>{
 for(const scenario of ['denied','schema','pins','ceiling','abort','expiry']){
  let clock=Date.now();const ends=[],controller=new AbortController(),request={scope:makeScope(),request_id:randomUUID(),connection:{},authority:{},operation:'connection_metadata',input:{},expires_at:new Date(clock+29000).toISOString()},checker=createDataChecker({request,signal:controller.signal,now:()=>clock,assertCurrent:async input=>new Promise(resolve=>ends.push(override=>resolve({...input,allowed:true,...override})))});
  try{
   const first=checker.checkFresh(),second=checker.checkFresh(),results=Promise.allSettled([first,second]);assert.equal(ends.length,2);
   ends[1]({expires_at:new Date(clock+100).toISOString()});await second;assert.equal(checker.expires_at,clock+100);
   if(scenario==='abort')controller.abort();if(scenario==='expiry')clock+=101;
   ends[0](scenario==='denied'?{allowed:false}:scenario==='schema'?{extra:true}:scenario==='pins'?{request_id:randomUUID()}:scenario==='ceiling'?{expires_at:new Date(clock+30000).toISOString()}:{});
   const settled=await results;assert.equal(settled[0].status,'rejected',scenario);assert.equal(checker.expires_at,Date.parse(request.expires_at)-28900,scenario+' cannot extend the narrowed deadline');
   if(['abort','expiry'].includes(scenario))assert.throws(checker.checkLocal);
  }finally{checker.dispose();}
 }
});

test('reply seed read: compound opening aborts and drains both fresh barriers before any private work on failure',async t=>{
 for(const scenario of ['entry','admission','schema','pins','session','abort','short_expiry','capture']){
  let armed=false,calls=0,settled=0,sessionReads=0;const pending=[],locks=[],writes=[],controller=new AbortController(),f=await fixture(t,providerFixture,{onAuthority:async(input,signal)=>{
   if(!armed)return;const call=++calls;if(call>2)return;
   try{return await new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});pending.push({resolve:override=>{signal.removeEventListener('abort',abort);resolve({...input,allowed:true,...override});}});});}finally{settled++;}
  },onStoreLock:key=>{if(!armed)return;locks.push(key);if(key.startsWith('email.runtime.session.')&&++sessionReads===2&&scenario==='capture')throw Object.assign(Error('capture denied'),{code:'EMAIL_DATA_CONNECTION_DENIED'});},onStoreWrite:key=>{if(armed)writes.push(key);}}),request=f.request('connection_metadata',compoundSeedInput(randomUUID(),{...empty,to:'',subject:'',body:''})),before=f.calls;
  armed=true;const opening=f.run(request,controller.signal);opening.catch(()=>{});
  try{
   for(let i=0;i<100&&calls<(scenario==='capture'?1:2);i++)await new Promise(resolve=>setTimeout(resolve,5));
   if(scenario!=='capture')assert.equal(calls,2,scenario);
   if(scenario==='entry')pending[0].resolve({allowed:false});
   if(scenario==='admission')pending[1].resolve({allowed:false});
   if(scenario==='schema')pending[0].resolve({extra:true});
   if(scenario==='pins')pending[1].resolve({connection:{...request.connection,account_ref:randomUUID()}});
   if(scenario==='session'){
    await f.store.withLock({key:'email.runtime.session.'+request.connection.session_id},async tx=>{const row=await tx.read();await tx.compareAndSwap({expected_revision:row.revision,value:{...row.value,state:'revoked'}});});for(const call of pending)call.resolve();
   }
   if(scenario==='abort')controller.abort();
   if(scenario==='short_expiry'){pending[1].resolve({expires_at:new Date(Date.now()+30).toISOString()});await new Promise(resolve=>setTimeout(resolve,50));pending[0].resolve();}
   await assert.rejects(opening,undefined,scenario);assert.equal(settled,calls,scenario+' drains every started guard');
   const opaque=key=>key.startsWith('email.runtime.session.')||key.startsWith('email.data.native_adoption.')||key.startsWith('email.native.activation.')||key.startsWith('email.native.continuity.');
   assert.deepEqual(locks.filter(key=>!opaque(key)),[],scenario+' prevents custody identity source saved record and file reads');assert.equal(f.calls,before);assert.deepEqual(writes,[]);
  }finally{armed=false;controller.abort();for(const call of pending)call.resolve();await Promise.allSettled([opening]);}
 }
});


test('whole-operation authority callbacks measure real transport for cold and warm New Reply Forward on three message types',async t=>{
 for(const kind of ['plain','html','html_with_attachment']){
  const samples=[];let callbacks=0,expectedScope;
  const current=createAuthorityClient({authority_url:'https://whole-operation-'+kind+'.test/api/app-data/runtime/authority',authority_token:'a'.repeat(43),onTiming:event=>samples.push(event),fetch:async(url,options)=>{
   callbacks++;const input=JSON.parse(options.body);expectedScope??=JSON.stringify(input.scope);
   assert.equal(JSON.stringify(input.scope),expectedScope);await new Promise(done=>setTimeout(done,5));return Response.json({...input,allowed:true});
  }});
  const f=await compoundSeedFixture(t,{kind,onAuthority:current});
  for(const mode of ['compose','reply','forward']){
   await f.restart();
   for(const cache of ['cold_runtime_cache','warm_runtime_cache']){
    if(cache==='warm_runtime_cache'&&mode!=='compose'){
     const reader=f.baseRequest('resource_read_presentation',{store_key:'drafts',...f.source});reader.authority={...f.readerAuthority};
     await f.run(reader);
    }
    const value=mode==='compose'?{...empty,to:'',subject:'',body:''}:f.seed(mode),request=f.request(randomUUID(),value);
    const before=callbacks,rawBefore=f.rawReads,sampleBefore=samples.length,start=performance.now(),opened=(await f.run(request)).record_seed_value;
    const elapsed_ms=Math.round((performance.now()-start)*100)/100,actual=samples.slice(sampleBefore),expected=mode!=='compose'&&cache==='cold_runtime_cache'?4:3;
    assert.equal(opened.value.mode,mode);assert.equal(opened.record,null);assert.equal(callbacks-before,expected);assert.equal(actual.length,expected);
    assert.ok(actual.every(event=>event.dispatched&&event.outcome==='completed'));
    assert.equal(f.rawReads-rawBefore,expected===4?1:0);
    const sorted=actual.map(event=>event.elapsed_ms).sort((a,b)=>a-b);
    console.log(JSON.stringify({event:'whole_operation_authority_measurement',kind,mode,cache,elapsed_ms,authority_callbacks:actual.length,authority_p95_ms:sorted[Math.ceil(sorted.length*0.95)-1],provider_source_reads:f.rawReads-rawBefore,draft_writes:0}));
   }
  }
  assert.equal((await f.runtime.drafts.list(f.local,{cursor:null,limit:25},()=>{})).items.length,0);
 }
});

test('whole-operation authority callbacks retain final revocation epoch owner replay and response-field boundaries on warm data',async t=>{
 for(const scenario of ['revoke','epoch','owner','replay','field_insertion']){
  let armed=false,calls=0,prior;
  const current=createAuthorityClient({authority_url:'https://whole-operation-fence-'+scenario+'.test/api/app-data/runtime/authority',authority_token:'b'.repeat(43),onTiming:()=>{},fetch:async(url,options)=>{
   const input=JSON.parse(options.body),result={...input,allowed:true};if(!armed){prior=structuredClone(result);return Response.json(result);}
   if(++calls===3){
    if(scenario==='revoke')return Response.json({error:'synthetic revoked'},{status:403});
    if(scenario==='epoch')result.scope={...result.scope,grant_epoch:result.scope.grant_epoch+1};
    if(scenario==='owner')result.scope={...result.scope,owner_user_id:randomUUID()};
    if(scenario==='replay')return Response.json(prior);
    if(scenario==='field_insertion')result.future_authority=true;
   }
   return Response.json(result);
  }});
  const f=await compoundSeedFixture(t,{onAuthority:current});
  await f.run(f.request(randomUUID(),f.seed('reply')));
  const before=f.rawReads;armed=true;
  await assert.rejects(f.run(f.request(randomUUID(),f.seed('forward'))));assert.equal(calls,3);assert.equal(f.rawReads,before);
  assert.equal((await f.runtime.drafts.list(f.local,{cursor:null,limit:25},()=>{})).items.length,0);
 }
});
