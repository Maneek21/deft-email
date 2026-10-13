import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseNativeSafeComposeHtml} from '@deft/app-kit/experience';
import {createDurableStore} from './durable-store.mjs';
import {createConnectionRuntime} from './connection-runtime.mjs';
import {createDataRuntime} from './data-runtime.mjs';
import {makeScope,registrationFor,client,beginFor,nextFor,authority,providerFixture} from './test-support.mjs';
const sha=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/wAAAABJRU5ErkJggg==','base64');
async function fixture(t,{files=2}={}){
 const parent=await mkdtemp(join(tmpdir(),'prepare-latency-')),key=Buffer.alloc(32,44),key_id='prepare-fixture',scope=makeScope();
 const store=await createDurableStore({root:join(parent,'private'),encryption_key:key,key_id,allow_windows_fixture:process.platform==='win32'});
 t.after(async()=>{await store.close();await rm(parent,{recursive:true,force:true});});
 let checks=0,providerCalls=0,sendCalls=0,denyAt=Infinity;
 const fetch=async(url,options)=>{providerCalls++;if(String(url).includes('/messages/send')){sendCalls++;throw Error('No Send during preview');}
  if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-access',refresh_token:'synthetic-refresh',token_type:'Bearer',expires_in:3600,scope:'openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send'});
  return providerFixture(url,options);};
 const connectionRuntime=createConnectionRuntime({registration:registrationFor(scope),client,store,encryption_key:key,key_id,assertCurrent:authority,fetch});
 const begin=beginFor(scope),binding=randomUUID();begin.action_consent={action_binding_id:binding,action_key:'send_message',authority_epoch:1,consent_id:binding,consent_digest:'sha256:'+'9'.repeat(64),expires_at:scope.consent_expires_at};
 const begun=await connectionRuntime.request(begin),callback=nextFor(begin,begun,'callback');callback.action_consent=begin.action_consent;
 const connected=await connectionRuntime.request(callback),connection={session_id:begin.session_id,session_revision:5,runtime_session_ref:begun.runtime_session_ref,account_ref:connected.account.account_ref};
 const dataAuthority={consent_id:randomUUID(),consent_digest:'sha256:'+'d'.repeat(64),data_policy_digest:'sha256:'+'e'.repeat(64)};
 const request=(operation,input)=>({schema_version:'deft.app_data_runtime.v1',request_id:randomUUID(),scope,connection,authority:dataAuthority,operation,input,expires_at:new Date(Date.now()+29000).toISOString()});
 const runtime=createDataRuntime({client,store,encryption_key:key,key_id,registrations:[registrationFor(scope)],fetch,assertCurrent:async input=>{if(input.operation==='prepare_action'&&++checks>=denyAt)throw Error('synthetic owner revocation');return {...input,allowed:true};}});
 let record=(await runtime.request(request('record_create',{store_key:'drafts',record_id:randomUUID(),value:{mode:'compose',to:'recipient@example.test',cc:'',bcc:'',subject:'Synthetic preview latency',body:'Preview',body_html:'<p>Preview</p>',reply_record_id:'',attachments:[]}}))).record;
 let imageId;
 for(let i=0;i<files;i++){
  const image=i===0,bytes=image?png:Buffer.from('%PDF-1.4\nSynthetic '+i),file_id=randomUUID();if(image)imageId=file_id;
  record=(await runtime.request(request('file_upload',{store_key:'drafts',record_id:record.record_id,expected_revision:record.revision,expected_content_digest:record.content_digest,file_id,filename:image?'inline.png':`synthetic-${i}.pdf`,media_type:image?'image/png':'application/pdf',size_bytes:bytes.length,sha256:sha(bytes)}),undefined,bytes)).record;
 }
 if(imageId){const html=`<p>Preview<img src="cid:deft-${imageId}@deft.invalid" alt="Synthetic image"></p>`,body=parseNativeSafeComposeHtml(html,{inlineAttachments:record.value.attachments}).plainText;record=(await runtime.request(request('record_save',{store_key:'drafts',record_id:record.record_id,expected_revision:record.revision,expected_content_digest:record.content_digest,value:{...record.value,body,body_html:html}}))).record;}
 const prepare=()=>runtime.request(request('prepare_action',{store_key:'drafts',record_id:record.record_id,expected_revision:record.revision,expected_content_digest:record.content_digest,action_key:'send_message',prepare_expires_at:new Date(Date.now()+240000).toISOString()}));
 return {prepare,record,get checks(){return checks;},get providerCalls(){return providerCalls;},get sendCalls(){return sendCalls;},denyAt(n){denyAt=n;}};
}
test('PDF and inline image preview keeps bounded online checks independent of local file count',async t=>{
 const f=await fixture(t),result=await f.prepare();console.log(JSON.stringify({event:'two_file_prepare',online_checks:f.checks,provider_calls:f.providerCalls,send_calls:f.sendCalls}));
 assert.equal(result.outcome,'completed');assert.equal(result.prepared.revision,f.record.revision);assert.equal(f.sendCalls,0);assert.ok(f.checks<=18,`Preview made ${f.checks} online checks`);
});
test('maximum attachment preview remains bounded and has no provider Send',async t=>{
 const f=await fixture(t,{files:32}),result=await f.prepare();console.log(JSON.stringify({event:'32_file_prepare',online_checks:f.checks}));assert.equal(result.outcome,'completed');assert.ok(f.checks<=18);assert.equal(f.sendCalls,0);
});
test('fresh final authority check denies a preview revoked during preparation',async t=>{
 const measured=await fixture(t);await measured.prepare();const f=await fixture(t);f.denyAt(measured.checks);await assert.rejects(f.prepare(),/synthetic owner revocation/);assert.equal(f.sendCalls,0);
});
