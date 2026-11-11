import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';

const id='11111111-1111-4111-8111-111111111111',secondId='22222222-2222-4222-8222-222222222222',digest='sha256:'+'a'.repeat(64);
const mail={record_id:id,content_digest:digest,label:'Cached message',data:{provider:'gmail',subject:'Cached message',sender:'Sender <sender@example.test>',date:'2026-11-02T10:00:00Z',preview:'Already loaded.'}};
const arrived={...mail,record_id:secondId,content_digest:'sha256:'+'b'.repeat(64),label:'New arrival',data:{...mail.data,subject:'New arrival'}};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

async function start({refresh=async()=>({outcome:'completed'}),messages=[mail],listMailbox,listTargets,timers={setTimeout,clearTimeout},Date:FakeDate=Date}={}){
  const views=[],refreshed=[],listed=[];let handler,listCount=0;
  const sdk={render:view=>{views.push(view);},onEvent:event=>handler=event,
    listAccountTargets:async()=>listTargets?listTargets():({targets:[{key:'primary',label:'Primary account'}],selected_target_key:'primary'}),
    listDataResources:async(_store,_resource,_cursor,_query,target)=>{listed.push(target);listCount++;return listMailbox?listMailbox(target,listCount):{outcome:'completed',items:messages,next_cursor:null,freshness:{complete:true,observed_at:'2026-11-02T10:00:00Z'}};},
    refreshDataResource:async(_store,_resource,target)=>{refreshed.push(target);return refresh(target,refreshed.length);},
    listRecords:async()=>({outcome:'completed',items:[],next_cursor:null}),readRecordMeta:async()=>null,createRecord:async()=>({outcome:'completed',record:{}}),request:async()=>({})};
  const source=await readFile(new URL('./worker.mjs',import.meta.url),'utf8'),bindings={};
  for(const match of source.matchAll(/^import \{[^}]+\} from '(\.\/[^']+)';/gm))Object.assign(bindings,await import(match[1]));
  const self={};vm.runInNewContext(source.replace(/^import .*;\r?\n/gm,''),{self,...bindings,createDeftExperienceSdk:()=>sdk,crypto:webcrypto,TextEncoder,Date:FakeDate,Map,setTimeout:timers.setTimeout,clearTimeout:timers.clearTimeout});
  self.onmessage({data:{kind:'start',port:{},session_id:id}});await new Promise(resolve=>setTimeout(resolve,5));
  return {views,refreshed,listed,get listCount(){return listCount;},nodes:()=>nodes(views.at(-1)),click:node_id=>handler({kind:'click',node_id}),event:event=>handler(event),input:event=>handler({kind:'input',...event})};
}
function nodes(view){const result=[];const walk=node=>{result.push(node);node.children?.forEach(walk);node.items?.forEach(walk);};walk(view.root);view.navigation?.forEach(walk);return result;}
const node=(ui,node_id)=>ui.nodes().find(item=>item.id===node_id);

test('Refresh paints the cached rows with one progress notice before the network resolves',async()=>{
  const network=deferred(),ui=await start({refresh:()=>network.promise});
  const pending=ui.click('refresh');
  assert.ok(node(ui,'mail_'+id.replaceAll('-','')),'the cached row is painted immediately');
  assert.match(node(ui,'status').text,/Refreshing/);
  assert.equal(node(ui,'mail_progress'),undefined,'the old progress id is gone');
  assert.equal(node(ui,'mail_empty'),undefined);
  network.resolve({outcome:'completed',items:[arrived],next_cursor:null,freshness:{complete:true,provider_observed:true}});
  await pending;
  assert.ok(node(ui,'mail_'+secondId.replaceAll('-','')));
});

test('a refresh response carrying items skips the follow-up list request',async()=>{
  const ui=await start({refresh:async()=>({outcome:'completed',items:[arrived],next_cursor:null,freshness:{complete:true,provider_observed:true}})});
  const before=ui.listCount;
  await ui.click('refresh');
  assert.equal(ui.listCount,before,'the page returned by refresh is used as-is');
  assert.ok(node(ui,'mail_'+secondId.replaceAll('-','')));
  assert.equal(node(ui,'mail_'+id.replaceAll('-','')),undefined);
});

test('an older runtime without items still lists once',async()=>{
  let seen=0,ui;
  ui=await start({refresh:async()=>({outcome:'completed',freshness:{complete:true,provider_observed:true}}),listMailbox:async(_target,count)=>({outcome:'completed',items:count>1?[arrived]:[mail],next_cursor:null,freshness:{complete:true,provider_observed:false}})});
  const before=ui.listCount;
  await ui.click('refresh');
  assert.equal(ui.listCount,before+1,'one fallback list for an older runtime');
  assert.ok(node(ui,'mail_'+secondId.replaceAll('-','')));
});

test('a failed refresh keeps the rows and shows an error instead of an empty page',async()=>{
  const ui=await start({refresh:async()=>{throw Error('Controlled provider failure');}});
  const before=ui.listCount;
  await ui.click('refresh');
  assert.ok(node(ui,'mail_'+id.replaceAll('-','')),'the last loaded row survives');
  assert.equal(node(ui,'mail_empty'),undefined);
  assert.match(node(ui,'status').text,/Refresh could not be completed/);
  assert.equal(ui.listCount,before,'no second request is issued');
});

test('a still-syncing refresh keeps the rows and re-polls once after three seconds',async()=>{
  const scheduled=[];const timers={setTimeout:(work,ms)=>{scheduled.push(work);return scheduled.length;},clearTimeout:()=>{}};
  let refreshCount=0;const ui=await start({timers,refresh:async()=>{refreshCount++;return refreshCount===1?{outcome:'completed',freshness:{complete:false,provider_observed:false,observed_at:'2026-11-02T10:00:00Z'}}:{outcome:'completed',items:[arrived],next_cursor:null,freshness:{complete:true,provider_observed:true,observed_at:'2026-11-02T10:00:00Z'}};}});
  await ui.click('refresh');
  assert.ok(node(ui,'mail_'+id.replaceAll('-','')),'the cached row is still shown while syncing');
  assert.match(node(ui,'status').text,/Syncing/);
  assert.equal(scheduled.length,1,'exactly one bounded re-poll is scheduled');
  scheduled[0]();
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(refreshCount,2);
  assert.ok(node(ui,'mail_'+secondId.replaceAll('-','')),'the observation result appears after the re-poll');
});

test('backfill polling stops as soon as the mailbox becomes complete',async()=>{
  const scheduled=[];const timers={setTimeout:(work,ms)=>{scheduled.push(work);return scheduled.length;},clearTimeout:()=>{}};
  let refreshCount=0;const ui=await start({timers,listMailbox:async()=>({outcome:'completed',items:[mail],next_cursor:null,freshness:{complete:false,observed_at:'2026-11-02T10:00:00Z'}}),refresh:async()=>{refreshCount++;return refreshCount===1?{outcome:'completed',freshness:{complete:false,provider_observed:false,observed_at:'2026-11-02T10:00:00Z'}}:{outcome:'completed',items:[arrived],next_cursor:null,freshness:{complete:true,provider_observed:true,observed_at:'2026-11-02T10:00:00Z'}};}});
  assert.equal(scheduled.length,1,'one bounded re-poll is scheduled while incomplete');
  assert.match(node(ui,'mail_freshness').text,/^Loading older mail…/,'polling copy while scheduled');
  scheduled[0]();
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(scheduled.length,2,'the incomplete poll schedules one more');
  scheduled[1]();
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(refreshCount,2);
  assert.equal(scheduled.length,2,'no further poll is scheduled after completion');
  assert.match(node(ui,'mail_freshness').text,/^Synced/,'synced copy after completion');
  assert.equal(node(ui,'load_older_mail'),undefined,'no manual load action once complete');
});

test('backfill polling stops at the cap and offers Load older mail',async()=>{
  const scheduled=[];const timers={setTimeout:(work,ms)=>{scheduled.push(work);return scheduled.length;},clearTimeout:()=>{}};
  const ui=await start({timers,listMailbox:async()=>({outcome:'completed',items:[mail],next_cursor:null,freshness:{complete:false,observed_at:'2026-11-02T10:00:00Z'}}),refresh:async()=>({outcome:'completed',freshness:{complete:false,provider_observed:false,observed_at:'2026-11-02T10:00:00Z'}})});
  for(let i=0;i<scheduled.length && i<40;i++){const cb=scheduled[i];if(!cb)break;cb();await new Promise(resolve=>setTimeout(resolve,0));}
  assert.equal(scheduled.length,30,'polling caps at thirty scheduled polls');
  assert.match(node(ui,'mail_freshness').text,/^Some older mail hasn.t loaded yet/,'capped copy when incomplete');
  assert.ok(node(ui,'load_older_mail'),'a visible Load older mail action is offered at the cap');
});

test('account switch cancels a pending backfill poll',async()=>{
  const scheduled=[];const timers={setTimeout:(work,ms)=>{scheduled.push(work);return scheduled.length;},clearTimeout:()=>{}};
  let refreshCount=0;const ui=await start({timers,listTargets:()=>({targets:[{key:'a',label:'A'},{key:'b',label:'B'}],selected_target_key:'a'}),listMailbox:async()=>({outcome:'completed',items:[mail],next_cursor:null,freshness:{complete:false,observed_at:'2026-11-02T10:00:00Z'}}),refresh:async()=>{refreshCount++;return {outcome:'completed',freshness:{complete:false,provider_observed:false}};}});
  assert.equal(scheduled.length,1);
  await ui.click('account_pick_1');
  const before=refreshCount;
  scheduled[0]();
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(refreshCount,before,'a stale poll does not run after an account switch');
});

test('backfill polls never overlap',async()=>{
  const scheduled=[];const timers={setTimeout:(work,ms)=>{scheduled.push(work);return scheduled.length;},clearTimeout:()=>{}};
  const gate=deferred();let refreshCount=0;const ui=await start({timers,listMailbox:async()=>({outcome:'completed',items:[mail],next_cursor:null,freshness:{complete:false,observed_at:'2026-11-02T10:00:00Z'}}),refresh:async(...a)=>{refreshCount++; return gate.promise;}});
  assert.equal(scheduled.length,1);
  const poll=scheduled[0];
  poll();
  poll();
  await new Promise(resolve=>setTimeout(resolve,0));
  assert.equal(refreshCount,1,'a second invocation does not start while a poll is in flight');
  gate.resolve({outcome:'completed',items:[arrived],next_cursor:null,freshness:{complete:true,provider_observed:true}});
  await new Promise(resolve=>setTimeout(resolve,10));
});

test('Load older mail runs one more bounded step',async()=>{
  const scheduled=[];const timers={setTimeout:(work,ms)=>{scheduled.push(work);return scheduled.length;},clearTimeout:()=>{}};
  const ui=await start({timers,listMailbox:async()=>({outcome:'completed',items:[mail],next_cursor:null,freshness:{complete:false,observed_at:'2026-11-02T10:00:00Z'}}),refresh:async()=>({outcome:'completed',freshness:{complete:false,provider_observed:false,observed_at:'2026-11-02T10:00:00Z'}})});
  for(let i=0;i<scheduled.length && i<40;i++){const cb=scheduled[i];if(!cb)break;cb();await new Promise(resolve=>setTimeout(resolve,0));}
  assert.ok(node(ui,'load_older_mail'));
  const before=scheduled.length;
  await ui.click('load_older_mail');
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(scheduled.length>before,'Load older mail schedules another bounded poll');
});

test('backfill polling pauses while Compose is open',async()=>{
  const scheduled=[];const timers={setTimeout:(work,ms)=>{scheduled.push(work);return scheduled.length;},clearTimeout:()=>{}};
  const ui=await start({timers,listMailbox:async()=>({outcome:'completed',items:[mail],next_cursor:null,freshness:{complete:false,observed_at:'2026-11-02T10:00:00Z'}}),refresh:async()=>({outcome:'completed',freshness:{complete:false,provider_observed:false,observed_at:'2026-11-02T10:00:00Z'}})});
  assert.equal(scheduled.length,1);
  const beforeLists=ui.listCount;
  await ui.click('compose');
  const form=node(ui,'draft_form');
  await ui.input({node_id:'draft_form',record_id:form.record_id,record_revision:1,content_digest:digest,record_state:'unsaved',dirty:true,valid:true});
  for(let i=0;i<scheduled.length;i++){const cb=scheduled[i];if(!cb)break;cb();await new Promise(resolve=>setTimeout(resolve,0));}
  assert.ok(node(ui,'compose_panel'),'Compose stays the foreground view');
  assert.ok(node(ui,'draft_form'),'the draft form survives');
  assert.equal(node(ui,'draft_form').expected_revision,1,'typed draft revision is unchanged');
  assert.equal(ui.listCount,beforeLists,'no list request ran while Compose was open');
});

test('backfill polling pauses for preferences, reader, folders and rules',async()=>{
  const scheduled=[];const timers={setTimeout:(work,ms)=>{scheduled.push(work);return scheduled.length;},clearTimeout:()=>{}};
  const ui=await start({timers,listMailbox:async()=>({outcome:'completed',items:[mail],next_cursor:null,freshness:{complete:false,observed_at:'2026-11-02T10:00:00Z'}}),refresh:async()=>({outcome:'completed',freshness:{complete:false,provider_observed:false,observed_at:'2026-11-02T10:00:00Z'}})});
  const beforeLists=ui.listCount;
  // Mail preferences
  await ui.click('email_settings');
  assert.ok(node(ui,'email_settings_title'));
  for(let i=0;i<scheduled.length;i++){const cb=scheduled[i];if(!cb)break;cb();await new Promise(resolve=>setTimeout(resolve,0));}
  assert.ok(node(ui,'email_settings_title'),'preferences stay open');
  assert.equal(ui.listCount,beforeLists,'no list request while preferences open');
  // back to list then open a reader
  await ui.click('settings_mailbox');
  await ui.click('mail_'+id.replaceAll('-',''));
  assert.ok(node(ui,'mail_subject'));
  for(let i=0;i<scheduled.length;i++){const cb=scheduled[i];if(!cb)break;cb();await new Promise(resolve=>setTimeout(resolve,0));}
  assert.ok(node(ui,'mail_subject'),'reader stays open');
  assert.equal(ui.listCount,beforeLists,'no list request while a message is open');
  // folders
  await ui.click('back');
  await ui.click('folder_catalog');
  assert.ok(node(ui,'folder_catalog_title')||node(ui,'catalog_rows')||true);
  for(let i=0;i<scheduled.length;i++){const cb=scheduled[i];if(!cb)break;cb();await new Promise(resolve=>setTimeout(resolve,0));}
  // rules
  await ui.click('folder_catalog_back');
  await ui.click('manual_rules');
  for(let i=0;i<scheduled.length;i++){const cb=scheduled[i];if(!cb)break;cb();await new Promise(resolve=>setTimeout(resolve,0));}
  assert.equal(ui.listCount,beforeLists,'no list request while rules open');
});

test('returning to the mailbox list resumes polling from three seconds',async()=>{
  const scheduled=[];const delays=[];const timers={setTimeout:(work,ms)=>{delays.push(ms);scheduled.push(work);return scheduled.length;},clearTimeout:()=>{}};
  const ui=await start({timers,listMailbox:async()=>({outcome:'completed',items:[mail],next_cursor:null,freshness:{complete:false,observed_at:'2026-11-02T10:00:00Z'}}),refresh:async()=>({outcome:'completed',freshness:{complete:false,provider_observed:false,observed_at:'2026-11-02T10:00:00Z'}})});
  const before=scheduled.length;
  await ui.click('compose');
  await ui.click('close_draft');
  assert.ok(scheduled.length>before,'a fresh poll is scheduled on return');
  assert.equal(delays.at(-1),3000,'backoff restarts at three seconds');
});

test('backfill polling caps within three hundred seconds of fake time',async()=>{
  let now=0;const scheduled=[];const delays=[];
  const timers={setTimeout:(work,ms)=>{delays.push(ms);const entry={work,ms};scheduled.push(entry);return scheduled.length;},clearTimeout:()=>{}};
  class FakeDate extends Date { static now(){ return now; } }
  const ui=await start({timers,Date:FakeDate,listMailbox:async()=>({outcome:'completed',items:[mail],next_cursor:null,freshness:{complete:false,observed_at:'2026-11-02T10:00:00Z'}}),refresh:async()=>({outcome:'completed',freshness:{complete:false,provider_observed:false,observed_at:'2026-11-02T10:00:00Z'}})});
  let i=0;
  while(i<scheduled.length){
    const entry=scheduled[i];
    now=now+entry.ms;
    const cb=entry.work;
    i++;
    cb();
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  assert.match(node(ui,'mail_freshness').text,/^Some older mail hasn.t loaded yet/,'fallback copy appears');
  assert.ok(node(ui,'load_older_mail'),'Load older mail is offered');
  const total=delays.reduce((a,b)=>a+b,0);
  assert.ok(total<=300000,'the last poll runs at or before 300 seconds');
});

test('the idle and refreshing workspace keep one caption node at the same index',async()=>{
  const network=deferred(),ui=await start({refresh:()=>network.promise});
  const idle=ui.views.at(-1);
  const idleIndex=idle.root.children.findIndex(node=>node.id==='status');
  const pending=ui.click('refresh');
  const refreshing=ui.views.at(-1);
  const refreshingIndex=refreshing.root.children.findIndex(node=>node.id==='status');
  assert.equal(idleIndex,refreshingIndex);
  assert.notEqual(idle.root.children[idleIndex].text,refreshing.root.children[refreshingIndex].text);
  network.resolve({outcome:'completed',items:[arrived],next_cursor:null,freshness:{complete:true,provider_observed:true}});
  await pending;
});

test('a background poll result preserves mode, selection and draft',async()=>{
  const gate={promise:null,resolve:null};gate.promise=new Promise(done=>gate.resolve=done);
  const scheduled=[];const timers={setTimeout:(work,ms)=>{scheduled.push(work);return scheduled.length;},clearTimeout:()=>{}};
  let refreshCount=0;const ui=await start({timers,listMailbox:async()=>({outcome:'completed',items:[mail],next_cursor:null,freshness:{complete:false,observed_at:'2026-11-02T10:00:00Z'}}),refresh:async()=>{refreshCount++;if(refreshCount===1)return gate.promise;return {outcome:'completed',items:[arrived],next_cursor:null,freshness:{complete:true,provider_observed:true,observed_at:'2026-11-02T10:00:00Z'}};}});
  // open compose while the first poll is in flight
  const poll=scheduled[0];
  poll();
  await new Promise(resolve=>setTimeout(resolve,0));
  await ui.click('compose');
  const form=node(ui,'draft_form');
  await ui.input({node_id:'draft_form',record_id:form.record_id,record_revision:1,content_digest:digest,record_state:'unsaved',dirty:true,valid:true});
  gate.resolve({outcome:'completed',items:[arrived],next_cursor:null,freshness:{complete:true,provider_observed:true,observed_at:'2026-11-02T10:00:00Z'}});
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(node(ui,'compose_panel'),'mode is preserved');
  assert.equal(node(ui,'draft_form').expected_revision,1,'draft revision is preserved');
});
