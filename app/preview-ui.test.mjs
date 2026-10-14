import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';

const id='11111111-1111-4111-8111-111111111111',digest='sha256:'+'a'.repeat(64);
const mail={record_id:id,content_digest:digest,label:'Preview message',data:{provider:'gmail',subject:'Preview message',sender:'Sender <sender@example.test>',date:'2026-10-13T10:00:00Z',preview:'A controlled preview message.'}};
const row={record_id:id,revision:2,content_digest:digest,status:'draft',summary:{subject:'Saved preview draft',to:'recipient@example.test'}};
async function start({refresh=async()=>({outcome:'completed'}),targets=[{key:'primary',label:'Primary account'}],selectedTarget=targets[0]?.key,messages=[mail],listMailbox,listSaved,request}={}){
 const views=[],listedTargets=[],listedStores=[];let handler;
 const sdk={render:view=>{const ids=new Set();for(const node of nodes(view)){assert.ok(!ids.has(node.id),`Duplicate node ${node.id}`);ids.add(node.id);}views.push(view);},onEvent:event=>handler=event,
  listAccountTargets:async()=>({targets,selected_target_key:selectedTarget}),
  listDataResources:async(_store,_resource,_cursor,_query,target)=>{listedTargets.push(target);return listMailbox?listMailbox(target):{outcome:'completed',items:messages,next_cursor:null,freshness:{complete:true,observed_at:'2026-10-13T10:00:00Z'}};},refreshDataResource:refresh,
  listRecords:async store=>{listedStores.push(store);return listSaved?listSaved(store):{outcome:'completed',items:store==='drafts'?[row]:[],next_cursor:null};},readRecordMeta:async()=>row,
  createRecord:async(_store,record_id)=>({outcome:'completed',record:{...row,record_id}}),request};
 const source=await readFile(new URL('./worker.mjs',import.meta.url),'utf8'),bindings={};
 for(const match of source.matchAll(/^import \{[^}]+\} from '(\.\/[^']+)';/gm))Object.assign(bindings,await import(match[1]));
 const self={};vm.runInNewContext(source.replace(/^import .*;\r?\n/gm,''),{self,...bindings,createDeftExperienceSdk:()=>sdk,crypto:webcrypto,TextEncoder,Date,Map,setTimeout,clearTimeout});
 self.onmessage({data:{kind:'start',port:{},session_id:id}});await new Promise(resolve=>setTimeout(resolve,5));
 return {views,listedTargets,listedStores,nodes:()=>nodes(views.at(-1)),click:node_id=>handler({kind:'click',node_id}),input:event=>handler({kind:'input',...event})};
}
function nodes(view){const result=[];const walk=node=>{result.push(node);node.children?.forEach(walk);};walk(view.root);view.navigation?.forEach(walk);return result;}
const node=(ui,id)=>ui.nodes().find(item=>item.id===id);

test('Email opens the current account with Compose ready; all-account fanout is explicit',async()=>{
 const ui=await start({targets:[{key:'first',label:'First account'},{key:'current',label:'Current account'}],selectedTarget:'current',messages:[]});
 assert.deepEqual(ui.listedTargets,['current']);assert.equal(node(ui,'account_pick_1').selected,true);assert.equal(node(ui,'compose').disabled,false);
 await ui.click('account_all');assert.deepEqual(ui.listedTargets,['current','first','current']);assert.equal(node(ui,'account_all').selected,true);
 await ui.click('refresh');assert.equal(node(ui,'account_all').selected,true);
});

test('selection appears only on request and exits without leaving checkbox controls',async()=>{
 const ui=await start();assert.equal(node(ui,'select_loaded'),undefined);assert.equal(node(ui,'mail_'+id.replaceAll('-','')).icon,undefined);
 await ui.click('toggle_selection');await ui.click('select_loaded');assert.equal(node(ui,'selection_count').text,'1 selected');
 await ui.click('toggle_selection');assert.equal(node(ui,'select_loaded'),undefined);assert.equal(node(ui,'mail_'+id.replaceAll('-','')).icon,undefined);
});
test('Refresh failure retains the selected message and reports the failure truthfully',async()=>{
 const ui=await start({refresh:async()=>{throw Error('Controlled provider failure');}});await ui.click('mail_'+id.replaceAll('-',''));await ui.click('refresh');
 assert.equal(node(ui,'mail_subject').text,'Preview message');assert.equal(node(ui,'mail_'+id.replaceAll('-','')).label,'Preview message');assert.match(node(ui,'status').text,/Refresh could not be completed/);
});
test('reader keeps account and date context without placing optional jobs before the body',async()=>{
 const ui=await start();await ui.click('mail_'+id.replaceAll('-',''));
 const children=node(ui,'reader_panel').children,body=children.findIndex(item=>item.kind==='record_document');
 assert.ok(node(ui,'mail_date')?.text);assert.equal(node(ui,'mail_'+id.replaceAll('-','')).eyebrow,mail.data.sender);
 assert.ok(children.filter(item=>item.kind==='local_job_schedule').every(item=>children.indexOf(item)>body));
});
test('compose uses the trusted recipient profile and has one owner for draft save status',async()=>{
 const ui=await start();await ui.click('compose');const form=node(ui,'draft_form');
 assert.equal(form.profile.schema_version,'deft.record_form_profile.v3');assert.equal(form.profile.fields.find(field=>field.kind==='verified_identity').label,'From');
 const recipients=Array.from(form.profile.fields).filter(field=>field.kind==='text'&&field.format==='mailbox_list');assert.deepEqual(recipients.map(field=>field.label),['To','Cc','Bcc']);
 assert.ok(recipients.every(field=>field.presentation==='pills'));assert.deepEqual(recipients.map(field=>!!field.optional),[false,true,true]);assert.equal(node(ui,'saved_version'),undefined);
});
test('account filters stay compact and empty results keep actionable controls',async()=>{
 const ui=await start({messages:[],targets:[{key:'primary',label:'Primary'},{key:'secondary',label:'Secondary'}]});
 assert.equal(node(ui,'account_catalog').layout,'horizontal');assert.ok(node(ui,'refresh'));assert.ok(node(ui,'toggle_search'));assert.match(node(ui,'mail_empty').text,/No messages/);
});
test('preview omits deferred job and mirror controls while preserving core settings',async()=>{
 const ui=await start();assert.equal(node(ui,'inbox_unread'),undefined);assert.equal(node(ui,'local_jobs_snooze'),undefined);assert.equal(node(ui,'local_jobs_follow_up'),undefined);
 await ui.click('mail_'+id.replaceAll('-',''));assert.equal(ui.nodes().some(item=>item.kind==='local_job_schedule'),false);
 await ui.click('saved_content');assert.equal(node(ui,'provider_draft_mirror'),undefined);assert.ok(node(ui,'settings_preferences'));assert.ok(node(ui,'settings_signatures'));
});
test('long author-controlled labels remain inside their UTF8 byte budget with a readable ellipsis',async()=>{
 const ui=await start({targets:[{key:'primary',label:'账户'.repeat(100)}],messages:[{...mail,data:{...mail.data,sender:'账户'.repeat(100),subject:'账户'.repeat(100)}}]});
 const button=node(ui,'mail_'+id.replaceAll('-',''));assert.ok(new TextEncoder().encode(button.label).length<=128);assert.match(button.label,/…$/);assert.doesNotMatch(JSON.stringify(ui.views.at(-1)),/Â·|â€¦/);
});

const accountSwitch={targets:[{key:'primary',label:'Sender'},{key:'denied',label:'Recipient'}],listMailbox:async target=>{
 if(target==='denied')throw Error('Account access denied');
 return {outcome:'completed',items:[mail],next_cursor:null,freshness:{complete:true}};
}};
test('failed account switch clears previous account rows and reader before changing the filter',async()=>{
 const ui=await start(accountSwitch);await ui.click('mail_'+id.replaceAll('-',''));await ui.click('account_pick_1');
 assert.equal(node(ui,'account_pick_1').selected,true);
 assert.equal(node(ui,'mail_'+id.replaceAll('-','')),undefined);assert.equal(node(ui,'mail_subject'),undefined);
 assert.equal(ui.nodes().some(item=>item.kind==='record_document'),false);assert.match(node(ui,'status').text,/account/i);
});
test('changing accounts detaches a minimized saved draft without deleting its saved record',async()=>{
 const ui=await start(accountSwitch);await ui.click('drafts');await ui.click('draft_'+id.replaceAll('-',''));await ui.click('minimize_draft');
 assert.ok(node(ui,'minimized_draft'));await ui.click('account_pick_1');
 assert.equal(node(ui,'minimized_draft'),undefined);assert.equal(ui.nodes().some(item=>item.kind==='record_form'),false);
});
test('foreground inbox does not request the deferred unread-count store',async()=>{
 const ui=await start();await ui.click('refresh');assert.equal(ui.listedStores.includes('mailbox_status'),false);
});
test('a read filter different from the compose account explains the existing account settings transition',async()=>{
 const ui=await start({targets:[{key:'primary',label:'Sender'},{key:'other',label:'Recipient'}]});await ui.click('account_pick_1');
 assert.equal(node(ui,'compose').disabled,true);assert.match(node(ui,'compose_account_notice').text,/Sender/);
 assert.match(node(ui,'compose_account_notice').text,/Email settings.*Accounts/);
});
test('clicking the selected account filter performs no duplicate mailbox read',async()=>{
 const ui=await start();await ui.click('account_pick_0');assert.deepEqual(ui.listedTargets,['primary']);
});
test('an unsaved compose cannot be cleared by an account filter event',async()=>{
 const ui=await start(accountSwitch);await ui.click('compose');
 const form=node(ui,'draft_form');await ui.input({node_id:'draft_form',record_id:form.record_id,record_revision:0,content_digest:'sha256:'+'0'.repeat(64),record_state:'unsaved',dirty:true,valid:true});
 await ui.click('account_pick_1');assert.ok(node(ui,'draft_form'));assert.equal(node(ui,'draft_form').record_id,form.record_id);
 assert.deepEqual(ui.listedTargets,['primary']);
});
for(const count of [1,26])test(`account switch removes undo for a completed ${count===1?'single action':'action batch'}`,async()=>{
 const messages=Array.from({length:count},(_,index)=>({...mail,record_id:`11111111-1111-4111-8111-${String(index+1).padStart(12,'0')}`}));
 const receipt={snapshot_id:id,snapshot_digest:digest},runs=new Map();let dialogCalls=0;
 const ui=await start({targets:accountSwitch.targets,messages,request:async(kind,key,input)=>{
  if(kind==='dialog'){dialogCalls++;const children=key==='review_resource_action_batch'?input.children:[input];
   const entries=children.map((child,index)=>{const run_id=`22222222-2222-4222-8222-${String(index+1).padStart(12,'0')}`;runs.set(run_id,child);return {run_id};});
   return children.length===1?{run:{id:entries[0].run_id},prepared_ref:receipt}:{batch:{id},items:entries,prepared_refs:children.map(()=>receipt)};
  }
  const child=runs.get(input.run_id);assert.ok(child);return {id:input.run_id,state:'succeeded',output:{operation_id:input.run_id,operation_key:child.operation_key,automatic_retry:false,item_count:child.sources.length,succeeded_count:child.sources.length,failed_count:0,items_json:JSON.stringify(child.sources.map(source=>({record_id:source.record_id,state:'succeeded'})))}};
 }});
 await ui.click('toggle_selection');await ui.click('select_loaded');await ui.click('organize_archive');await ui.click('check_mailbox_action');
 assert.ok(node(ui,'undo_mailbox_action'));await ui.click('account_pick_1');
 assert.equal(node(ui,'undo_mailbox_action'),undefined);await ui.click('undo_mailbox_action');assert.equal(dialogCalls,1);
});
test('another account reader never nominates the current compose account image preference',async()=>{
 const preference={...row,store_key:'preferences',summary:{external_images:'always'}};
 const ui=await start({targets:accountSwitch.targets,listSaved:async store=>({outcome:'completed',items:store==='preferences'?[preference]:[],next_cursor:null})});
 await ui.click('mail_'+id.replaceAll('-',''));assert.equal(node(ui,'mail_body').image_policy.record_id,id);
 await ui.click('account_pick_1');await ui.click('mail_'+id.replaceAll('-',''));assert.equal(node(ui,'mail_body').image_policy,undefined);
 await ui.click('account_pick_0');await ui.click('mail_'+id.replaceAll('-',''));assert.equal(node(ui,'mail_body').image_policy.record_id,id);
});
