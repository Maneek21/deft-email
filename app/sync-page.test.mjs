import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';

const id='11111111-1111-4111-8111-111111111111',secondId='22222222-2222-4222-8222-222222222222',digest='sha256:'+'a'.repeat(64);
const mail={record_id:id,content_digest:digest,label:'Cached message',data:{provider:'gmail',subject:'Cached message',sender:'Sender <sender@example.test>',date:'2026-11-02T10:00:00Z',preview:'Already loaded.'}};
const arrived={...mail,record_id:secondId,content_digest:'sha256:'+'b'.repeat(64),label:'New arrival',data:{...mail.data,subject:'New arrival'}};
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

async function start({refresh=async()=>({outcome:'completed'}),messages=[mail],listMailbox,listTargets,timers={setTimeout,clearTimeout}}={}){
  const views=[],refreshed=[],listed=[];let handler,listCount=0;
  const sdk={render:view=>{views.push(view);},onEvent:event=>handler=event,
    listAccountTargets:async()=>listTargets?listTargets():({targets:[{key:'primary',label:'Primary account'}],selected_target_key:'primary'}),
    listDataResources:async(_store,_resource,_cursor,_query,target)=>{listed.push(target);listCount++;return listMailbox?listMailbox(target,listCount):{outcome:'completed',items:messages,next_cursor:null,freshness:{complete:true,observed_at:'2026-11-02T10:00:00Z'}};},
    refreshDataResource:async(_store,_resource,target)=>{refreshed.push(target);return refresh(target,refreshed.length);},
    listRecords:async()=>({outcome:'completed',items:[],next_cursor:null}),readRecordMeta:async()=>null,createRecord:async()=>({outcome:'completed',record:{}}),request:async()=>({})};
  const source=await readFile(new URL('./worker.mjs',import.meta.url),'utf8'),bindings={};
  for(const match of source.matchAll(/^import \{[^}]+\} from '(\.\/[^']+)';/gm))Object.assign(bindings,await import(match[1]));
  const self={};vm.runInNewContext(source.replace(/^import .*;\r?\n/gm,''),{self,...bindings,createDeftExperienceSdk:()=>sdk,crypto:webcrypto,TextEncoder,Date,Map,setTimeout:timers.setTimeout,clearTimeout:timers.clearTimeout});
  self.onmessage({data:{kind:'start',port:{},session_id:id}});await new Promise(resolve=>setTimeout(resolve,5));
  return {views,refreshed,listed,get listCount(){return listCount;},nodes:()=>nodes(views.at(-1)),click:node_id=>handler({kind:'click',node_id})};
}
function nodes(view){const result=[];const walk=node=>{result.push(node);node.children?.forEach(walk);node.items?.forEach(walk);};walk(view.root);view.navigation?.forEach(walk);return result;}
const node=(ui,node_id)=>ui.nodes().find(item=>item.id===node_id);

test('Refresh paints the cached rows with a Syncing status before the network resolves',async()=>{
  const network=deferred(),ui=await start({refresh:()=>network.promise});
  const pending=ui.click('refresh');
  assert.ok(node(ui,'mail_'+id.replaceAll('-','')),'the cached row is painted immediately');
  assert.match(node(ui,'status').text,/Syncing/);
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
  let refreshCount=0;const ui=await start({timers,refresh:async()=>{refreshCount++;return refreshCount===1?{outcome:'completed',freshness:{complete:false,provider_observed:false}}:{outcome:'completed',items:[arrived],next_cursor:null,freshness:{complete:true,provider_observed:true}};}});
  await ui.click('refresh');
  assert.ok(node(ui,'mail_'+id.replaceAll('-','')),'the cached row is still shown while syncing');
  assert.match(node(ui,'status').text,/Syncing/);
  assert.equal(scheduled.length,1,'exactly one bounded re-poll is scheduled');
  scheduled[0]();
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(refreshCount,2);
  assert.ok(node(ui,'mail_'+secondId.replaceAll('-','')),'the observation result appears after the re-poll');
});
