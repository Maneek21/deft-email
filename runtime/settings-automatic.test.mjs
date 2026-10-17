import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {changeFixture,draftValue,cas} from './record-change-test-support.mjs';
import {buildRecordChange} from './record-change-native.mjs';
import {validateDataResult} from './data-contract.mjs';
import {dataInputDigest} from './data-contract.mjs';
const automatic={schema_version:'deft.signature_automatic.v1',enabled:true};
const sig=(extra={})=>({address:'fixture@example.test',plain:'Enabled signature',html:'<p>Enabled signature</p>',placement:'both',...extra});
async function enabled(f,extra={}){const source=await f.create('signatures',sig(extra));return (await f.run(f.request('record_save',{...cas(source),value:{...source.value,automatic}}))).record;}
const prepare=(f,destination,source)=>f.change('record_prepare_change',{...cas(destination),operation_key:'signature_default',invocation_mode:'initial',source:cas(source)});
const apply=(f,plan)=>f.change('record_apply_change',{...plan.destination,operation_key:plan.operation_key,invocation_mode:plan.invocation_mode,source:plan.source,prepared_id:plan.prepared_id,prepared_digest:plan.prepared_digest});

test('preferences create Ask only, one active account record, CAS Save and restart/status; policy is a sibling without human-save inference',async t=>{
 const f=await changeFixture(t);f.consents.preferences={consent_id:randomUUID(),consent_digest:'sha256:'+'7'.repeat(64),data_policy_digest:'sha256:'+'8'.repeat(64)};
 await assert.rejects(f.create('preferences',{external_images:'always'}),e=>e.code==='EMAIL_SETTINGS_CREATE_DENIED');
 const record=await f.create('preferences',{external_images:'ask'});
 const race=await Promise.allSettled([f.create('preferences',{external_images:'ask'}),f.create('preferences',{external_images:'ask'})]);assert.ok(race.every(x=>x.status==='rejected'&&x.reason.code==='EMAIL_SETTINGS_LIMIT'));
 const saved=(await f.run(f.request('record_save',{...cas(record),value:{external_images:'always'}}))).record;assert.equal(saved.revision,2);
 const readRequest=f.request('record_read',{store_key:'preferences',record_id:record.record_id}),read=await f.run(readRequest);assert.deepEqual(read.document_policy,{schema_version:'deft.app_record_document_policy.v1',field:'external_images',automatic_value:'always'});assert.equal(Object.hasOwn(read,'human_save'),false);assert.deepEqual(read.record.value,{external_images:'always'});
 const wrong={...read,human_save:{request_id:randomUUID()}};assert.throws(()=>validateDataResult(wrong,readRequest));
 await f.restart();assert.deepEqual((await f.run(f.request('record_read',{store_key:'preferences',record_id:record.record_id}))).record,saved);
 f.deny('preferences');await assert.rejects(f.run(f.request('record_read',{store_key:'preferences',record_id:record.record_id})));assert.equal(f.calls,3);
});

test('automatic activation forbidden at Create; missing or false remains manual; initial/manual nominations cannot substitute',async t=>{
 const f=await changeFixture(t),draft=await f.create('drafts',draftValue());
 await assert.rejects(f.create('signatures',sig({automatic})),e=>e.code==='EMAIL_SETTINGS_CREATE_DENIED');
 for(const marker of [undefined,{...automatic,enabled:false}]){const source=await f.create('signatures',sig(marker?{automatic:marker}:{}));await assert.rejects(f.run(prepare(f,draft,source)),e=>e.code==='EMAIL_SIGNATURE_DEFAULT_DENIED');await f.run(f.request('record_archive',cas(source)));}
 const source=await enabled(f),raw=prepare(f,draft,source);delete raw.input.invocation_mode;await assert.rejects(f.run(raw));
 const manual=prepare(f,draft,source);manual.input.operation_key='signature_apply';await assert.rejects(f.run(manual));assert.equal(f.calls,3);
});

test('enabled default uses exact primary identity, preserves existing fields, seals initial mode, lost Apply/restart has original status only',async t=>{
 const f=await changeFixture(t),source=await enabled(f),draft=await f.create('drafts',draftValue()),metadata=await f.run(f.request('connection_metadata',{store_key:'drafts'}));assert.deepEqual(metadata.primary_identity,{address:'fixture@example.test',label:'Fixture'});
 const plan=(await f.run(prepare(f,draft,source))).prepared_change;assert.equal(plan.invocation_mode,'initial');assert.equal(plan.value.managed_signature.preference_revision,2);assert.equal(plan.value.body,'Existing text\n\nEnabled signature');
 for(const key of ['to','cc','bcc','subject','mode','reply_record_id','attachments'])assert.deepEqual(plan.value[key],draft.value[key]);
 const altered=apply(f,plan);delete altered.input.invocation_mode;await assert.rejects(f.run(altered));
 const request=apply(f,plan);f.lose();await assert.rejects(f.run(request));await f.restart();f.deny('signatures');const receipt=await f.run(f.request('request_status',{store_key:'drafts',request_id:request.request_id}));assert.equal(receipt.request_status.state,'completed');assert.equal(receipt.request_status.revision,2);assert.equal(Object.hasOwn(receipt,'record'),false);
 const reopened=(await f.run(f.request('record_read',{store_key:'drafts',record_id:draft.record_id}))).record;assert.deepEqual(reopened.value,plan.value);f.allow();assert.equal((await f.run(request)).outcome,'indeterminate');await assert.rejects(f.run(prepare(f,reopened,source)),e=>e.code==='EMAIL_SIGNATURE_DEFAULT_DENIED');assert.equal(f.calls,3);
});

test('default placement and explicit sender are current, never first-alias fallback; marker/manual text remains unchanged on denial',()=>{
 const identity={address:'primary@example.test',label:'Primary'},source={store_key:'signatures',revision:2,value:{...sig(),address:identity.address,automatic}},destination={revision:1,content_revision:1,status:'draft',content:draftValue()},call=(d=destination,s=source,p=identity)=>buildRecordChange({operation_key:'signature_default',invocation_mode:'initial',destination:d,source:s,identities:[{address:'first@example.test',label:'First'},identity],primary_identity:p});
 assert.throws(()=>call(destination,source,null),e=>e.code==='EMAIL_SIGNATURE_DEFAULT_DENIED');
 assert.throws(()=>call({...destination,content:{...draftValue(),from_identity:{address:'first@example.test'}}}),e=>e.code==='EMAIL_SIGNATURE_DEFAULT_DENIED');
 assert.throws(()=>call(destination,{...source,value:{...source.value,placement:'reply'}}));
 const reply={...destination,content:{...draftValue(),mode:'reply',reply_record_id:'mail_'+'a'.repeat(64)}};assert.ok(call(reply,{...source,value:{...source.value,placement:'reply'}}).value.body.endsWith('Enabled signature'));
 const forward={...destination,content:{...draftValue(),mode:'forward',reply_record_id:'mail_'+'a'.repeat(64)}};assert.ok(call(forward,{...source,value:{...source.value,placement:'new'}}).value.body.endsWith('Enabled signature'));assert.throws(()=>call(forward,{...source,value:{...source.value,placement:'reply'}}),e=>e.code==='EMAIL_SIGNATURE_DEFAULT_DENIED');
 assert.throws(()=>call({...destination,revision:2,content_revision:2}));assert.throws(()=>call(destination,{...source,value:{...source.value,automatic:{...automatic,enabled:false}}}));
});

test('source Save revocation and primary change during awaited authority cannot Apply captured default',async t=>{
 const f=await changeFixture(t),source=await enabled(f),draft=await f.create('drafts',draftValue()),plan=(await f.run(prepare(f,draft,source))).prepared_change;
 await f.run(f.request('record_save',{...cas(source),value:{...source.value,automatic:{...automatic,enabled:false}}}));assert.equal((await f.run(apply(f,plan))).outcome,'conflict');assert.equal((await f.run(f.request('record_read',{store_key:'drafts',record_id:draft.record_id}))).record.revision,1);
 const updated=(await f.run(f.request('record_read',{store_key:'signatures',record_id:source.record_id}))).record,reEnabled=(await f.run(f.request('record_save',{...cas(updated),value:{...updated.value,automatic}}))).record;
 const session=(await f.store.withLock({key:'email.runtime.session.'+f.request('connection_metadata',{store_key:'drafts'}).connection.session_id},tx=>tx.read())).value;await f.runtime.custody.withAccount(session.binding,async tx=>{const row=tx.read();await tx.write({health:'connected',secret:{...row.secret,identity:{...row.secret.identity,verified_sender_identities:[...row.secret.identity.verified_sender_identities,'alternate@example.test']}}});});const second=(await f.run(prepare(f,draft,reEnabled))).prepared_change;let checks=0;
 f.authorityHook(async input=>{if(input.schema_version==='deft.app_data_authority.v2'&&++checks===2)await f.runtime.custody.withAccount(session.binding,async tx=>{const row=tx.read();await tx.write({health:'connected',secret:{...row.secret,identity:{...row.secret.identity,primary_address:'alternate@example.test'}}});});});await assert.rejects(f.run(apply(f,second)));f.authorityHook(null);const row=await f.runtime.drafts.read({org_id:f.scope.org_id,owner_user_id:f.scope.owner_user_id,account_id:plan.account_ref},draft.record_id,async()=>{});assert.equal(row.revision,1);assert.equal(f.calls,3);
});
