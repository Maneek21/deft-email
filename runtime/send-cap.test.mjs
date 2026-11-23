import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createDurableStore} from './durable-store.mjs';
import {createDraftStore} from './draft-store.mjs';
import {createSendCap,resolveSendLimits,sendLimitResult,HOSTED_SEND_LIMITS} from './send-cap.mjs';
import {setup} from './send-latency-fixture.mjs';
import {providerFixture} from './test-support.mjs';

const HOUR=3600000,DAY=24*HOUR,START=Date.parse('2026-11-24T08:00:00.000Z');
async function opened(t){
  const parent=await mkdtemp(join(tmpdir(),'email-send-cap-')),root=join(parent,'private'),encryption_key=Buffer.alloc(32,23);
  const open=()=>createDurableStore({root,encryption_key,key_id:'send-cap',allow_windows_fixture:process.platform==='win32'});
  const state={store:await open(),clock:START,notices:[]};
  t.after(async()=>{try{await state.store.close();}catch{}await rm(parent,{recursive:true,force:true});});
  state.cap=limits=>createSendCap({store:state.store,limits,now:()=>state.clock,onLimit:event=>state.notices.push(event)});
  state.restart=async()=>{await state.store.close();state.store=await open();};
  return state;
}
const org=randomUUID();

test('under the cap a Send takes its slot; the same Run never takes two',async t=>{
  const s=await opened(t),cap=s.cap({hourly:3,daily:10}),run=randomUUID();
  assert.equal(await cap.take(org,run),null);
  assert.equal(await cap.take(org,run),null,'retry of the same Run');
  assert.equal(await cap.take(org,run.toUpperCase()),null,'same id, other case');
  s.clock+=1000;assert.equal(await cap.take(org,randomUUID()),null);
  assert.deepEqual(await cap.usage(org),{hour:2,day:2});
  assert.deepEqual(s.notices,[]);
});

test('at the hourly cap the next Send is refused with the reason and the time it lifts; one notice per window',async t=>{
  const s=await opened(t),cap=s.cap({hourly:2,daily:10}),first=randomUUID();
  await cap.take(org,first);s.clock+=60000;await cap.take(org,randomUUID());s.clock+=60000;
  const refused=await cap.take(org,randomUUID());
  assert.deepEqual(refused,{code:'EMAIL_SEND_LIMIT_REACHED',window:'hour',limit:2,sent:2,lifts_at:new Date(START+HOUR).toISOString()});
  assert.equal((await cap.take(org,randomUUID())).lifts_at,refused.lifts_at,'another Run: still refused, same lift time');
  assert.equal(await cap.take(org,first),null,'a Run that already holds a slot keeps it at the cap');
  assert.equal(s.notices.length,1,'the first refusal in a window gives one notice only');
  assert.deepEqual(s.notices[0],{event:'email_send_limit_reached',org_id:org,window:'hour',limit:2,sent:2,lifts_at:refused.lifts_at});
  assert.deepEqual(await cap.usage(org),{hour:2,day:2},'refusals take no slot');
  // Rolling window: once the first Send is an hour old, one slot opens.
  s.clock=START+HOUR;assert.equal(await cap.take(org,randomUUID()),null);
  const again=await cap.take(org,randomUUID());assert.equal(again.lifts_at,new Date(START+60000+HOUR).toISOString());
  assert.equal(s.notices.length,2,'a new window that hits the cap gives a new notice');
});

test('a refused Run replays its refusal, even after the cap lifts; a new Run may send then',async t=>{
  const s=await opened(t),cap=s.cap({hourly:1,daily:null});await cap.take(org,randomUUID());
  const run=randomUUID(),refused=await cap.take(org,run);assert.equal(refused.code,'EMAIL_SEND_LIMIT_REACHED');
  s.clock+=HOUR+1000;assert.deepEqual(await cap.take(org,run),refused,'the same Run never sends later, after the window lifted');
  assert.equal(await cap.take(org,randomUUID()),null,'a newly reviewed Run sends');
});

test('the daily cap rolls over after 24 hours and wins when it lifts later',async t=>{
  const s=await opened(t),cap=s.cap({hourly:2,daily:3});
  for(let i=0;i<3;i++){assert.equal(await cap.take(org,randomUUID()),null);s.clock+=2*HOUR;}
  const refused=await cap.take(org,randomUUID());
  assert.equal(refused.window,'day');assert.equal(refused.limit,3);assert.equal(refused.lifts_at,new Date(START+DAY).toISOString());
  s.clock=START+DAY-1;assert.ok(await cap.take(org,randomUUID()));
  s.clock=START+DAY;assert.equal(await cap.take(org,randomUUID()),null);
  assert.deepEqual(await cap.usage(org),{hour:1,day:3});
});

test('a restart keeps the count and the refusals',async t=>{
  const s=await opened(t);let cap=s.cap({hourly:2,daily:10});const run=randomUUID();
  await cap.take(org,run);await s.restart();cap=s.cap({hourly:2,daily:10});
  assert.equal(await cap.take(org,run),null,'retry after a restart: no second slot');
  assert.deepEqual(await cap.usage(org),{hour:1,day:1});
  await cap.take(org,randomUUID());const refusedRun=randomUUID(),refused=await cap.take(org,refusedRun);
  await s.restart();cap=s.cap({hourly:2,daily:10});
  assert.equal((await cap.take(org,randomUUID()))?.code,'EMAIL_SEND_LIMIT_REACHED','the count survived the restart');
  assert.deepEqual(await cap.take(org,refusedRun),refused,'the refusal survived the restart');
});

test('a row from the pre-release v1 format keeps its counted sends as slots',async t=>{
  const s=await opened(t),cap=s.cap({hourly:1,daily:null}),run=randomUUID();
  await s.store.withLock({key:'email.runtime.send_cap.'+org},async tx=>tx.compareAndSwap({expected_revision:null,value:{schema_version:'email.send_cap.v1',org_id:org,sends:[[run,START]],notified_until:null}}));
  assert.equal(await cap.take(org,run),null,'its own Run keeps its slot');
  assert.equal((await cap.take(org,randomUUID()))?.code,'EMAIL_SEND_LIMIT_REACHED');
});

test('a slot is given back only by release; release of an unknown Run is a no-op',async t=>{
  const s=await opened(t),cap=s.cap({hourly:1,daily:null}),run=randomUUID();
  await cap.take(org,run);assert.ok(await cap.take(org,randomUUID()));
  assert.equal(await cap.release(org,run),true);assert.equal(await cap.release(org,run),false);
  assert.equal(await cap.take(org,randomUUID()),null);
});

test('concurrent Sends cannot overshoot: checking and counting are one locked step',async t=>{
  const s=await opened(t),cap=s.cap({hourly:3,daily:null});
  const results=await Promise.all(Array.from({length:8},()=>cap.take(org,randomUUID())));
  assert.equal(results.filter(result=>result===null).length,3);assert.deepEqual(await cap.usage(org),{hour:3,day:3});
});

test('only the longest active window is kept, so the row stays bounded at the largest settings',async t=>{
  const s=await opened(t),cap=s.cap({hourly:2,daily:null});
  await cap.take(org,randomUUID());s.clock+=HOUR+1;await cap.take(org,randomUUID());
  assert.deepEqual(await cap.usage(org),{hour:1,day:1},'an hourly-only cap keeps one hour, not 24');
  // Worst case at the largest accepted values: 10000 slots plus the kept refusals, under the 1 MiB row budget.
  const slot=JSON.stringify([randomUUID(),START]).length+1,refusal=JSON.stringify([randomUUID(),START,1,10000,10000,START+DAY]).length+1,row=10000*slot+4000*refusal+512;
  assert.ok(row<1024*1024,`row ${row} bytes`);
});

test('workspaces are counted apart',async t=>{
  const s=await opened(t),cap=s.cap({hourly:1,daily:null}),other=randomUUID();
  await cap.take(org,randomUUID());
  assert.ok(await cap.take(org,randomUUID()));assert.equal(await cap.take(other,randomUUID()),null);
});

test('settings: hosted defaults, no cap for self-hosted, explicit values, strict refusal',async t=>{
  assert.deepEqual({...resolveSendLimits({env:{},hosted:true})},{hourly:200,daily:2000});
  assert.deepEqual(HOSTED_SEND_LIMITS,{hourly:200,daily:2000});
  assert.deepEqual({...resolveSendLimits({env:{},hosted:false})},{hourly:null,daily:null});
  assert.deepEqual({...resolveSendLimits({env:{EMAIL_RUNTIME_SEND_LIMIT_HOURLY:'50'},hosted:false})},{hourly:50,daily:null});
  assert.deepEqual({...resolveSendLimits({env:{EMAIL_RUNTIME_SEND_LIMIT_HOURLY:'50',EMAIL_RUNTIME_SEND_LIMIT_DAILY:'400'},hosted:true})},{hourly:50,daily:400});
  for(const bad of ['','0','-1','1.5','ten','10001',' ',' 5','1e3'])assert.throws(()=>resolveSendLimits({env:{EMAIL_RUNTIME_SEND_LIMIT_DAILY:bad}}),/EMAIL_RUNTIME_CONFIG_INVALID/,JSON.stringify(bad));
  // Self-hosted default: no cap, nothing counted, nothing refused.
  const s=await opened(t),cap=s.cap(resolveSendLimits({env:{},hosted:false}));
  assert.equal(cap.enabled,false);
  for(let i=0;i<5;i++)assert.equal(await cap.take(org,randomUUID()),null);
  assert.deepEqual(await cap.usage(org),{hour:0,day:0});
});

test('the refused Run result fits the reviewed Send output schema and is final',()=>{
  const run=randomUUID();
  assert.deepEqual(sendLimitResult(run),{status:'returned',provider_succeeded:false,output:{operation_id:run,primary_outcome:'send_limit_reached',effect_outcome:'not_attempted',inspection_available:false}});
});

test('the draft note: only on the exact reviewed draft, cleared by the next reserved Send',async t=>{
  const s=await opened(t),drafts=createDraftStore({store:s.store,now:()=>s.clock}),scope={org_id:org,owner_user_id:randomUUID(),account_id:'account-1'},check=async()=>{};
  const record=await drafts.create(scope,randomUUID(),{mode:'compose',to:'a@example.test',cc:'',bcc:'',subject:'S',body:'B',body_html:'<p>B</p>',reply_record_id:'',attachments:[]},{request_id:randomUUID(),user_id:scope.owner_user_id,check});
  const limit={code:'EMAIL_SEND_LIMIT_REACHED',window:'hour',limit:200,sent:200,lifts_at:new Date(START+HOUR).toISOString()},run=randomUUID(),exact={run_id:run,revision:record.revision,content_digest:record.content_digest};
  assert.equal(await drafts.recordSendLimit(scope,record.draft_id,{...exact,revision:record.revision+1},limit),false,'a superseded revision gets no note');
  assert.equal(await drafts.recordSendLimit(scope,record.draft_id,{...exact,content_digest:'0'.repeat(64)},limit),false,'changed content gets no note');
  assert.equal(await drafts.recordSendLimit(scope,record.draft_id,exact,limit),true);
  const noted=await drafts.read(scope,record.draft_id,check);assert.equal(noted.send_limit.run_id,run);assert.equal(noted.revision,record.revision);
  const reserved=await drafts.reserveSend(scope,record.draft_id,record.revision,record.content_digest,randomUUID(),check);
  assert.equal(reserved.send_limit,undefined,'the next reserved Send clears it');
  assert.equal(await drafts.recordSendLimit(scope,record.draft_id,exact,limit),false,'a late note never lands on a submitted message');
});

test('the draft note is shown only for its own revision and Run',async t=>{
  const {recordView}=await import('./data-runtime.mjs');
  const base={draft_id:randomUUID(),revision:3,content_revision:1,content_digest:'a'.repeat(64),status:'draft',content:{mode:'compose',to:'a@example.test',subject:'S'},file_catalog:[],created_at:new Date(START).toISOString(),updated_at:new Date(START).toISOString()};
  const run=randomUUID(),note={run_id:run,revision:3,code:'EMAIL_SEND_LIMIT_REACHED',window:'hour',limit:200,lifts_at:new Date(START+HOUR).toISOString()};
  assert.equal(recordView({...base,send_limit:note}).summary.send_limit_code,'EMAIL_SEND_LIMIT_REACHED');
  assert.equal(recordView({...base,revision:4,send_limit:note}).summary.send_limit_code,undefined,'edited or released since');
  assert.equal(recordView({...base,status:'submitted',send_effect:{run_id:randomUUID(),state:'queued'},send_limit:note}).summary.send_limit_code,undefined,'another Run now owns the message');
  assert.equal(recordView({...base,status:'submitted',send_effect:{run_id:run,state:'queued'},send_limit:note}).summary.send_limit_code,'EMAIL_SEND_LIMIT_REACHED','a refused scheduled Send keeps its note');
});

test('Send runner: under the cap it sends and counts once; a retry and a restart do not count again',async t=>{
  const f=await setup(t,{sendLimits:{hourly:2,daily:10}});
  const result=await f.execute();assert.equal(result.status,'returned');assert.equal(result.provider_succeeded,true);assert.equal(f.sendCalls,1);
  const cap=()=>createSendCap({store:f.store,limits:{hourly:2,daily:10},now:()=>f.clock});
  assert.deepEqual(await cap().usage(f.scope.org_id),{hour:1,day:1});
  assert.deepEqual(await f.execute(),result,'retry of the same Run replays');assert.equal(f.sendCalls,1);
  await f.restart();assert.deepEqual(await f.execute(),result);assert.equal(f.sendCalls,1);
  assert.deepEqual(await cap().usage(f.scope.org_id),{hour:1,day:1});
});

test('Send runner: at the cap it refuses before the provider, keeps the draft with the reason, and receiving still works',async t=>{
  let inboxReads=0;const sourceProvider=async(url,options)=>{if(String(url).startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages?')){inboxReads++;return Response.json({resultSizeEstimate:0});}return providerFixture(url,options);};
  const notices=[],f=await setup(t,{sendLimits:{hourly:1,daily:10},onSendLimit:event=>notices.push(event),sourceProvider});
  // The earlier Send is 59m59s old, so the window rolls over a second from now.
  await createSendCap({store:f.store,limits:{hourly:1,daily:10},now:()=>f.clock-HOUR+1000}).take(f.scope.org_id,randomUUID());
  const result=await f.execute();
  assert.deepEqual(result,sendLimitResult(f.claim.run_id));assert.equal(f.sendCalls,0,'no provider call');assert.equal(notices.length,1);
  const listed=await f.data().request(f.makeRequest('record_list',{store_key:'drafts',cursor:null,limit:25}));
  const row=listed.items.find(item=>item.record_id===f.created.record.record_id);
  assert.equal(row.status,'draft','the draft is kept, not submitted');
  assert.equal(row.summary.send_limit_code,'EMAIL_SEND_LIMIT_REACHED');assert.equal(row.summary.send_limit_window,'hour');assert.equal(row.summary.send_limit_max,1);
  assert.ok(Date.parse(row.summary.send_limit_lifts_at)>f.clock);
  assert.equal(row.revision,f.created.record.revision,'the note is not a content change');
  // Receiving is not gated by the send cap.
  const inbox=await f.data().request(f.makeRequest('resource_list',{store_key:'drafts',resource_key:'inbox',cursor:null,limit:10,query:'in:inbox'}));
  assert.ok(Array.isArray(inbox.items));assert.ok(inboxReads>=1,'the mailbox was read from the provider');
  // Once the window rolls over, the refused Run still never sends: a retry replays the refusal, across a restart too.
  f.advance(1000);assert.deepEqual(await f.execute(),result);assert.equal(f.sendCalls,0);
  await f.restart();assert.deepEqual(await f.execute(),result);assert.equal(f.sendCalls,0);
});

test('Send runner: an uncertain provider outcome still counts, and a restart keeps it',async t=>{
  const f=await setup(t,{sendLimits:{hourly:5,daily:10},sendProvider:async()=>{throw Error('synthetic lost response after acceptance');}});
  assert.deepEqual(await f.execute(),{status:'indeterminate'});assert.equal(f.sendCalls,1);
  const usage=()=>createSendCap({store:f.store,limits:{hourly:5,daily:10},now:()=>f.clock}).usage(f.scope.org_id);
  assert.deepEqual(await usage(),{hour:1,day:1});
  await f.restart();await f.execute();assert.equal(f.sendCalls,1);assert.deepEqual(await usage(),{hour:1,day:1});
});
