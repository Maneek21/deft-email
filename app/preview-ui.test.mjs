import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {DeftExperienceRecordFormV3NodeSchema,parseDeftExperienceMenuNode} from '@deft/app-kit';

const id='11111111-1111-4111-8111-111111111111',digest='sha256:'+'a'.repeat(64);
const mail={record_id:id,content_digest:digest,label:'Preview message',data:{provider:'gmail',subject:'Preview message',sender:'Sender <sender@example.test>',date:'2026-10-13T10:00:00Z',preview:'A controlled preview message.'}};
const row={record_id:id,revision:2,content_digest:digest,status:'draft',summary:{subject:'Saved preview draft',to:'recipient@example.test'}};
async function start({refresh=async()=>({outcome:'completed'}),targets=[{key:'primary',label:'Primary account'}],selectedTarget=targets[0]?.key,messages=[mail],listMailbox,listSaved,createSaved,request}={}){
 const views=[],listedTargets=[],listedStores=[];let handler;
 const sdk={render:view=>{const ids=new Set();for(const node of nodes(view)){assert.ok(!ids.has(node.id),`Duplicate node ${node.id}`);ids.add(node.id);}views.push(view);},onEvent:event=>handler=event,
  listAccountTargets:async()=>({targets,selected_target_key:selectedTarget}),
  listDataResources:async(_store,_resource,_cursor,_query,target)=>{listedTargets.push(target);return listMailbox?listMailbox(target):{outcome:'completed',items:messages,next_cursor:null,freshness:{complete:true,observed_at:'2026-10-13T10:00:00Z'}};},refreshDataResource:refresh,
  listRecords:async store=>{listedStores.push(store);return listSaved?listSaved(store):{outcome:'completed',items:store==='drafts'?[row]:[],next_cursor:null};},readRecordMeta:async()=>row,
  createRecord:async(store,record_id,value,refs)=>createSaved?createSaved(store,record_id,value,refs):({outcome:'completed',record:{...row,record_id}}),request};
 const source=await readFile(new URL('./worker.mjs',import.meta.url),'utf8'),bindings={};
 for(const match of source.matchAll(/^import \{[^}]+\} from '(\.\/[^']+)';/gm))Object.assign(bindings,await import(match[1]));
 const self={};vm.runInNewContext(source.replace(/^import .*;\r?\n/gm,''),{self,...bindings,createDeftExperienceSdk:()=>sdk,crypto:webcrypto,TextEncoder,Date,Map,setTimeout,clearTimeout});
 self.onmessage({data:{kind:'start',port:{},session_id:id}});await new Promise(resolve=>setTimeout(resolve,5));
 return {views,listedTargets,listedStores,nodes:()=>nodes(views.at(-1)),click:node_id=>handler({kind:'click',node_id}),input:event=>handler({kind:'input',...event})};
}
function nodes(view){const result=[];const walk=node=>{result.push(node);node.children?.forEach(walk);node.items?.forEach(walk);};walk(view.root);view.navigation?.forEach(walk);return result;}
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

test('actual Compose view selects its packed Kit v3 form capability before Host admission',async()=>{
 const ui=await start();await ui.click('compose');const view=ui.views.at(-1),form=node(ui,'draft_form');
 assert.ok(view.capabilities.includes('record_form.v3'),'Host budgets use selected view capabilities, not manifest capabilities');
 assert.ok(!view.capabilities.includes('record_form.v1'),'all active draft forms use v3; settings keep v2');
 assert.ok(view.capabilities.length<=13);assert.equal(new Set(view.capabilities).size,view.capabilities.length);
 const parsed=DeftExperienceRecordFormV3NodeSchema.safeParse(form);assert.equal(parsed.success,true,parsed.success?'':JSON.stringify(parsed.error.issues));
 assert.equal(form.seed.schema_version,'deft.record_form_seed.v1');assert.equal(form.seed.value.to,'');
 assert.equal(form.expected_revision,0);assert.equal(form.disabled,false);
});

test('new compose retains its private note profile through first save and queued edits',async()=>{
 const ui=await start();await ui.click('compose');const form=node(ui,'draft_form'),profile=form.profile;
 assert.ok(profile.fields.some(field=>field.field==='author_note'));
 for(const [record_state,dirty] of [['saving',true],['saved',false]]){
  await ui.input({node_id:'draft_form',record_id:form.record_id,record_revision:1,content_digest:digest,record_state,dirty,valid:true});
  assert.deepEqual(node(ui,'draft_form').profile,profile);assert.equal(node(ui,'draft_form').seed,undefined);
 }
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


test('daily navigation keeps settings out of the mailbox and opening its hub does not read private stores',async()=>{
 const ui=await start();assert.deepEqual(Array.from(ui.views.at(-1).navigation,item=>item.label),['Inbox','Sent','Drafts','Starred','Archive','Spam','Trash','Settings']);
 const before=[...ui.listedStores];await ui.click('email_settings');assert.ok(node(ui,'email_settings_title'));assert.ok(node(ui,'saved_content'));assert.ok(node(ui,'manual_rules'));assert.ok(node(ui,'folder_catalog'));assert.ok(node(ui,'imported_history'));
 assert.deepEqual(ui.listedStores,before);assert.equal(node(ui,'provider_setup_help'),undefined);
 await ui.click('provider_help');assert.ok(node(ui,'provider_setup_help'));await ui.click('provider_help');assert.equal(node(ui,'provider_setup_help'),undefined);
 await ui.click('saved_content');assert.ok(node(ui,'settings_templates'));assert.equal(node(ui,'provider_setup_help'),undefined);await ui.click('settings_back');assert.ok(node(ui,'email_settings_title'));await ui.click('settings_mailbox');assert.ok(node(ui,'message_list'));
});

test('reader keeps one native menu and the exact Host print binding without inline action stacks',async()=>{
 const ui=await start();await ui.click('mail_'+id.replaceAll('-',''));
 assert.ok(node(ui,'reply'));assert.equal(node(ui,'reader_more').kind,'menu');assert.ok(node(ui,'reply_all'));assert.ok(node(ui,'forward'));
 assert.equal(node(ui,'print_message').icon,'print');assert.equal(node(ui,'mail_body').print_control_id,'print_message');assert.equal(node(ui,'mail_body').printable,true);
 assert.ok(node(ui,'organize_archive'));assert.equal(node(ui,'reader_tools'),undefined);assert.equal(node(ui,'organize_menu'),undefined);assert.ok(node(ui,'mail_body'));
 await ui.click('toggle_selection');assert.ok(node(ui,'reply'));assert.ok(node(ui,'reader_more'));assert.ok(node(ui,'mail_body'));
});

test('compose and draft list have one contextual header without disabled mailbox search',async()=>{
 const ui=await start();await ui.click('compose');assert.ok(node(ui,'compose_title'));assert.ok(node(ui,'minimize_draft'));assert.ok(node(ui,'close_draft'));assert.equal(node(ui,'toggle_search'),undefined);assert.equal(node(ui,'refresh'),undefined);assert.equal(node(ui,'compose'),undefined);
 const form=node(ui,'draft_form');await ui.input({node_id:'draft_form',record_id:form.record_id,record_revision:0,content_digest:'sha256:'+'0'.repeat(64),record_state:'unsaved',dirty:true,valid:true});
 await ui.click('email_settings');assert.ok(node(ui,'draft_form'));assert.equal(node(ui,'email_settings_title'),undefined);
});


test('a slow foreground refresh shows one progress notice while keeping the original reader and clears it after completion',async()=>{
 let finish;const ui=await start({refresh:()=>new Promise(resolve=>finish=resolve)});await ui.click('mail_'+id.replaceAll('-',''));const pending=ui.click('refresh');
 assert.equal(node(ui,'mail_progress').text,'Refreshing…');assert.equal(node(ui,'refresh').disabled,true);assert.equal(node(ui,'mail_subject').text,mail.data.subject);
 finish({outcome:'completed'});await pending;assert.equal(node(ui,'mail_progress'),undefined);assert.equal(node(ui,'refresh').disabled,false);assert.equal(node(ui,'mail_subject').text,mail.data.subject);
});

test('selection replaces the mailbox header and uses menus instead of an inline action grid',async()=>{
 const ui=await start();const parent=node(ui,'message_list');assert.equal(node(ui,'mailbox_header').layout,'toolbar');assert.equal(parent.children.filter(item=>item.layout==='toolbar').length,1);
 assert.equal(node(ui,'account_catalog'),undefined,'a single account needs no second filter row');
 await ui.click('toggle_selection');assert.equal(node(ui,'folder_title'),undefined);assert.equal(node(ui,'mailbox_header').layout,'toolbar');assert.equal(node(ui,'message_list').children.filter(item=>item.layout==='toolbar').length,1);
 assert.equal(node(ui,'selection_menu').kind,'menu');assert.equal(node(ui,'select_loaded').label,'Select loaded messages (up to 100)');assert.equal(node(ui,'select_loaded').disabled,false);
 await ui.click('select_loaded');assert.equal(node(ui,'selection_count').text,'1 selected');assert.equal(node(ui,'selection_menu').icon,'check');assert.equal(node(ui,'organize_menu'),undefined);assert.equal(node(ui,'selection_toolbar'),undefined);
 assert.equal(node(ui,'organize_restore'),undefined);assert.equal(node(ui,'organize_not_spam'),undefined);assert.equal(node(ui,'bulk_more').kind,'menu');assert.ok(node(ui,'selection_actions').children.length<=4,'four coarse targets fit without wrapping');
 await ui.click('clear_selection');assert.equal(node(ui,'selection_count').text,'0 selected');assert.equal(node(ui,'clear_selection').disabled,true);
 await ui.click('toggle_selection');assert.equal(node(ui,'selection_menu'),undefined);assert.equal(node(ui,'folder_title').text,'Inbox');assert.equal(node(ui,'mail_'+id.replaceAll('-','')).icon,undefined);
});

test('bulk read and star choices use known metadata and keep mixed-state alternatives explicit',async()=>{
 for(const [seen,flagged,expected,absent]of [[true,true,['organize_mark_unread','organize_unstar'],['organize_mark_read','organize_star']],[false,false,['organize_mark_read','organize_star'],['organize_mark_unread','organize_unstar']]]){
  const ui=await start({messages:[{...mail,data:{...mail.data,seen,flagged}}]});await ui.click('toggle_selection');await ui.click('select_loaded');
  for(const key of expected)assert.ok(node(ui,key));for(const key of absent)assert.equal(node(ui,key),undefined);
 }
 const mixed=await start({messages:[{...mail,data:{...mail.data,seen:true,flagged:true}},{...mail,record_id:'22222222-2222-4222-8222-222222222222',data:{...mail.data,seen:false,flagged:false}}]});await mixed.click('toggle_selection');await mixed.click('select_loaded');
 assert.equal(node(mixed,'organize_mark_read').label,'Mark selected read');assert.equal(node(mixed,'organize_mark_unread').label,'Mark selected unread');assert.ok(node(mixed,'organize_star'));assert.ok(node(mixed,'organize_unstar'));
 assert.ok(node(mixed,'bulk_more').items.some(item=>item.id==='organize_mark_read'));assert.ok(node(mixed,'bulk_more').items.some(item=>item.id==='organize_mark_unread'));
});

test('contextual folder choices do not offer restoring or unspamming an Inbox message',async()=>{
 const ui=await start();await ui.click('mail_'+id.replaceAll('-',''));assert.equal(node(ui,'organize_restore'),undefined);assert.equal(node(ui,'organize_not_spam'),undefined);
 await ui.click('folder_trash');await ui.click('mail_'+id.replaceAll('-',''));assert.ok(node(ui,'organize_restore'));assert.equal(node(ui,'organize_trash'),undefined);
 await ui.click('folder_spam');await ui.click('mail_'+id.replaceAll('-',''));assert.ok(node(ui,'organize_not_spam'));assert.equal(node(ui,'organize_spam'),undefined);
});

test('compact actions still submit exact current sources for human review and block a second unknown dispatch',async()=>{
 const calls=[];const ui=await start({request:async(...args)=>{calls.push(args);throw Error('lost review response');}});await ui.click('mail_'+id.replaceAll('-',''));
 await ui.click('organize_archive');assert.equal(calls.length,1);assert.equal(calls[0][0],'dialog');assert.equal(calls[0][1],'review_resource_action');assert.equal(calls[0][2].operation_key,'archive');assert.deepEqual(JSON.parse(JSON.stringify(calls[0][2].sources)),[{resource_key:'inbox',record_id:id,content_digest:digest}]);
 assert.equal(node(ui,'organize_archive').disabled,true);assert.match(node(ui,'status').text,/could not be confirmed/);await ui.click('organize_archive');assert.equal(calls.length,1);
});

test('reader menu Reply all and Forward preserve exact-source draft creation without a Send',async()=>{
 for(const action of ['reply_all','forward']){
  const creates=[],requests=[],ui=await start({createSaved:async(store,record_id,value,refs)=>{creates.push({store,value,refs});return {outcome:'completed',record:{...row,record_id}};},request:async(...args)=>requests.push(args)});
  await ui.click('mail_'+id.replaceAll('-',''));assert.ok(node(ui,'reader_more').items.some(item=>item.id===action));await ui.click(action);
  assert.equal(creates.length,1);assert.equal(creates[0].store,'drafts');assert.equal(creates[0].value.mode,action);assert.deepEqual(JSON.parse(JSON.stringify(creates[0].refs)),[{resource_key:'inbox',record_id:id,content_digest:digest}]);assert.ok(node(ui,'draft_form'));assert.equal(requests.length,0);
 }
});

test('reader menu Conversation dispatches only the bounded selected-message query',async()=>{
 const calls=[],ui=await start({request:async(...args)=>{calls.push(args);return {outcome:'completed',items:[mail],next_cursor:null};}});await ui.click('mail_'+id.replaceAll('-',''));await ui.click('conversation');
 assert.equal(calls.length,1);assert.equal(calls[0][0],'app_data');assert.equal(calls[0][1],'drafts');assert.equal(calls[0][2].operation,'resource_list');assert.equal(calls[0][2].input.anchor_record_id,id);assert.equal(calls[0][2].input.limit,10);assert.equal(node(ui,'conversation_count').text,'1 messages loaded');
});

test('loaded selection stays bounded and unavailable provider operations never dispatch a review',async()=>{
 const messages=Array.from({length:105},(_,i)=>({...mail,record_id:`11111111-1111-4111-8111-${String(i+1).padStart(12,'0')}`})),ui=await start({messages});await ui.click('toggle_selection');await ui.click('select_loaded');assert.equal(node(ui,'selection_count').text,'100 selected');
 const calls=[],unsupported=await start({messages:[{...mail,data:{...mail.data,provider:'unsupported'}}],request:async(...args)=>calls.push(args)});await unsupported.click('mail_'+id.replaceAll('-',''));assert.equal(node(unsupported,'organize_archive'),undefined);await unsupported.click('organize_archive');assert.equal(calls.length,0);assert.match(node(unsupported,'status').text,/Organize is unavailable/);
});

test('reader top menu nominates Task and Knowledge through the current governed document',async()=>{
 const calls=[],ui=await start({request:async(...args)=>calls.push(args)});await ui.click('mail_'+id.replaceAll('-',''));
 const more=node(ui,'reader_more'),document=node(ui,'mail_body');
 assert.deepEqual(parseDeftExperienceMenuNode(JSON.parse(JSON.stringify(more))),JSON.parse(JSON.stringify(more)),'the packed public Kit validates native integration nominations');
 assert.deepEqual(JSON.parse(JSON.stringify(more.items.slice(0,2))),[
  {id:'create_task',label:'Create task',integration:{kind:'task',document_id:'mail_body'}},
  {id:'knowledge',label:'Knowledge',integration:{kind:'knowledge',document_id:'mail_body'}}
 ]);
 assert.equal(document.record_id,id);assert.equal(document.content_digest,digest);assert.equal(calls.length,0);
 await ui.click('create_task');await ui.click('knowledge');assert.equal(calls.length,0,'Host owns nomination and permission review; Worker calls no integration API');
 await ui.click('email_settings');await ui.click('saved_content');await ui.click('settings_preferences');assert.match(node(ui,'settings_empty').text,/load automatically.*ask before loading/i);
});
