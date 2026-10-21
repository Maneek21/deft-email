import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {startRuntime} from './server.mjs';
import {makeScope,registrationFor,client,beginFor,twoAccountProviderFixture} from './test-support.mjs';
import {reviewDigest,REATTACH_V2_VERSION} from './reattach-contract.mjs';

test('actual server enrolls a receipted upgrade, installs channels, and reacquires after a twenty-minute restart using unchanged operator config',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'email-connect-once-')),source=makeScope(),clock=Date.now;
 let instance,now=clock(),serviceCalls=0,claims=0;
 Date.now=()=>now;
 const authority=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;res.setHeader('content-type','application/json');res.end(JSON.stringify({...JSON.parse(text),allowed:true}));});
 await new Promise(done=>authority.listen(0,'127.0.0.1',done));
 const origin='http://127.0.0.1:'+authority.address().port;
 t.after(async()=>{Date.now=clock;await instance?.close();await new Promise(done=>authority.close(done));await rm(dir,{recursive:true,force:true});});
 await writeFile(join(dir,'client.json'),JSON.stringify(client),{mode:0o600});
 const config={listen_port:0,store_root:join(dir,'state'),key_id:'connect-once',encryption_key_hex:randomBytes(32).toString('hex'),
  runtime_auth_token:randomBytes(32).toString('base64url'),authority_token:randomBytes(32).toString('base64url'),
  authority_url:origin+'/api/app-connection-sessions/runtime/authority',authority_v2_url:origin+'/api/app-connection-sessions/runtime/authority-v2',
  reattach_authority_url:origin+'/api/app-connection-sessions/runtime/reattach-authority',data_authority_url:origin+'/api/app-data/runtime/authority',
  registrations:[{...registrationFor(source),connection_protocol:'v2'}],gmail_client_file:join(dir,'client.json')};
 const orphan={session_id:randomUUID(),session_token:randomBytes(32).toString('base64url')};
 config.runtime_channel_files=[join(dir,'legacy-channel.json')];
 await writeFile(config.runtime_channel_files[0],JSON.stringify({channel_url:origin+'/api/app-runtime/channel',credential:orphan,registration:{org_id:source.org_id,runtime_registration_id:randomUUID(),runtime_epoch:1},technical_renewal:{expires_at:new Date(now-60000).toISOString(),renewable_until:new Date(now+3600000).toISOString()}}),{mode:0o600});
 const original=JSON.stringify(config),provider=twoAccountProviderFixture(),credentials=new Map(),actionRegistration=randomUUID();
 const post=async body=>{const response=await fetch('http://127.0.0.1:'+instance.server.address().port+'/v1/connections',{
  method:'POST',headers:{authorization:'Bearer '+config.runtime_auth_token,'content-type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};
 const target={...source,app_version_id:randomUUID(),grant_snapshot_id:randomUUID(),resource_binding_id:randomUUID(),runtime_registration_id:randomUUID(),lifecycle_epoch:source.lifecycle_epoch+1,grant_epoch:source.grant_epoch+1};
 const options={allow_windows_fixture:process.platform==='win32',allow_loopback_fixture:true,start_background_reconciler:false,fetch:provider,
  channelFetch:async(url,request)=>{const body=JSON.parse(request.body),path=new URL(url).pathname;
   if(path.endsWith('/background-access')){
    serviceCalls++;assert.deepEqual(body.registration,registrationFor(target),'reacquisition nominates the receipted current registration');
    const channels=['action','observation'].map(kind=>{const credential={session_id:randomUUID(),session_token:randomBytes(32).toString('base64url')};credentials.set(credential.session_id,{...credential,expires_at:now+900000});
     return {kind,channel:{channel_url:origin+(kind==='action'?'/api/app-runtime/channel':'/api/app-resource-sync-channel/v3'),
      ...(kind==='observation'?{observation_authority_url:origin+'/api/app-resource-observations/runtime'}:{}),credential,
      registration:kind==='action'?{org_id:target.org_id,runtime_registration_id:actionRegistration,runtime_epoch:1}:registrationFor(target),
      technical_renewal:{expires_at:new Date(now+900000).toISOString(),renewable_until:null,renewal_lifetime:'until_revoked'}}};});
    const result=await post({schema_version:'deft.app_runtime_channel_install.v1',scope:target,channels});return Response.json({installed:result.installed,skipped:[]});
   }
   if(body.session_id===orphan.session_id)return Response.json({},{status:403});
   assert.ok(credentials.has(body.session_id));
   if(credentials.get(body.session_id).expires_at<=now)return Response.json({},{status:403});
   if(path.endsWith('/renew'))return Response.json({renewed:{session_id:body.session_id,expires_at:new Date(now+900000).toISOString(),renewable_until:null,renewal_lifetime:'until_revoked'}});
   claims++;return Response.json({claim:null});
  }};
 instance=await startRuntime(config,options);
 const begin={...beginFor(source),schema_version:'deft.app_connection_runtime.v2',action_consents:[]},begun=await post(begin);
 const callback={...begin,operation:'callback',runtime_session_ref:begun.runtime_session_ref,callback:{outcome:'authorized',code:'fixture-first-account'}};delete callback.callback_state;
 const account=(await post(callback)).account;
 const request={schema_version:REATTACH_V2_VERSION,session_id:randomUUID(),scope:target,
  source:{session_id:begin.session_id,session_revision:5,scope:source,runtime_session_ref:begun.runtime_session_ref,account_ref:account.account_ref},
  transport_digest:'sha256:'+'1'.repeat(64),review_expires_at:new Date(now+60000).toISOString(),expires_at:new Date(now+29000).toISOString(),operation:'prepare',action_consents:[]};
 const {schema_version,session_id,state,...eligibility}=await post(request);assert.equal(state,'eligible');
 assert.equal((await post({...request,operation:'activate',review:{...eligibility,digest:reviewDigest(request,eligibility)}})).state,'connected');
 await instance.background_reconciler.runOnce(new AbortController().signal);
 assert.equal(serviceCalls,1);assert.equal(instance.observation_runners.length,1);
 await instance.background_reconciler.runOnce(new AbortController().signal);assert.equal(serviceCalls,1,'an unrelated ended legacy action must not force continuous reinstallation');
 await instance.close();instance=null;now+=20*60000;
 instance=await startRuntime(config,options);
 for(let i=0;i<100&&serviceCalls<2;i++){await instance.background_reconciler.runOnce(new AbortController().signal);await new Promise(done=>setTimeout(done,10));}
 assert.equal(serviceCalls,2);assert.equal(instance.observation_runners.length,1);
 await instance.background_reconciler.runOnce(new AbortController().signal);assert.equal(serviceCalls,2,'healthy current channels do not reinstall in a loop');
 for(let i=0;i<100&&!claims;i++)await new Promise(done=>setTimeout(done,10));assert.ok(claims>0);
 assert.equal(JSON.stringify(config),original);assert.deepEqual(provider.effectCounts,{modify:0,send:0});
});

test('actual server completes a three-purpose retained handshake with a healthy six-second callback and an aggregate beyond the default socket timeout',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'email-connect-once-')),source=makeScope(),clock=Date.now;
 let instance,now=clock(),serviceCalls=0,claims=0,retainedChecks=0;
 const actions=scope=>['mirror_drafts','organize_messages','send_message'].map(action_key=>{const id=randomUUID();return {action_key,action_binding_id:id,consent_id:id,authority_epoch:scope.runtime_epoch,consent_digest:'sha256:'+'d'.repeat(64),expires_at:scope.consent_expires_at};});
 Date.now=()=>now;
 const authority=createServer(async(req,res)=>{let text='';for await(const chunk of req)text+=chunk;res.setHeader('content-type','application/json');const body=JSON.parse(text);if(body.schema_version===REATTACH_V2_VERSION){retainedChecks++;await new Promise(done=>setTimeout(done,retainedChecks===7?6000:3300));}res.end(JSON.stringify({...body,allowed:true}));});
 await new Promise(done=>authority.listen(0,'127.0.0.1',done));
 const origin='http://127.0.0.1:'+authority.address().port;
 t.after(async()=>{Date.now=clock;await instance?.close();await new Promise(done=>authority.close(done));await rm(dir,{recursive:true,force:true});});
 await writeFile(join(dir,'client.json'),JSON.stringify(client),{mode:0o600});
 const config={listen_port:0,store_root:join(dir,'state'),key_id:'connect-once',encryption_key_hex:randomBytes(32).toString('hex'),
  runtime_auth_token:randomBytes(32).toString('base64url'),authority_token:randomBytes(32).toString('base64url'),
  authority_url:origin+'/api/app-connection-sessions/runtime/authority',authority_v2_url:origin+'/api/app-connection-sessions/runtime/authority-v2',
  reattach_authority_url:origin+'/api/app-connection-sessions/runtime/reattach-authority',data_authority_url:origin+'/api/app-data/runtime/authority',
  registrations:[{...registrationFor(source),connection_protocol:'v2'}],gmail_client_file:join(dir,'client.json')};
 const orphan={session_id:randomUUID(),session_token:randomBytes(32).toString('base64url')};
 config.runtime_channel_files=[join(dir,'legacy-channel.json')];
 await writeFile(config.runtime_channel_files[0],JSON.stringify({channel_url:origin+'/api/app-runtime/channel',credential:orphan,registration:{org_id:source.org_id,runtime_registration_id:randomUUID(),runtime_epoch:1},technical_renewal:{expires_at:new Date(now-60000).toISOString(),renewable_until:new Date(now+3600000).toISOString()}}),{mode:0o600});
 const original=JSON.stringify(config),provider=twoAccountProviderFixture(),credentials=new Map(),actionRegistration=randomUUID();
 const post=async body=>{const response=await fetch('http://127.0.0.1:'+instance.server.address().port+'/v1/connections',{
  method:'POST',headers:{authorization:'Bearer '+config.runtime_auth_token,'content-type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;};
 const target={...source,app_version_id:randomUUID(),grant_snapshot_id:randomUUID(),resource_binding_id:randomUUID(),runtime_registration_id:randomUUID(),lifecycle_epoch:source.lifecycle_epoch+1,grant_epoch:source.grant_epoch+1};
 const options={allow_windows_fixture:process.platform==='win32',allow_loopback_fixture:true,start_background_reconciler:false,fetch:provider,
  channelFetch:async(url,request)=>{const body=JSON.parse(request.body),path=new URL(url).pathname;
   if(path.endsWith('/background-access')){
    serviceCalls++;assert.deepEqual(body.registration,registrationFor(target),'reacquisition nominates the receipted current registration');
    const channels=['action','observation'].map(kind=>{const credential={session_id:randomUUID(),session_token:randomBytes(32).toString('base64url')};credentials.set(credential.session_id,{...credential,expires_at:now+900000});
     return {kind,channel:{channel_url:origin+(kind==='action'?'/api/app-runtime/channel':'/api/app-resource-sync-channel/v3'),
      ...(kind==='observation'?{observation_authority_url:origin+'/api/app-resource-observations/runtime'}:{}),credential,
      registration:kind==='action'?{org_id:target.org_id,runtime_registration_id:actionRegistration,runtime_epoch:1}:registrationFor(target),
      technical_renewal:{expires_at:new Date(now+900000).toISOString(),renewable_until:null,renewal_lifetime:'until_revoked'}}};});
    const result=await post({schema_version:'deft.app_runtime_channel_install.v1',scope:target,channels});return Response.json({installed:result.installed,skipped:[]});
   }
   if(body.session_id===orphan.session_id)return Response.json({},{status:403});
   assert.ok(credentials.has(body.session_id));
   if(credentials.get(body.session_id).expires_at<=now)return Response.json({},{status:403});
   if(path.endsWith('/renew'))return Response.json({renewed:{session_id:body.session_id,expires_at:new Date(now+900000).toISOString(),renewable_until:null,renewal_lifetime:'until_revoked'}});
   claims++;return Response.json({claim:null});
  }};
 instance=await startRuntime(config,options);
 const begin={...beginFor(source),schema_version:'deft.app_connection_runtime.v2',action_consents:actions(source)},begun=await post(begin);
 const callback={...begin,operation:'callback',runtime_session_ref:begun.runtime_session_ref,callback:{outcome:'authorized',code:'fixture-first-account-both'}};delete callback.callback_state;
 const account=(await post(callback)).account;
 const request={schema_version:REATTACH_V2_VERSION,session_id:randomUUID(),scope:target,
  source:{session_id:begin.session_id,session_revision:5,scope:source,runtime_session_ref:begun.runtime_session_ref,account_ref:account.account_ref},
  transport_digest:'sha256:'+'1'.repeat(64),review_expires_at:new Date(now+300000).toISOString(),expires_at:new Date(now+110000).toISOString(),operation:'prepare',action_consents:actions(target)};
 const {schema_version,session_id,state,...eligibility}=await post(request);assert.equal(state,'eligible');
 assert.equal((await post({...request,operation:'activate',review:{...eligibility,digest:reviewDigest(request,eligibility)}})).state,'connected');
 assert.ok(retainedChecks>=11,'multiple current purpose checks traversed real HTTP');
 assert.equal(JSON.stringify(config),original);assert.deepEqual(provider.effectCounts,{modify:0,send:0});
});
