import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createDurableStore} from './durable-store.mjs';
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

test('under the cap a workspace sends, and each accepted Send counts once',async t=>{
  const s=await opened(t),cap=s.cap({hourly:3,daily:10});
  assert.equal(await cap.admit(org),null);
  assert.equal(await cap.record(org,randomUUID()),true);s.clock+=1000;
  assert.equal(await cap.record(org,randomUUID()),true);
  assert.equal(await cap.admit(org),null);
  assert.deepEqual(await cap.usage(org),{hour:2,day:2});
  assert.deepEqual(s.notices,[]);
});

test('at the hourly cap the next Send is refused with the reason and the time it lifts; one notice per window',async t=>{
  const s=await opened(t),cap=s.cap({hourly:2,daily:10});
  await cap.record(org,randomUUID());s.clock+=60000;await cap.record(org,randomUUID());s.clock+=60000;
  const refused=await cap.admit(org);
  assert.deepEqual(refused,{code:'EMAIL_SEND_LIMIT_REACHED',window:'hour',limit:2,sent:2,lifts_at:new Date(START+HOUR).toISOString()});
  assert.deepEqual(await cap.admit(org),refused,'still refused, same lift time');
  assert.equal(s.notices.length,1,'the first refusal in a window gives one notice only');
  assert.deepEqual(s.notices[0],{event:'email_send_limit_reached',org_id:org,window:'hour',limit:2,sent:2,lifts_at:refused.lifts_at});
  // Rolling window: once the first Send is an hour old, one slot opens.
  s.clock=START+HOUR;assert.equal(await cap.admit(org),null);
  await cap.record(org,randomUUID());
  const again=await cap.admit(org);assert.equal(again.lifts_at,new Date(START+60000+HOUR).toISOString());
  assert.equal(s.notices.length,2,'a new window that hits the cap gives a new notice');
});

test('the daily cap rolls over after 24 hours and wins when it lifts later',async t=>{
  const s=await opened(t),cap=s.cap({hourly:2,daily:3});
  for(let i=0;i<3;i++){await cap.record(org,randomUUID());s.clock+=2*HOUR;}
  const refused=await cap.admit(org);
  assert.equal(refused.window,'day');assert.equal(refused.limit,3);assert.equal(refused.lifts_at,new Date(START+DAY).toISOString());
  s.clock=START+DAY-1;assert.ok(await cap.admit(org));
  s.clock=START+DAY;assert.equal(await cap.admit(org),null);
  assert.deepEqual(await cap.usage(org),{hour:0,day:2});
});

test('a restart keeps the count, and a retry of the same Run never counts twice',async t=>{
  const s=await opened(t);let cap=s.cap({hourly:2,daily:10});const run=randomUUID();
  assert.equal(await cap.record(org,run),true);
  assert.equal(await cap.record(org,run),false,'retry of the same Run');
  assert.equal(await cap.record(org,run.toUpperCase()),false,'same id, other case');
  await s.restart();cap=s.cap({hourly:2,daily:10});
  assert.equal(await cap.record(org,run),false,'retry after a restart');
  assert.deepEqual(await cap.usage(org),{hour:1,day:1});
  await cap.record(org,randomUUID());await s.restart();cap=s.cap({hourly:2,daily:10});
  assert.equal((await cap.admit(org))?.code,'EMAIL_SEND_LIMIT_REACHED','the count survived the restart');
});

test('workspaces are counted apart',async t=>{
  const s=await opened(t),cap=s.cap({hourly:1,daily:null}),other=randomUUID();
  await cap.record(org,randomUUID());
  assert.ok(await cap.admit(org));assert.equal(await cap.admit(other),null);
});

test('settings: hosted defaults, no cap for self-hosted, explicit values, strict refusal',async t=>{
  assert.deepEqual({...resolveSendLimits({env:{},hosted:true})},{hourly:200,daily:2000});
  assert.deepEqual(HOSTED_SEND_LIMITS,{hourly:200,daily:2000});
  assert.deepEqual({...resolveSendLimits({env:{},hosted:false})},{hourly:null,daily:null});
  assert.deepEqual({...resolveSendLimits({env:{EMAIL_RUNTIME_SEND_LIMIT_HOURLY:'50'},hosted:false})},{hourly:50,daily:null});
  assert.deepEqual({...resolveSendLimits({env:{EMAIL_RUNTIME_SEND_LIMIT_HOURLY:'50',EMAIL_RUNTIME_SEND_LIMIT_DAILY:'400'},hosted:true})},{hourly:50,daily:400});
  for(const bad of ['0','-1','1.5','ten','10001',' ','1e3'])assert.throws(()=>resolveSendLimits({env:{EMAIL_RUNTIME_SEND_LIMIT_DAILY:bad}}),/EMAIL_RUNTIME_CONFIG_INVALID/,bad);
  // Self-hosted default: no cap, nothing counted, nothing refused.
  const s=await opened(t),cap=s.cap(resolveSendLimits({env:{},hosted:false}));
  assert.equal(cap.enabled,false);
  for(let i=0;i<5;i++){assert.equal(await cap.record(org,randomUUID()),false);assert.equal(await cap.admit(org),null);}
});

test('the refused Run result fits the reviewed Send output schema and is final',()=>{
  const run=randomUUID();
  assert.deepEqual(sendLimitResult(run),{status:'returned',provider_succeeded:false,output:{operation_id:run,primary_outcome:'send_limit_reached',effect_outcome:'not_attempted',inspection_available:false}});
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
  const cap=createSendCap({store:f.store,limits:{hourly:1,daily:10},now:()=>f.clock-HOUR+1000});await cap.record(f.scope.org_id,randomUUID());
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
  // Once the window rolls over, the same reviewed Send goes out and the note clears.
  f.advance(1000);const sent=await f.execute();assert.equal(sent.provider_succeeded,true);assert.equal(f.sendCalls,1);
  const after=(await f.data().request(f.makeRequest('record_list',{store_key:'drafts',cursor:null,limit:25}))).items.find(item=>item.record_id===f.created.record.record_id);
  assert.equal(after.summary.send_limit_code,undefined);
});
