import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createDurableStore} from './durable-store.mjs';
import {createMailboxStore,resourceView} from './mailbox-store.mjs';
import {createConnectionRuntime} from './connection-runtime.mjs';
import {createDataRuntime} from './data-runtime.mjs';
import {makeScope,registrationFor,client,authority,beginFor,nextFor,providerFixture,dataFixtureMessage} from './test-support.mjs';
const scope=()=>({org_id:randomUUID(),owner_user_id:randomUUID(),account_id:randomUUID()});
const page=(s,start=0,count=25)=>({items:Array.from({length:count},(_,n)=>({account_id:s.account_id,logical_message_id:'mail_'+(start+n).toString(16).padStart(64,'0'),revision:'1',data:{label:'Synthetic '+(start+n)},provider_source:{provider:'gmail'},folders:['inbox'],flags:{},received_at:'2026-10-09T00:00:00Z'})),tombstones:[],state_updates:[{state_key:'synthetic',generation:'g'+start,value:{cursor:start}}],observed_at:'2026-10-09T00:00:00Z',complete:true,next_cursor:null});
async function fixture(t){const parent=await mkdtemp(join(tmpdir(),'email-batch-')),store=await createDurableStore({root:join(parent,'private'),encryption_key:Buffer.alloc(32,45),key_id:'synthetic-batch',allow_windows_fixture:process.platform==='win32'});t.after(async()=>{await store.close();await rm(parent,{recursive:true,force:true});});return store;}
test('25 row projection keeps exact IDs/digests with three fresh batch authority checks',async t=>{
 const store=await fixture(t),mailbox=createMailboxStore({store}),s=scope();let online=0,local=0;
 const result=await mailbox.commit(s,page(s),async()=>{online++;},{localCheck:()=>{local++;},include_items:true});
 assert.equal(online,3);assert.equal(local,100);assert.equal(result.items.length,25);
 for(const item of result.items)assert.deepEqual(item,resourceView(await mailbox.get(s,item.record_id,async()=>{})));
});
test('revocation during row writes denies disclosure and checkpoint advancement; future reads require current authority',async t=>{
 const store=await fixture(t),mailbox=createMailboxStore({store}),s=scope();let allowed=true,written=0;
 const tracked={withLock(options,work){return store.withLock(options,tx=>work({...tx,async compareAndSwap(input){const result=await tx.compareAndSwap(input);if(input.value.schema_version==='email.app_mail_resource.v1'&&++written===3)allowed=false;return result;}}));}};
 const guarded=createMailboxStore({store:tracked}),check=async()=>{if(!allowed)throw Error('SYNTHETIC_REVOKED');};
 await assert.rejects(guarded.commit(s,page(s),check,{localCheck:()=>{},include_items:true}),/SYNTHETIC_REVOKED/);
 await assert.rejects(mailbox.list(s,{limit:25},check),/SYNTHETIC_REVOKED/);
 allowed=true;const list=await mailbox.list(s,{limit:25},check);assert.equal(list.items.length,0);assert.equal(list.freshness.checkpoint_generation,1);assert.equal(list.freshness.complete,false);
});
test('expired local fence stops a batch before checkpoint writes',async t=>{
 const store=await fixture(t),mailbox=createMailboxStore({store}),s=scope();let checks=0;
 await assert.rejects(mailbox.commit(s,page(s),async()=>{},{localCheck:()=>{if(++checks===8)throw Error('SYNTHETIC_EXPIRED');},include_items:true}),/SYNTHETIC_EXPIRED/);
 const list=await mailbox.list(s,{limit:25},async()=>{});assert.equal(list.items.length,0);assert.equal(list.freshness.complete,false);
});
test('batch rejects foreign provider rows and existing cache scope drift',async t=>{
 const store=await fixture(t),mailbox=createMailboxStore({store}),s=scope(),p=page(s,0,1);
 await assert.rejects(mailbox.commit(s,{...p,items:[{...p.items[0],account_id:randomUUID()}]},async()=>{},{localCheck:()=>{},include_items:true}),error=>error.code==='EMAIL_DATA_RESOURCE_INVALID');
 await mailbox.commit(s,p,async()=>{});
 const altered={withLock(options,work){return store.withLock(options,tx=>work({...tx,async read(){const row=await tx.read();return row?.value.schema_version==='email.app_mail_resource.v1'?{...row,value:{...row.value,scope:{...s,owner_user_id:randomUUID()}}}:row;}}));}};
 await assert.rejects(createMailboxStore({store:altered}).commit(s,p,async()=>{},{localCheck:()=>{},include_items:true}),error=>error.code==='EMAIL_DATA_AUTHORITY_DENIED');
});
test('concurrent batches read the current checkpoint under its lock and retain both pages',async t=>{
 const store=await fixture(t),mailbox=createMailboxStore({store}),s=scope();let entered,release;const ready=new Promise(r=>entered=r),pause=new Promise(r=>release=r);let first=true;
 const one=mailbox.commit(s,page(s,0,2),async()=>{if(first){first=false;entered();await pause;}},{localCheck:()=>{},include_items:true});await ready;
 let twoEntered=false;const two=mailbox.commit(s,page(s,2,2),async()=>{twoEntered=true;},{localCheck:()=>{},include_items:true});await new Promise(r=>setTimeout(r,20));assert.equal(twoEntered,false);release();
 const [a,b]=await Promise.all([one,two]);assert.equal(a.freshness.checkpoint_generation,2);assert.equal(b.freshness.checkpoint_generation,3);
 const list=await mailbox.list(s,{limit:25},async()=>{});assert.equal(list.items.length,4);assert.equal(list.freshness.checkpoint_generation,3);
});
test('real runtime synthetic 25-message list reduces authority amplification with unchanged provider guards',async t=>{
 const store=await fixture(t),s=makeScope(),registration=registrationFor(s),encryption_key=Buffer.alloc(32,45);let checks=0,providerCalls=0;
 const fetch=async(url,options)=>{providerCalls++;const parsed=new URL(url);if(parsed.pathname.endsWith('/messages'))return Response.json({messages:Array.from({length:25},(_,i)=>({id:'synthetic-'+i}))});if(parsed.pathname.includes('/messages/synthetic-'))return Response.json({...dataFixtureMessage().metadata,id:parsed.pathname.split('/').pop()});return providerFixture(url,options);};
 const connection=createConnectionRuntime({registration,client,store,encryption_key,key_id:'synthetic-batch',assertCurrent:authority,fetch}),begin=beginFor(s),begun=await connection.request(begin),connected=await connection.request(nextFor(begin,begun,'callback'));
 let delayMs=0;const runtime=createDataRuntime({registrations:[registration],client,store,encryption_key,key_id:'synthetic-batch',assertCurrent:async input=>{checks++;if(delayMs)await new Promise(r=>setTimeout(r,delayMs));return {...input,allowed:true};},fetch});
 const measurements=[];for(const ms of [0,100]){delayMs=ms;checks=0;providerCalls=0;const started=performance.now(),result=await runtime.request({schema_version:'deft.app_data_runtime.v1',request_id:randomUUID(),scope:s,connection:{session_id:begin.session_id,session_revision:5,runtime_session_ref:begun.runtime_session_ref,account_ref:connected.account.account_ref},authority:{consent_id:randomUUID(),consent_digest:'sha256:'+'d'.repeat(64),data_policy_digest:'sha256:'+'e'.repeat(64)},operation:'resource_list',expires_at:new Date(Date.now()+29000).toISOString(),input:{store_key:'drafts',resource_key:'inbox',query:'in:inbox',cursor:null,limit:25}});
 assert.equal(result.items.length,25);assert.equal(providerCalls,26);assert.equal(checks,10);measurements.push({authority_delay_ms:ms,authority_checks:checks,synthetic_provider_calls:providerCalls,elapsed_ms:Math.round(performance.now()-started)});}
 t.diagnostic(JSON.stringify({network_calls:0,measurements}));
});


test('interrupted cached row updates invalidate warm unread totals before a replacement checkpoint exists',async t=>{
 const store=await fixture(t),mailbox=createMailboxStore({store}),s=scope(),initial=page(s,0,2);initial.items.forEach(item=>item.flags={seen:false});await mailbox.commit(s,initial,async()=>{});
 assert.equal((await mailbox.unreadSnapshot(s,[],async()=>{})).unread_count,2);
 let written=false;const tracked={withLock(options,work){return store.withLock(options,tx=>work({...tx,async compareAndSwap(input){const result=await tx.compareAndSwap(input);if(input.value.schema_version==='email.app_mail_resource.v1')written=true;return result;}}));}},guarded=createMailboxStore({store:tracked}),change=page(s,0,2);change.items.forEach(item=>item.flags={seen:true});
 await assert.rejects(guarded.commit(s,change,async()=>{},{localCheck:()=>{if(written)throw Error('synthetic interrupted commit');}}));
 const after=await mailbox.unreadSnapshot(s,[],async()=>{});assert.equal(after.unread_count,null);assert.equal(after.coverage,'partial');assert.equal(after.cached_unread_count,1);
});


test('unchanged cache rows preserve warm generation and canonical unread coverage',async t=>{
 const store=await fixture(t),mailbox=createMailboxStore({store}),s=scope(),initial=page(s,0,2);initial.items.forEach(item=>item.flags={seen:false});await mailbox.commit(s,initial,async()=>{});
 const before=await mailbox.unreadSnapshot(s,[],async()=>{});await mailbox.commit(s,{...initial,state_updates:[]},async()=>{});const after=await mailbox.unreadSnapshot(s,[],async()=>{});assert.deepEqual(after,before);
});

test('resource labels use the exact message subject without sender or recipient decorations',()=>{
 const record={record_id:'11111111-1111-4111-8111-111111111111',logical_message_id:'mail_'+'a'.repeat(64),provider_revision:'one',provider_source:{provider:'gmail'},revision:1,deleted:false,data:{subject:'Only the subject',label:'Only the subject · Sender <sender@example.test> → recipient@example.test',sender:'Sender <sender@example.test>',recipients:'recipient@example.test'}};
 const result=resourceView(record);
 assert.equal(result.label,'Only the subject');assert.deepEqual(result.data,record.data);
 assert.equal(resourceView({...record,data:{...record.data,label:'Different descriptive label'}}).label,result.label);
 assert.equal(resourceView({...record,data:{...record.data,subject:''}}).label,'(No subject)');
 const {subject,...legacy}=record.data;assert.equal(resourceView({...record,data:legacy}).label,'Only the subject · Sender  sender@example.test  → recipient@example.test');
 assert.equal(result.content_digest,resourceView({...record,label:'view-only title'}).content_digest,'title projection does not change immutable source identity');
});
