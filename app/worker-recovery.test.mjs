import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile,writeFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const root=process.env.PROBE_EMAIL_ROOT?pathToFileURL(process.env.PROBE_EMAIL_ROOT.replaceAll('\\','/')+'/'):new URL('../',import.meta.url);
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',digest='sha256:'+'a'.repeat(64);
const mail={record_id:id,content_digest:digest,label:'Message A',data:{provider:'gmail',subject:'Message A',sender:'Sender <sender@example.test>',date:'2026-10-13T10:00:00Z',preview:'Preview',seen:false}};
const page=items=>({outcome:'completed',items,next_cursor:null,freshness:{complete:true,observed_at:'2026-10-13T10:00:00Z'}});
const healthy={connection:'connected',background:{state:'healthy',since:'2026-10-13T10:00:00Z',reason:'live'}};
const targets=[{key:'primary',label:'Account A'},{key:'secondary',label:'Account B'}];
const flatten=view=>{const result=[];const walk=node=>{result.push(node);node.children?.forEach(walk);node.items?.forEach(walk);};walk(view.root);view.navigation?.forEach(walk);return result;};
async function start({accounts=targets,listTargets,listMailbox,listRecords,readRecordMeta,request,refresh}={}){
 const views=[],calls=[];let handler;
 const sdk={render:view=>views.push(view),onEvent:callback=>handler=callback,
 listAccountTargets:async()=>listTargets?listTargets():({targets:accounts,selected_target_key:'primary'}),
 listDataResources:async(...args)=>{calls.push(['listDataResources',...args]);return listMailbox?listMailbox(...args):page([mail]);},
 refreshDataResource:async(...args)=>refresh?refresh(...args):({outcome:'completed'}),
 listRecords:async(...args)=>{calls.push(['listRecords',...args]);return listRecords?listRecords(...args):page([]);},
 readRecordMeta:async(...args)=>readRecordMeta?readRecordMeta(...args):{record_id:id,revision:1,content_digest:digest,status:'draft',summary:{}},
 request:async(...args)=>{calls.push(['request',...args]);return request?request(...args):{cancelled:true};}};
 const source=await readFile(new URL('app/worker.mjs',root),'utf8'),bindings={};
 for(const match of source.matchAll(/^import \{[^}]+\} from '(\.\/[^']+)';/gm))Object.assign(bindings,await import(new URL('app/'+match[1].slice(2),root)));
 const self={};vm.runInNewContext(source.replace(/^import .*;\r?\n/gm,''),{self,...bindings,createDeftExperienceSdk:()=>sdk,crypto:webcrypto,TextEncoder,Date,Map,setTimeout,clearTimeout});
 self.onmessage({data:{kind:'start',port:{},session_id:id}});await new Promise(resolve=>setTimeout(resolve,10));
 return {views,calls,nodes:()=>flatten(views.at(-1)),click:node_id=>handler({kind:'click',node_id}),input:(node_id,value)=>handler({kind:'input',node_id,value})};
}
const node=(ui,name)=>ui.nodes().find(item=>item.id===name);
const noHealthy=ui=>assert.equal(ui.nodes().some(item=>/Everything is healthy|^Connected$/u.test(item.text??'')),false);

test('probe worker: absent and partial health never claim healthy',async()=>{
 for(const accounts of [[targets[0]],[{...targets[0],health:healthy},targets[1]],[{...targets[0],health:{}}]]){
  const ui=await start({accounts});await ui.click('email_settings');noHealthy(ui);
 }
});

test('probe worker: Reconnect and Restore access carry the exact account reference',async()=>{
 for(const [health,kind,name]of [[{...healthy,connection:'disconnected'},'reconnect','health_reconnect_primary'],[{...healthy,background:{state:'ended',since:'2026-10-13T10:00:00Z',reason:'revoked'}},'restore_access','health_restore_primary']]){
  const ui=await start({accounts:[{...targets[0],health}]});await ui.click('email_settings');noHealthy(ui);
  const action=node(ui,name);assert.ok(action);assert.deepEqual(JSON.parse(JSON.stringify(action.connection_action)),{kind,target_key:'primary'});
  if(process.env.PROBE_WRITE_HEALTH_VIEW)await writeFile(process.env.PROBE_WRITE_HEALTH_VIEW,JSON.stringify(ui.views.at(-1)));
  await ui.click(name);assert.equal(ui.calls.filter(call=>call[0]==='request').length,0,'worker click only emits navigation copy; Host must own connection action');
 }
});

test('probe worker: paused background retains a specific paused copy',async()=>{
 const ui=await start({accounts:[{...targets[0],health:{...healthy,background:{state:'paused',since:'2026-10-13T10:00:00Z',reason:'lapsed'}}}]});await ui.click('email_settings');noHealthy(ui);assert.match(node(ui,'health_summary').text,/^Background sync paused since /u);
});

test('probe worker: live-shaped account catalog yields a renderable settings snapshot',async()=>{
 const ui=await start({accounts:[targets[0]]});await ui.click('email_settings');
 if(process.env.PROBE_WRITE_SETTINGS_VIEW)await writeFile(process.env.PROBE_WRITE_SETTINGS_VIEW,JSON.stringify(ui.views.at(-1)));
 noHealthy(ui);
});

test('probe worker: pre-run rejected and unknown organize results have distinct recovery',async()=>{
 for(const response of ['throw','unknown']){
  let attempts=0;const ui=await start({accounts:[targets[0]],request:async()=>{attempts++;if(response==='throw')throw Error('Controlled pre-run failure');return {unknown:true};}});await ui.click('mail_'+id.replaceAll('-',''));await ui.click('organize_archive');
  assert.equal(node(ui,'organize_archive').disabled,response==='unknown');await ui.click('organize_archive');assert.equal(attempts,response==='unknown'?1:2);
  await ui.click('refresh');assert.equal(node(ui,'organize_archive').disabled,false);
 }
});

test('probe worker: Refresh never clears an existing action run lock',async()=>{
 const ui=await start({accounts:[targets[0]],request:async()=>({run:{id:other}})});await ui.click('mail_'+id.replaceAll('-',''));await ui.click('organize_archive');await ui.click('refresh');assert.equal(node(ui,'organize_archive').disabled,true);assert.ok(node(ui,'check_mailbox_action'));
});

test('probe worker: Refresh never clears an existing batch lock',async()=>{
 const messages=Array.from({length:26},(_,index)=>({...mail,record_id:`11111111-1111-4111-8111-${String(index+1).padStart(12,'0')}`}));
 const ui=await start({accounts:[targets[0]],listMailbox:async()=>page(messages),request:async(_kind,key,{children})=>key==='review_resource_action_batch'?{batch:{id:other},items:children.map(()=>({run_id:other})),prepared_refs:children.map(()=>({snapshot_id:other,snapshot_digest:digest}))}:null});
 await ui.click('toggle_selection');await ui.click('select_loaded');await ui.click('organize_archive');await ui.click('refresh');assert.equal(node(ui,'organize_archive').disabled,true);assert.ok(node(ui,'check_mailbox_action'));
});

test('probe worker: folder dialog rejection before run leaves actions retryable',async()=>{
 const catalog={record_id:id,revision:1,content_digest:digest,status:'submitted',summary:{kind:'catalog',name:'Folders'}};
 const ui=await start({accounts:[targets[0]],listRecords:async store=>page(store==='folders'?[catalog]:[]),readRecordMeta:async()=>catalog,request:async()=>{throw Error('Controlled pre-run folder failure');}});
 await ui.click('email_settings');await ui.click('folder_catalog');await ui.input('folder_name','New folder');await ui.click('folder_create');assert.equal(node(ui,'folder_create').disabled,false);assert.match(node(ui,'status').text,/could not start/u);
});

test('probe worker: rule dialog rejection before run leaves actions retryable',async()=>{
 const rule={store_key:'rules',record_id:other,revision:1,content_digest:digest,status:'draft',summary:{title:'Test rule',enabled:true}},order={record_id:id,revision:1,content_digest:digest,status:'draft',summary:{order_digest:digest}};
 const ui=await start({accounts:[targets[0]],listRecords:async store=>page(store==='rules'?[rule]:store==='rules_order'?[order]:[]),readRecordMeta:async store=>store==='rules'?rule:order,listMailbox:async(_store,_resource,_cursor,query)=>({...page([mail]),...(query.startsWith('rule-preview:')?{search:{status:'supported',original_query:query}}:{})}),request:async()=>{throw Error('Controlled pre-run rule failure');}});
 await ui.click('email_settings');await ui.click('manual_rules');await ui.click('rule_'+other.replaceAll('-',''));await ui.click('rules_preview');await ui.click('rule_match_'+id.replaceAll('-',''));await ui.click('rules_review');assert.equal(node(ui,'rules_review').disabled,false);assert.match(node(ui,'status').text,/could not start/u);
});

test('probe worker: account switch clears old rows before a pending target load and ignores ordinary clicks',async()=>{
 let finish;const ui=await start({listMailbox:async(_store,_resource,_cursor,_query,target)=>target==='secondary'?new Promise(resolve=>finish=resolve):page([mail])});await ui.click('mail_'+id.replaceAll('-',''));
 const pending=ui.click('account_pick_1');await new Promise(resolve=>setTimeout(resolve,0));assert.equal(node(ui,'mail_body'),undefined);assert.equal(node(ui,'mail_'+id.replaceAll('-','')),undefined);await ui.click('account_pick_0');finish(page([{...mail,record_id:other,data:{...mail.data,subject:'Message B'}}]));await pending;
 assert.equal(node(ui,'account_pick_1').selected,true);assert.equal(node(ui,'mail_'+id.replaceAll('-','')),undefined);assert.ok(node(ui,'mail_'+other.replaceAll('-','')));
});

test('probe worker: switching accounts does not reuse the previous account custom folder reference',async()=>{
 const folder={record_id:other,revision:1,content_digest:digest,status:'submitted',summary:{kind:'folder',name:'A private folder',move_allowed:true}};
 const ui=await start({listRecords:async store=>page(store==='folders'?[folder]:[]),readRecordMeta:async()=>folder});
 await ui.click('email_settings');await ui.click('folder_catalog');await ui.click('catalog_'+other.replaceAll('-',''));await ui.click('folder_open');
 await ui.click('account_pick_1');const last=ui.calls.filter(call=>call[0]==='listDataResources').at(-1);
 assert.equal(last.at(-1),'secondary');assert.doesNotMatch(last[4],/folder-ref:/u,'account A opaque folder reference must not be sent as account B query');
});

test('probe worker: untrusted mail strings remain scalar nodes and full body stays a trusted record reference',async()=>{
 const attack='<img src=x onerror=alert(1)><script>alert(2)</script>';const ui=await start({accounts:[{...targets[0],label:attack}],listMailbox:async()=>page([{...mail,label:attack,data:{...mail.data,subject:attack,sender:attack,preview:attack,body_html:attack,body:attack}}])});await ui.click('mail_'+id.replaceAll('-',''));
 assert.equal(node(ui,'mail_subject').kind,'text');assert.equal(node(ui,'mail_subject').text,attack);assert.equal(node(ui,'mail_body').kind,'record_document');assert.equal(Object.hasOwn(node(ui,'mail_body'),'content'),false);assert.equal(ui.nodes().some(item=>['html','raw_html','iframe','script'].includes(item.kind)),false);
 if(process.env.PROBE_WRITE_UNTRUSTED_VIEW)await writeFile(process.env.PROBE_WRITE_UNTRUSTED_VIEW,JSON.stringify(ui.views.at(-1)));
});

test('probe worker: switching accounts resets the search query and returns to Inbox',async()=>{
 const ui=await start({accounts:targets});
 await ui.click('toggle_search');await ui.input('query','from:old@example.test');await ui.click('search');
 assert.match(ui.calls.filter(call=>call[0]==='listDataResources').at(-1)[4],/from:old@example\.test/u);
 await ui.click('account_pick_1');
 const last=ui.calls.filter(call=>call[0]==='listDataResources').at(-1);
 assert.equal(last.at(-1),'secondary');assert.equal(last[4],'in:inbox');
 assert.equal(node(ui,'search_controls'),undefined);
 assert.equal(node(ui,'query'),undefined);
});
