import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './consent-continuation-fixture.mjs';
import {lineageKey,validateLineage} from './account-lineage.mjs';
import {purposeFor} from './purpose-set.mjs';
import {createConsentContinuationRuntime} from './connection-consent-continuation-runtime.mjs';
import {registrationFor,client} from './test-support.mjs';
import {createReattachRuntime} from './connection-reattach-runtime.mjs';
import {reviewDigest} from './reattach-contract.mjs';
import {readFile} from 'node:fs/promises';
import {continuationPins,continuationReviewDigest,continuationReceiptDigest} from './consent-continuation-contract.mjs';
const read=(f,id)=>f.store.withLock({key:'email.runtime.session.'+id},tx=>tx.read());
const empty={mode:'compose',to:'target@example.test',cc:'',bcc:'',subject:'Unsent',body:'Exact unsent\n',body_html:'',reply_record_id:'',attachments:[]};
test('expiry-only continuation preserves encrypted custody, original session, account and action identities across restart',async t=>{
 const f=await fixture(t),old=await read(f,f.id),before=await f.data.custody.withAccount(old.value.binding,tx=>tx.read()),calls=f.calls;
 const request=await f.next(),activation=await f.prepare(request),result=await f.activate(activation),session=(await read(f,request.session_id)).value;
 assert.equal(result.state,'connected');assert.equal(result.custody_generation,before.setup_generation);assert.notEqual(result.runtime_session_ref,old.value.runtime_session_ref);
 assert.deepEqual(session.binding,old.value.binding);assert.deepEqual(await read(f,old.value.session_id),old);assert.deepEqual(await f.data.custody.withAccount(session.binding,tx=>tx.read()),before);
 assert.equal(purposeFor(session,'send_message').consent_id,purposeFor(old.value,'send_message').consent_id);assert.deepEqual(session.action_consents,request.action_consents);
 validateLineage((await f.store.withLock({key:lineageKey(session.binding)},tx=>tx.read())).value,session);
 await f.restart();assert.deepEqual(await f.runtime.request({...activation,operation:'status'}),result);assert.equal(f.calls,calls);
 const listed=await f.data.request(f.dataRequest('record_create',{store_key:'drafts',record_id:randomUUID(),value:empty}));assert.equal(listed.outcome,'completed');
});
test('original unknown Send is retained and remains uneditable/unresendable while new consent connects',async t=>{
 const f=await fixture(t),scope={org_id:f.scope.org_id,owner_user_id:f.scope.owner_user_id,account_id:f.account.account_ref},id=randomUUID(),check=async()=>{};
 const draft=await f.data.drafts.create(scope,id,empty,{request_id:randomUUID(),user_id:scope.owner_user_id,check}),run=randomUUID();
 await f.data.drafts.reserveSend(scope,id,1,draft.content_digest,run,check);await f.data.drafts.recordSendOutcome(scope,id,run,'unknown');
 const before=await f.data.drafts.read(scope,id,check),calls=f.calls;await f.activate(await f.prepare(await f.next()));
 assert.deepEqual(await f.data.drafts.read(scope,id,check),before);await assert.rejects(f.data.drafts.reserveSend(scope,id,before.revision,before.content_digest,randomUUID(),check),{code:'EMAIL_SEND_DRAFT_CHANGED'});assert.equal(f.calls,calls);
});
test('fresh independent review works after old consent expiry; old purpose does not become valid',async t=>{
 const f=await fixture(t),source=(await read(f,f.id)).value,request=await f.next(),now=Date.parse(source.scope.consent_expires_at)+1000;
 request.expires_at=new Date(now+20000).toISOString();request.review_expires_at=new Date(now+60000).toISOString();
 const runtime=createConsentContinuationRuntime({registration:registrationFor(request.scope),client,store:f.store,encryption_key:Buffer.alloc(32,59),key_id:'reattach-test',assertCurrent:async r=>({...r,allowed:true}),now:()=>now});
 const eligible=await runtime.request(request),{schema_version,session_id,state,...eligibility}=eligible;
 const {continuationReviewDigest}=await import('./consent-continuation-contract.mjs');const activation={...request,operation:'activate',review:{...eligibility,digest:continuationReviewDigest(request,eligibility)}};
 assert.equal((await runtime.request(activation)).state,'connected');assert.throws(()=>purposeFor(source,'send_message',()=>now),{code:'EMAIL_RUNTIME_ACTION_DENIED'});
});
test('changed scope, action identity, custody, profile, source locator or authority rejects without publication',async t=>{
 const f=await fixture(t),request=await f.next(),calls=f.calls;
 for(const change of [r=>r.scope.resource_binding_id=randomUUID(),r=>r.scope.grant_epoch++,r=>r.scope.app_version_id=randomUUID(),r=>r.scope.profile_digest='sha256:'+'8'.repeat(64),r=>r.action_consents[0].consent_id=randomUUID(),r=>r.action_consents[0].authority_epoch++,r=>r.source.runtime_session_ref='wrong',r=>r.source.action_consents[0].consent_digest='sha256:'+'8'.repeat(64),r=>r.scope.consent_expires_at=r.source.scope.consent_expires_at]){const bad=structuredClone(request);change(bad);await assert.rejects(f.runtime.request(bad));}
 f.deny();await assert.rejects(f.runtime.request(request));assert.equal(await read(f,request.session_id),null);assert.equal(f.calls,calls);
});
test('committed local interruption resumes exact journal on status without custody/provider/effect replay',async t=>{
 for(const phase of ['activation_started','session','lineage','target','connected']){
  const f=await fixture(t),activation=await f.prepare(await f.next()),old=await read(f,f.id),before=await f.data.custody.withAccount(old.value.binding,tx=>tx.read()),calls=f.calls;
  f.failWrite((options,input)=>phase==='session'?options.key==='email.runtime.session.'+activation.session_id:phase==='lineage'?options.key.startsWith('email.runtime.account_lineage.'):phase==='target'?options.key.startsWith('email.runtime.target.')&&input.value.state==='connected':options.key.startsWith('email.runtime.consent_continuation.')&&input.value.state===phase);
  await assert.rejects(f.runtime.request(activation));await f.restart();const result=await f.runtime.request({...activation,operation:'status'});assert.equal(result.state,'connected',phase);
  assert.deepEqual(await f.runtime.request({...activation,operation:'status'}),result);assert.deepEqual(await read(f,old.value.session_id),old);assert.deepEqual(await f.data.custody.withAccount(old.value.binding,tx=>tx.read()),before);assert.equal(f.calls,calls);
 }
});
test('repeated continuations append receipts without advancing credential generation or epoch',async t=>{
 const f=await fixture(t,{readOnly:true}),first=await f.prepare(await f.next());await f.activate(first);const second=await f.prepare(await f.next());await f.activate(second);
 const session=(await read(f,f.id)).value,lineage=(await f.store.withLock({key:lineageKey(session.binding)},tx=>tx.read())).value;
 validateLineage(lineage,session);assert.equal(lineage.receipts.length,2);assert.equal(lineage.epochs.length,1);assert.equal(lineage.current.custody_generation,1);
 await assert.rejects(f.runtime.request({...first,operation:'status'}));
});
test('a subsequent explicit reattachment preserves and validates prior continuation receipts',async t=>{
 const f=await fixture(t);await f.activate(await f.prepare(await f.next()));
 const source=(await read(f,f.id)).value,target={...source.scope,app_version_id:randomUUID(),grant_snapshot_id:randomUUID(),resource_binding_id:randomUUID(),runtime_registration_id:randomUUID(),lifecycle_epoch:source.scope.lifecycle_epoch+1,grant_epoch:source.scope.grant_epoch+1};
 const runtime=createReattachRuntime({registration:registrationFor(target),client,store:f.store,encryption_key:Buffer.alloc(32,59),key_id:'reattach-test',assertCurrent:async r=>({...r,allowed:true})});
 const request={schema_version:'deft.app_connection_reattach_runtime.v2',operation:'prepare',session_id:randomUUID(),scope:target,source:{session_id:source.session_id,session_revision:5,scope:source.scope,runtime_session_ref:source.runtime_session_ref,account_ref:source.account.account_ref},transport_digest:'sha256:'+'1'.repeat(64),action_consents:source.action_consents.map(a=>{const id=randomUUID();return {...a,action_binding_id:id,consent_id:id};}),review_expires_at:new Date(Date.now()+60000).toISOString(),expires_at:new Date(Date.now()+20000).toISOString()};
 const eligible=await runtime.request(request),{schema_version,session_id,state,...eligibility}=eligible,result=await runtime.request({...request,operation:'activate',review:{...eligibility,digest:reviewDigest(request,eligibility)}});
 assert.equal(result.custody_generation,2);const session=(await read(f,request.session_id)).value,lineage=(await f.store.withLock({key:lineageKey(session.binding)},tx=>tx.read())).value;
 assert.equal(lineage.schema_version,'email.runtime.account_lineage.v3');assert.equal(lineage.receipts.length,2);assert.equal(lineage.epochs.length,2);validateLineage(lineage,session);
 for(const change of [r=>r.receipts[0].custody_generation++,r=>r.receipts[0].authority_epoch++,r=>r.receipts[0].current_binding.resource_binding_id=randomUUID(),r=>r.receipts[0].purpose_set.action_consents[0].consent_id=randomUUID()]){const bad=structuredClone(lineage);change(bad);assert.throws(()=>validateLineage(bad,session));}
});
test('fresh authority revocation prevents interrupted publication recovery without changing original custody',async t=>{
 const f=await fixture(t),activation=await f.prepare(await f.next()),source=await read(f,f.id),before=await f.data.custody.withAccount(source.value.binding,tx=>tx.read());
 f.failWrite((options,input)=>options.key.startsWith('email.runtime.consent_continuation.')&&input.value.state==='activation_started');
 await assert.rejects(f.runtime.request(activation));f.deny();await assert.rejects(f.runtime.request({...activation,operation:'status'}));assert.equal(await read(f,activation.session_id),null);assert.deepEqual(await read(f,f.id),source);assert.deepEqual(await f.data.custody.withAccount(source.value.binding,tx=>tx.read()),before);
});
test('Runtime uses the sealed Kit canonical wire vector without parallel digest encoding',async()=>{
 const vector=JSON.parse(await readFile(new URL('./consent-continuation-wire-vector.json',import.meta.url),'utf8'));
 const {schema_version,eligibility,...pins}=vector.review_value;assert.deepEqual(continuationPins(vector.prepare),pins);
 assert.equal(continuationReviewDigest(vector.prepare,vector.eligibility),vector.review_digest);
 assert.equal(continuationReceiptDigest(vector.activate,vector.activate.review,vector.connected.runtime_session_ref),vector.receipt_digest);
 const status={...vector.activate,operation:'status',expires_at:vector.activate.scope.consent_expires_at};assert.equal(continuationReceiptDigest(status,status.review,vector.connected.runtime_session_ref),vector.receipt_digest);
});

test('explicit until-revoked continuation preserves custody and old history, while fresh revocation still denies',async t=>{
 const f=await fixture(t),old=await read(f,f.id),before=await f.data.custody.withAccount(old.value.binding,tx=>tx.read()),calls=f.calls;
 const id=randomUUID(),draft=await f.data.request(f.dataRequest('record_create',{store_key:'drafts',record_id:id,value:empty}));
 const request=await f.next();request.scope={...request.scope,consent_expires_at:null,consent_lifetime:'until_revoked'};
 request.action_consents=request.action_consents.map(action=>({...action,expires_at:null,consent_lifetime:'until_revoked'}));
 const activation=await f.prepare(request),result=await f.activate(activation),session=(await read(f,f.id)).value;
 assert.equal(result.state,'connected');assert.deepEqual(await read(f,old.value.session_id),old);
 assert.deepEqual(await f.data.custody.withAccount(session.binding,tx=>tx.read()),before);
 assert.equal(purposeFor(session,'send_message',()=>Date.parse('2046-10-15T12:00:00Z')).consent_lifetime,'until_revoked');
 assert.throws(()=>purposeFor(old.value,'send_message',()=>Date.parse('2046-10-15T12:00:00Z')));
 await f.restart();assert.deepEqual(await f.runtime.request({...activation,operation:'status'}),result);
 assert.equal((await f.data.request(f.dataRequest('record_read',{store_key:'drafts',record_id:id}))).record.content_digest,draft.record.content_digest);
 f.deny();await assert.rejects(f.runtime.request({...activation,operation:'status'}));assert.equal(f.calls,calls);
});
