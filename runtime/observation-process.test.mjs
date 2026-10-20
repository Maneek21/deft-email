import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fork} from 'node:child_process';
import {mkdtemp,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomBytes} from 'node:crypto';
import {makeScope,registrationFor,client} from './test-support.mjs';
import {startRuntime} from './server.mjs';
import {createResourceObservationPoller} from './observation-runner.mjs';
import {runPollingWorker} from './polling-worker.mjs';

test('eight configured observation channels share one initial public claim instead of flooding their Host peer',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'email-observation-budget-')),scope=makeScope(),clientFile=join(parent,'client.json'),paths=[];
 await writeFile(clientFile,JSON.stringify(client),{mode:0o600});
 for(let index=0;index<8;index++){
  const path=join(parent,'channel-'+index+'.json');paths.push(path);
  await writeFile(path,JSON.stringify({channel_url:'https://host.example/api/app-resource-sync-channel/v3',observation_authority_url:'https://host.example/api/app-resource-observations/runtime',credential:{session_id:randomUUID(),session_token:randomBytes(32).toString('base64url')},registration:registrationFor(scope)}),{mode:0o600});
 }
 let instance,claims=0,providerCalls=0,claimed;const first=new Promise(done=>{claimed=done;});
 t.after(async()=>{await instance?.close();await rm(parent,{recursive:true,force:true});});
 instance=await startRuntime({listen_port:0,store_root:join(parent,'state'),key_id:'observation-budget',encryption_key_hex:randomBytes(32).toString('hex'),runtime_auth_token:randomBytes(32).toString('base64url'),authority_token:randomBytes(32).toString('base64url'),authority_url:'https://host.example/api/app-connection-sessions/runtime/authority',registrations:[registrationFor(scope)],gmail_client_file:clientFile,resource_sync_channel_files:paths},{allow_windows_fixture:process.platform==='win32',start_send_workers:false,fetch(){providerCalls++;throw Error('Unexpected provider call');},async channelFetch(url,options){assert.equal(url.pathname,'/api/app-resource-sync-channel/v3/claim');assert.equal(JSON.parse(options.body).max_claims,1);claims++;claimed();return Response.json({schema_version:'deft.app_runtime_channel.v3',audience:'app_resource_sync',claim:null});}});
 await first;await new Promise(setImmediate);
 assert.equal(claims,1,'retained channels must share the initial claim admission');assert.equal(providerCalls,0);
});

test('shared observation polling reaches each exact channel, awaits active work and never retries its result',async()=>{
 const controller=new AbortController(),visited=[],waits=[],signals=[];let release,entered;
 const active=new Promise(done=>{release=done;}),started=new Promise(done=>{entered=done;});
 const runners=Array.from({length:8},(_,index)=>({async runOnce(signal){visited.push(index);signals.push(signal);if(index===3){entered();await active;throw Error('Uncertain original result');}return null;}}));
 const polling=runPollingWorker(createResourceObservationPoller(runners),{signal:controller.signal,waitMs:5000,wait:async ms=>{waits.push(ms);if(waits.length===9)controller.abort();}});
 await started;assert.deepEqual(visited,[0,1,2,3],'no competing claim while an exact Run is active');release();await polling;
 assert.deepEqual(visited,[0,1,2,3,4,5,6,7,0]);assert.ok(signals.every(s=>s===controller.signal));assert.ok(waits.every(ms=>ms===5000));
 assert.equal(visited.filter(index=>index===3).length,1,'an uncertain result is not retried');
});

test('configured independent process polls only the public v3 channel with its explicit private credential',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'email-observation-process-')),scope=makeScope(),token=randomBytes(32).toString('base64url'),authorityToken=randomBytes(32).toString('base64url'),credential={session_id:randomUUID(),session_token:randomBytes(32).toString('base64url')};let providerCalls=0,claims=0,child,ready;
 const claimed=new Promise(done=>{ready=done;}),host=createServer(async(request,response)=>{if(request.url==='/api/app-connection-sessions/runtime/background-access'){assert.equal(request.headers.authorization,'Bearer '+authorityToken);const chunks=[];for await(const chunk of request)chunks.push(chunk);assert.deepEqual(JSON.parse(Buffer.concat(chunks)),{registration:registrationFor(scope)});response.writeHead(403,{'content-type':'application/json'});response.end('{}');return;}assert.equal(request.url,'/api/app-resource-sync-channel/v3/claim');assert.equal(request.headers.authorization,'AppRuntime '+credential.session_token);const chunks=[];for await(const chunk of request)chunks.push(chunk);assert.deepEqual(JSON.parse(Buffer.concat(chunks)),{schema_version:'deft.app_runtime_channel.v3',audience:'app_resource_sync',session_id:credential.session_id,max_claims:1});claims++;response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({schema_version:'deft.app_runtime_channel.v3',audience:'app_resource_sync',claim:null}));ready();});await new Promise(done=>host.listen(0,'127.0.0.1',done));
 const base='http://127.0.0.1:'+host.address().port,clientFile=join(parent,'client.json'),channelFile=join(parent,'observation.json'),configFile=join(parent,'runtime.json');
 await writeFile(clientFile,JSON.stringify(client),{mode:0o600});await writeFile(channelFile,JSON.stringify({channel_url:base+'/api/app-resource-sync-channel/v3',observation_authority_url:base+'/api/app-resource-observations/runtime',credential,registration:registrationFor(scope)}),{mode:0o600});
 await writeFile(configFile,JSON.stringify({listen_port:0,store_root:join(parent,'state'),key_id:'process-observation',encryption_key_hex:randomBytes(32).toString('hex'),runtime_auth_token:token,authority_token:authorityToken,authority_url:base+'/api/app-connection-sessions/runtime/authority',registrations:[registrationFor(scope)],gmail_client_file:clientFile,resource_sync_channel_files:[channelFile]}),{mode:0o600});
 t.after(async()=>{if(child){const exited=new Promise(done=>child.once('exit',done));child.send('shutdown');await exited;}await new Promise(done=>host.close(done));await rm(parent,{recursive:true,force:true});});
 child=fork(fileURLToPath(new URL('./process-fixture.mjs',import.meta.url)),{env:{...process.env,EMAIL_RUNTIME_CONFIG_FILE:configFile},stdio:['ignore','pipe','pipe','ipc']});let stderr='';child.stderr.on('data',chunk=>{stderr+=String(chunk);});const started=await new Promise((done,reject)=>{child.on('message',value=>{if(value.event==='provider_request')providerCalls++;if(value.port!==undefined)done(value);});child.once('exit',code=>reject(Error('synthetic observation child startup '+code)));});assert.ok(started.port>0);await Promise.race([claimed,new Promise((_,reject)=>setTimeout(()=>reject(Error('synthetic channel claim deadline')),5000).unref())]);assert.ok(claims>=1);assert.equal(providerCalls,0);assert.equal(stderr.replace(/\(node:\d+\) ExperimentalWarning: SQLite is an experimental feature and might change at any time\r?\n\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\r?\n/u,''),'');
});

test('unlisted observation registration and foreign authority origin fail startup before channel or provider calls',async t=>{const parent=await mkdtemp(join(tmpdir(),'email-observation-config-')),scope=makeScope(),clientFile=join(parent,'client.json'),channelFile=join(parent,'channel.json');await writeFile(clientFile,JSON.stringify(client),{mode:0o600});t.after(()=>rm(parent,{recursive:true,force:true}));let calls=0;
 const channel={channel_url:'https://host.example/api/app-resource-sync-channel/v3',observation_authority_url:'https://host.example/api/app-resource-observations/runtime',credential:{session_id:randomUUID(),session_token:randomBytes(32).toString('base64url')},registration:registrationFor(scope)},base={listen_port:0,key_id:'test-config',encryption_key_hex:randomBytes(32).toString('hex'),runtime_auth_token:randomBytes(32).toString('base64url'),authority_token:randomBytes(32).toString('base64url'),authority_url:'https://host.example/api/app-connection-sessions/runtime/authority',registrations:[registrationFor(scope)],gmail_client_file:clientFile,resource_sync_channel_files:[channelFile]};
 for(const [index,invalid] of [{...channel,registration:{...channel.registration,runtime_registration_id:randomUUID()}},{...channel,observation_authority_url:'https://foreign.example/api/app-resource-observations/runtime'},{...channel,observation_authority_url:'https://host.example/api/private/authority'}].entries()){await writeFile(channelFile,JSON.stringify(invalid),{mode:0o600});const store_root=join(parent,'state-'+index);await assert.rejects(startRuntime({...base,store_root},{allow_windows_fixture:process.platform==='win32',fetch(){calls++;throw Error('unexpected synthetic provider');},channelFetch(){calls++;throw Error('unexpected synthetic channel');}}));assert.ok(!(await readdir(store_root)).includes('.writer'));}assert.equal(calls,0);
});

test('persistent observation reconciles stale metadata before claiming with Send workers disabled',async t=>{
 const parent=await mkdtemp(join(tmpdir(),'email-observation-renewal-')),scope=makeScope(),session_id=randomUUID(),token=randomBytes(32).toString('base64url'),clientFile=join(parent,'client.json'),channelFile=join(parent,'observation.json');
 const expires_at=new Date(Date.now()-1000).toISOString();await writeFile(clientFile,JSON.stringify(client),{mode:0o600});
 await writeFile(channelFile,JSON.stringify({channel_url:'https://host.example/api/app-resource-sync-channel/v3',observation_authority_url:'https://host.example/api/app-resource-observations/runtime',credential:{session_id,session_token:token},registration:registrationFor(scope),technical_renewal:{expires_at,renewable_until:null,renewal_lifetime:'until_revoked'}}),{mode:0o600});
 let instance,renewals=0,claims=0,providerCalls=0,resolveClaim;const claimed=new Promise(done=>{resolveClaim=done;});
 t.after(async()=>{await instance?.close();await rm(parent,{recursive:true,force:true});});
 instance=await startRuntime({listen_port:0,store_root:join(parent,'state'),key_id:'observation-renewal',encryption_key_hex:randomBytes(32).toString('hex'),runtime_auth_token:randomBytes(32).toString('base64url'),authority_token:randomBytes(32).toString('base64url'),authority_url:'https://host.example/api/app-connection-sessions/runtime/authority',registrations:[registrationFor(scope)],gmail_client_file:clientFile,resource_sync_channel_files:[channelFile]},{allow_windows_fixture:process.platform==='win32',start_send_workers:false,fetch(){providerCalls++;throw Error('Unexpected provider call');},async channelFetch(url,options){
  assert.equal(options.headers.authorization,'AppRuntime '+token);const body=JSON.parse(options.body);assert.equal(body.session_id,session_id);
  if(url.pathname.endsWith('/renew')){renewals++;assert.equal(body.expected_expires_at,expires_at);return Response.json({renewed:{session_id,expires_at:new Date(Date.now()+900000).toISOString(),renewable_until:null,renewal_lifetime:'until_revoked'}});}
  assert.equal(url.pathname,'/api/app-resource-sync-channel/v3/claim');claims++;resolveClaim();return Response.json({schema_version:'deft.app_runtime_channel.v3',audience:'app_resource_sync',claim:null});
 }});
 await Promise.race([claimed,new Promise((_,reject)=>setTimeout(()=>reject(Error('Observation renewal missing')),10000).unref())]);
 await new Promise(setImmediate);assert.equal(renewals,1);assert.ok(claims>0);assert.equal(providerCalls,0);await instance.close();instance=null;const total=renewals+claims;await new Promise(setImmediate);assert.equal(renewals+claims,total);
});
