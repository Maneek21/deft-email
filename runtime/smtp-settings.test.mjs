import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,profile} from './connection-form-test-support.mjs';
import {createDataRuntime} from './data-runtime.mjs';
import {createSettingsStore} from './settings-store.mjs';
import {registrationFor} from './test-support.mjs';
import {savedSmtpSentCopyMode} from './smtp-settings.mjs';

test('owner Sent-copy preference crosses public data prepare, survives restart and never changes an existing reviewed snapshot',{timeout:45000},async t=>{
 const f=await fixture();t.after(()=>f.close());
 const binding=randomUUID();f.request.action_consents=[{action_binding_id:binding,action_key:'send_message',authority_epoch:1,consent_id:binding,consent_digest:'sha256:'+'1'.repeat(64),expires_at:f.scope.consent_expires_at}];
 const p=profile();p.smtp={...p.imap,host:'smtp.example.test',port:465};const {connected}=await f.connect(p);
 let sent=true,allowed=true,listCalls=0,effects=0;
 const connector={imap:async(_p,context,work)=>{await context.check();const client={authenticated:true,secureConnection:true,capabilities:new Map(),mailbox:null,
  async list(){listCalls++;return sent?[{path:'Sent',flags:new Set(['\\Sent']),specialUse:'\\Sent'}]:[];},
  async getMailboxLock(path,options){assert.equal(options.readOnly,true);this.mailbox={path,readOnly:true,uidValidity:'7',uidNext:1};return {release(){}};},
  async append(){effects++;throw Error('No effect expected');},close(){}};return work(client);},smtp:async()=>{effects++;throw Error('No SMTP expected');}};
 const dependencies={registrations:[{...registrationFor(f.scope),connection_protocol:'credential_form.v1'}],provider:'imap_smtp',forms:f.forms,imapConnector:connector,store:f.store,encryption_key:f.encryption_key,key_id:'fixture',assertCurrent:async value=>{if(!allowed)throw Error('revoked');return {...value,allowed:true};}};
 let runtime=createDataRuntime(dependencies);
 const request=(operation,input)=>({schema_version:'deft.app_data_runtime.v1',request_id:randomUUID(),scope:f.scope,connection:{session_id:f.request.session_id,session_revision:5,runtime_session_ref:connected.runtime_session_ref,account_ref:connected.account.account_ref},authority:{consent_id:randomUUID(),consent_digest:'sha256:'+'d'.repeat(64),data_policy_digest:'sha256:'+'e'.repeat(64)},operation,expires_at:new Date(Date.now()+29000).toISOString(),input});
 const run=(op,input)=>runtime.request(request(op,input)),store_key='smtp_preferences',record_id=randomUUID();
 const created=(await run('record_create',{store_key,record_id,value:{sent_copy_mode:'server_managed'}})).record;
 assert.equal(listCalls,0);const view=(await run('record_read',{store_key,record_id})).record;assert.equal(view.summary.append_available,true);assert.equal(view.summary.smtp_supported,true);
 await assert.rejects(run('record_create',{store_key,record_id:randomUUID(),value:{sent_copy_mode:'server_managed'}}));
 await assert.rejects(run('record_archive',{store_key,record_id,expected_revision:created.revision,expected_content_digest:created.content_digest}));
 const save=request('record_save',{store_key,record_id,expected_revision:created.revision,expected_content_digest:created.content_digest,value:{sent_copy_mode:'append_exact'}});
 const saved=(await runtime.request(save)).record;assert.equal(saved.revision,2);
 runtime=createDataRuntime(dependencies);assert.deepEqual((await runtime.request(save)).record,saved);
 const status=await run('request_status',{store_key,request_id:save.request_id});assert.equal(status.request_status.state,'completed');assert.equal(status.request_status.revision,2);
 const draft_id=randomUUID(),value={mode:'compose',to:'recipient@example.test',cc:'',bcc:'',subject:'UNSENT preference fixture',body:'Exact synthetic bytes',body_html:'',reply_record_id:'',attachments:[]};
 const draft=(await run('record_create',{store_key:'drafts',record_id:draft_id,value})).record;
 const prep=await run('prepare_action',{store_key:'drafts',record_id:draft_id,expected_revision:draft.revision,expected_content_digest:draft.content_digest,action_key:'send_message'});
 assert.equal(prep.prepared.supplemental_effect.details.mode,'append_exact');assert.deepEqual({mailbox:prep.prepared.supplemental_effect.details.mailbox,uidvalidity:prep.prepared.supplemental_effect.details.uidvalidity},{mailbox:'Sent',uidvalidity:'7'});
 const reverted=(await run('record_save',{store_key,record_id,expected_revision:saved.revision,expected_content_digest:saved.content_digest,value:{sent_copy_mode:'server_managed'}})).record;
 assert.equal(prep.prepared.supplemental_effect.details.mode,'append_exact');
 const scope={org_id:f.scope.org_id,owner_user_id:f.scope.owner_user_id,account_id:connected.account.account_ref},settings=createSettingsStore({store:f.store});
 assert.equal(await savedSmtpSentCopyMode({settings,scope,check:async()=>{},fallback:'append_exact'}),'server_managed');
 assert.equal(await savedSmtpSentCopyMode({settings,scope:{...scope,account_id:randomUUID()},check:async()=>{}}),'server_managed');
 sent=false;assert.equal((await run('record_read',{store_key,record_id})).record.summary.append_available,false);
 await assert.rejects(run('record_save',{store_key,record_id,expected_revision:reverted.revision,expected_content_digest:reverted.content_digest,value:{sent_copy_mode:'append_exact'}}));
 allowed=false;await assert.rejects(run('record_read',{store_key,record_id}));assert.equal(effects,0);
});
