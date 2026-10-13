import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,profile} from './connection-form-test-support.mjs';
import {createDraftStore} from './draft-store.mjs';
import {createPreparedActions} from './prepared-actions.mjs';
import {createSmtpCompoundSend} from './smtp-compound.mjs';
import {createSmtpSendRunner} from './smtp-send-runner.mjs';
import {createImapReadPorts} from './imap-runtime-ports.mjs';
import {createDurableStore} from './durable-store.mjs';
import {createConnectionFormRuntime} from './connection-form-runtime.mjs';
import {digest} from './contract.mjs';
async function setup(t,{unknown=false,authorizeCostMs=0,revokeBeforeData=false}={}){
 let authorizationCount=0,elapsed=0;const now=()=>Date.now()+elapsed;
 const f=await fixture(),binding=randomUUID();let store=f.store,forms=f.forms;
 f.request.action_consents=[{action_binding_id:binding,action_key:'send_message',authority_epoch:1,consent_id:binding,consent_digest:'sha256:'+'1'.repeat(64),expires_at:f.scope.consent_expires_at}];
 const value=profile();value.smtp={...value.imap,host:'smtp.example.test',port:465};const {connected}=await f.connect(value),connection={session_id:f.request.session_id,session_revision:5,runtime_session_ref:connected.runtime_session_ref,account_ref:connected.account.account_ref},scope={org_id:f.scope.org_id,owner_user_id:f.scope.owner_user_id,account_id:connection.account_ref};
 let sends=0,allowed=true;const check=async()=>{if(!allowed)throw Error('synthetic revoked');};
 const connector={smtp:async(_profile,ctx,work)=>{await ctx.check();if(revokeBeforeData)allowed=false;return work({sendMail:async packet=>{sends++;if(unknown)throw Error('synthetic uncertain DATA');return {accepted:packet.envelope.to,rejected:[],pending:[]};}});}};
 const drafts=createDraftStore({store}),draft={mode:'compose',to:'recipient@example.test',cc:'',bcc:'bcc@example.test',subject:'Reviewed SMTP',body:'Exact rich plain',body_html:'<p>Exact rich plain</p>',reply_record_id:'',attachments:[]},record=await drafts.create(scope,randomUUID(),draft,{request_id:randomUUID(),user_id:f.scope.owner_user_id,check});
 const request={request_id:randomUUID(),scope:f.scope,connection,authority:{consent_id:randomUUID(),consent_digest:'sha256:'+'d'.repeat(64),data_policy_digest:'sha256:'+'e'.repeat(64)},expires_at:new Date(Date.now()+29000).toISOString()};
 const nativeContext={org_id:f.scope.org_id,owner_user_id:f.scope.owner_user_id,installation_id:f.scope.installation_id,resource_binding_id:f.scope.resource_binding_id,account_id:scope.account_id,authority_version:'fixture',expires_at:Date.now()+29000,recheck:check,owner_capabilities:['read']};
 const compound=createSmtpCompoundSend({forms,store,connector}),prepared=await createPreparedActions({store}).prepare_action({request,scope,input:{store_key:'drafts',record_id:record.draft_id,expected_revision:record.revision,expected_content_digest:'sha256:'+record.content_digest,action_key:'send_message'},drafts,mailbox:{},bridge:createImapReadPorts({forms,connector,session_id:connection.session_id,scope:f.scope,check}).bridge,nativeContext,check,prepareCopy:args=>compound.prepare({...args,connection,scope:f.scope,mode:'server_managed',check,expires_at:Date.now()+29000})});
 assert.equal(sends,0);assert.equal(prepared.copy_effect.content_digest,prepared.input.mime_digest);assert.equal(prepared.input.sent_copy_plan_digest,prepared.copy_effect.plan_digest);
 const input={...prepared.input,record_action_version:'deft.app_prepared_record_action.v1',record_store_key:'drafts',connection_session_id:connection.session_id,connection_revision:connection.session_revision,data_consent_id:request.authority.consent_id,data_consent_digest:request.authority.consent_digest,prepared_digest:prepared.snapshot_digest},registration={org_id:f.scope.org_id,runtime_registration_id:randomUUID(),runtime_epoch:1},lease_expires_at=new Date(Date.now()+28000).toISOString(),claim={run_id:randomUUID(),attempt_id:randomUUID(),operation_name:'send_message',lease_expires_at},started={run_id:claim.run_id,attempt_id:claim.attempt_id,input,lease_expires_at};
 const runtime_client={claim:async()=>claim,start:async()=>started,result:async()=>{},authorize:async()=>{authorizationCount++;elapsed+=authorizeCostMs;await check();return {schema_version:'deft.app_runtime_authority.v1',audience:'app_runtime',run_id:claim.run_id,attempt_id:claim.attempt_id,operation_name:'send_message',input,input_digest:'sha256:'+digest(input),lease_expires_at,org_id:f.scope.org_id,owner_id:f.scope.owner_user_id,app_installation_id:f.scope.installation_id,app_version_id:f.scope.app_version_id,grant_snapshot_id:f.scope.grant_snapshot_id,lifecycle_epoch:f.scope.lifecycle_epoch,grant_epoch:f.scope.grant_epoch,runtime_registration_id:registration.runtime_registration_id,runtime_binding_id:binding,runtime_epoch:1};}};
 const runner=()=>createSmtpSendRunner({runtime_client,registration,forms,connector,store,now});
 t.after(async()=>{await store.close();});
 return {f,prepared,input,started,execute:()=>runner().executeClaim(claim,started),get sends(){return sends;},get authorizationCount(){return authorizationCount;},deny(){allowed=false;},async restart(){await store.close();store=await createDurableStore({root:f.root,encryption_key:f.encryption_key,key_id:'fixture',allow_windows_fixture:process.platform==='win32'});forms=createConnectionFormRuntime({...f.config,store});}};
}
test('immutable SMTP copy plan is prepared without effects, released Run sends once, real store close/reopen preserves accepted receipt',async t=>{const f=await setup(t);const result=await f.execute();assert.equal(result.status,'returned');assert.equal(result.output.sent_copy_outcome,'server_managed');assert.equal(f.sends,1);await f.restart();assert.deepEqual(await f.execute(),result);assert.equal(f.sends,1);});
test('unknown DATA survives actual store restart without replay; changed copy pins and revoked action fail before transmission',async t=>{const unknown=await setup(t,{unknown:true});assert.deepEqual(await unknown.execute(),{status:'indeterminate'});await unknown.restart();assert.deepEqual(await unknown.execute(),{status:'indeterminate'});assert.equal(unknown.sends,1);const tamper=await setup(t);tamper.started.input={...tamper.input,sent_copy_plan_digest:'sha256:'+'0'.repeat(64)};await assert.rejects(tamper.execute());assert.equal(tamper.sends,0);const revoked=await setup(t);revoked.deny();await assert.rejects(revoked.execute());assert.equal(revoked.sends,0);});

test('one-second authority latency fits the released lease without suppressing boundary checks',async t=>{
 const f=await setup(t,{authorizeCostMs:1000});const result=await f.execute();
 assert.equal(result.status,'returned');assert.equal(result.provider_succeeded,true);assert.equal(f.sends,1);
 assert.ok(f.authorizationCount>=5,'separate admission, reservation, transport and disclosure checks remain');
 assert.ok(f.authorizationCount<=24,`must fit 28-second lease, got ${f.authorizationCount} authority round trips`);
});
test('revocation after connection admission still prevents SMTP DATA',async t=>{
 const f=await setup(t,{revokeBeforeData:true});const result=await f.execute();assert.equal(result.status,'indeterminate');assert.equal(f.sends,0);
 await f.restart();await assert.rejects(f.execute(),/synthetic revoked/);assert.equal(f.sends,0);
});
