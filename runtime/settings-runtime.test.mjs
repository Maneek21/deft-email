import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {createHttpHandler} from './http.mjs';
import {createDurableStore} from './durable-store.mjs';
import {createConnectionRuntime} from './connection-runtime.mjs';
import {createDataRuntime} from './data-runtime.mjs';
import {makeScope,registrationFor,client,providerFixture,authority,beginFor,nextFor} from './test-support.mjs';
async function fixture(t){
 const parent=await mkdtemp(join(tmpdir(),'email-settings-')),root=join(parent,'state'),key=Buffer.alloc(32,23),scope=makeScope(),registration=registrationFor(scope);let store,calls=0,allowed=true,lose=false;
 const open=()=>createDurableStore({root,encryption_key:key,key_id:'settings-fixture',allow_windows_fixture:process.platform==='win32'});store=await open();
 const fetch=async(...args)=>{calls++;return providerFixture(...args);},connection=createConnectionRuntime({registration,client,store,encryption_key:key,key_id:'settings-fixture',assertCurrent:authority,fetch}),begin=beginFor(scope),begun=await connection.request(begin),connected=await connection.request(nextFor(begin,begun,'callback'));
 const wrapped={withLock(options,work){return store.withLock(options,tx=>work({...tx,async compareAndSwap(input){if(lose&&input.value.schema_version==='email.app_mutation.v1'&&input.value.state==='completed'){lose=false;throw Error('synthetic lost response journal');}return tx.compareAndSwap(input);}}));}};
 const consents=Object.fromEntries(['templates','signatures'].map(key=>[key,{consent_id:randomUUID(),consent_digest:'sha256:'+(key==='templates'?'a':'b').repeat(64),data_policy_digest:'sha256:'+'e'.repeat(64)}]));
 const dependencies=()=>({registrations:[registration],client,store:wrapped,encryption_key:key,key_id:'settings-fixture',fetch,assertCurrent:async input=>{if(!allowed)throw Error('synthetic actor denied');if(!Object.values(consents).some(consent=>JSON.stringify(consent)===JSON.stringify(input.authority)))throw Error('synthetic store consent denied');return {...input,allowed:true};}});let runtime=createDataRuntime(dependencies());
 t.after(async()=>{await store.close();await rm(parent,{recursive:true,force:true});});
 return {root,scope,get runtime(){return runtime;},request:(operation,input)=>({schema_version:'deft.app_data_runtime.v1',request_id:randomUUID(),scope,connection:{session_id:begin.session_id,session_revision:5,runtime_session_ref:begun.runtime_session_ref,account_ref:connected.account.account_ref},authority:consents[input.store_key]??consents.templates,operation,expires_at:new Date(Date.now()+29000).toISOString(),input}),run:(...args)=>runtime.request(...args),get calls(){return calls;},lose(){lose=true;},deny(){allowed=false;},async restart(){await store.close();store=await open();runtime=createDataRuntime(dependencies());}};
}
const cas=row=>({expected_revision:row.revision,expected_content_digest:row.content_digest});
test('actual encrypted full native template CRUD/readback/restart retains exact rich value and CAS; no provider effects',async t=>{
 const f=await fixture(t),id=randomUUID(),text='z'.repeat(245670),value={title:'Actual title',subject:'Independent subject',body:text,body_html:'<p>'+text+'</p>'};
 const create=f.request('record_create',{store_key:'templates',record_id:id,value}),created=await f.run(create);assert.equal(created.record.revision,1);assert.deepEqual(created.record.value,value);assert.equal(created.record.store_key,'templates');assert.deepEqual(created.record.files,[]);
 assert.deepEqual((await f.run(create)).record,created.record);assert.equal(f.calls,3);
 const save=f.request('record_save',{store_key:'templates',record_id:id,...cas(created.record),value:{...value,title:'Changed title'}}),saved=await f.run(save);assert.equal(saved.record.content_revision,2);
 const stale=await f.run(f.request('record_save',{...save.input,value}));assert.equal(stale.outcome,'conflict');
 await f.restart();assert.deepEqual((await f.run(f.request('record_read',{store_key:'templates',record_id:id}))).record,saved.record);
 const list=await f.run(f.request('record_list',{store_key:'templates',cursor:null,limit:25}));assert.equal(list.items[0].summary.title,'Changed title');assert.equal(Object.hasOwn(list.items[0],'value'),false);
 await f.run(f.request('record_archive',{store_key:'templates',record_id:id,...cas(saved.record)}));assert.deepEqual((await f.run(f.request('record_list',{store_key:'templates',cursor:null,limit:25}))).items,[]);assert.equal(f.calls,3);
 for(const name of await readdir(f.root))if(name.endsWith('.json'))assert.ok(!(await readFile(join(f.root,name),'utf8')).includes('Changed title'));
});
test('lost settings save acknowledgement recovers only original UUID/store via durable receipt after restart',async t=>{
 const f=await fixture(t),id=randomUUID(),value={title:'Before',subject:'Synthetic',body:'Exact\n\nTail ',body_html:''};let row=(await f.run(f.request('record_create',{store_key:'templates',record_id:id,value}))).record;
 const save=f.request('record_save',{store_key:'templates',record_id:id,...cas(row),value:{...value,title:'After'}});f.lose();await assert.rejects(f.run(save));assert.equal((await f.run(save)).outcome,'indeterminate');await f.restart();
 const status=await f.run(f.request('request_status',{store_key:'templates',request_id:save.request_id}));assert.equal(status.request_status.state,'completed');assert.equal(status.request_status.revision,2);
 row=(await f.run(f.request('record_read',{store_key:'templates',record_id:id}))).record;assert.equal(row.value.title,'After');assert.equal(row.value.body,value.body);assert.equal(row.revision,2);
 await assert.rejects(f.run(f.request('request_status',{store_key:'signatures',request_id:save.request_id})),error=>error.code==='EMAIL_DATA_AUTHORITY_DENIED');assert.equal(f.calls,3);
});
test('current verified sender identity, owner/account/store consent and expiry guard all settings; unsupported files/stores deny',async t=>{
 const f=await fixture(t),id=randomUUID(),value={address:'fixture@example.test',plain:'Signed',html:'<p>Signed</p>',placement:'reply'};
 const row=(await f.run(f.request('record_create',{store_key:'signatures',record_id:id,value}))).record;assert.equal(row.revision,1);assert.equal(row.value.address,value.address);
 await assert.rejects(f.run(f.request('record_create',{store_key:'signatures',record_id:randomUUID(),value:{...value,address:'foreign@example.test'}})),error=>error.code==='EMAIL_SETTINGS_IDENTITY_DENIED');
 const foreign=f.request('record_read',{store_key:'signatures',record_id:id});foreign.connection.account_ref=randomUUID();await assert.rejects(f.run(foreign));
 const actor=f.request('record_read',{store_key:'signatures',record_id:id});actor.scope.owner_user_id=randomUUID();await assert.rejects(f.run(actor));
 const consent=f.request('record_read',{store_key:'signatures',record_id:id});consent.authority.consent_digest='sha256:'+'f'.repeat(64);await assert.rejects(f.run(consent));
 const expired=f.request('record_read',{store_key:'signatures',record_id:id});expired.expires_at=new Date(Date.now()-1).toISOString();await assert.rejects(f.run(expired));
 await assert.rejects(f.run(f.request('connection_metadata',{store_key:'undeclared_store'})));await assert.rejects(f.run(f.request('file_read',{store_key:'signatures',record_id:id,file_id:randomUUID(),upload_revision:1,sha256:'sha256:'+'a'.repeat(64)})));
 f.deny();await assert.rejects(f.run(f.request('record_read',{store_key:'signatures',record_id:id})));assert.equal(f.calls,3);
});
test('existing public HTTP data transport creates/reads settings and retains authentication gate',async t=>{
 const f=await fixture(t),token='T'.repeat(43),server=createServer(createHttpHandler({runtime_auth_token:token,runtime:{request(){throw Error('connections not in proof');}},data_runtime:f.runtime}));await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>server.close(done)));
 const url='http://127.0.0.1:'+server.address().port+'/v1/data',post=(input,authorized=true)=>fetch(url,{method:'POST',headers:{'content-type':'application/json',...(authorized?{authorization:'Bearer '+token}:{})},body:JSON.stringify(input)});
 const id=randomUUID(),value={title:'HTTP title',subject:'HTTP subject',body:'Controlled content',body_html:'<p>Controlled content</p>'},create=f.request('record_create',{store_key:'templates',record_id:id,value});
 assert.equal((await post(create,false)).status,401);const response=await post(create);assert.equal(response.status,200);assert.deepEqual((await response.json()).record.value,value);
 const read=await post(f.request('record_read',{store_key:'templates',record_id:id}));assert.equal(read.status,200);assert.deepEqual((await read.json()).record.value,value);assert.equal(f.calls,3);
});
