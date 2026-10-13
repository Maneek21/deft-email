import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {startRuntime} from './server.mjs';
import {makeScope,registrationFor,client} from './test-support.mjs';

test('actual Runtime restart reconciles stale enrollment against current Host, expired Host stays dormant and read gates still start',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'email-renewal-restart-')),scope=makeScope(),initial=Date.now(),originalClock=Date.now;
 let now=initial,instance,renewCalls=0,claimCalls=0,providerCalls=0,hostValid=true;
 Date.now=()=>now;
 t.after(async()=>{Date.now=originalClock;if(instance)await instance.close();await rm(directory,{recursive:true,force:true});});
 const credential={session_id:randomUUID(),session_token:randomBytes(32).toString('base64url')},ceiling=new Date(initial+3600000).toISOString(),expires_at=new Date(initial+100).toISOString();
 const channel={channel_url:'https://fixture.invalid/api/app-runtime/channel',credential,registration:{org_id:scope.org_id,runtime_registration_id:scope.runtime_registration_id,runtime_epoch:scope.runtime_epoch},technical_renewal:{expires_at,renewable_until:ceiling}};
 const clientFile=join(directory,'client.json'),channelFile=join(directory,'channel.json');
 await writeFile(clientFile,JSON.stringify(client),{mode:0o600});await writeFile(channelFile,JSON.stringify(channel),{mode:0o600});const original=await readFile(channelFile);
 const config={listen_port:0,store_root:join(directory,'state'),key_id:'renewal-restart',encryption_key_hex:randomBytes(32).toString('hex'),runtime_auth_token:randomBytes(32).toString('base64url'),authority_token:randomBytes(32).toString('base64url'),authority_url:'https://fixture.invalid/api/app-connection-sessions/runtime/authority',data_authority_url:'https://fixture.invalid/api/app-data/runtime/authority',registrations:[registrationFor(scope)],gmail_client_file:clientFile,runtime_channel_files:[channelFile]};
 const options={allow_windows_fixture:process.platform==='win32',fetch:async()=>{providerCalls++;throw Error('Unexpected provider');},channelFetch:async(url,request)=>{
  const body=JSON.parse(request.body);assert.equal(body.session_id,credential.session_id);assert.equal(request.headers.authorization,'AppRuntime '+credential.session_token);
  if(new URL(url).pathname.endsWith('/renew')){renewCalls++;assert.equal(body.expected_expires_at,expires_at);return new Response(JSON.stringify(hostValid?{renewed:{session_id:credential.session_id,expires_at:new Date(initial+900000).toISOString(),renewable_until:ceiling}}:{code:'APP_RUNTIME_ACCESS_DENIED'}),{status:hostValid?200:403,headers:{'content-type':'application/json'}});}
  assert.equal(new URL(url).pathname.endsWith('/claim'),true);claimCalls++;return new Response(JSON.stringify({claim:null}),{status:200,headers:{'content-type':'application/json'}});
 }};
 const settle=async predicate=>{for(let i=0;i<100&&!predicate();i++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(predicate(),'Synthetic lifecycle deadline');};
 instance=await startRuntime(config,options);await settle(()=>renewCalls===1&&claimCalls>=1);await instance.close();instance=null;
 assert.deepEqual(await readFile(channelFile),original);
 now=initial+1000;const priorClaims=claimCalls;instance=await startRuntime(config,options);await settle(()=>renewCalls===2&&claimCalls>priorClaims);await instance.close();instance=null;
 hostValid=false;const priorDeniedClaims=claimCalls;instance=await startRuntime(config,options);await settle(()=>renewCalls===3);await new Promise(resolve=>setTimeout(resolve,30));assert.equal(claimCalls,priorDeniedClaims);
 const gate=await fetch('http://127.0.0.1:'+instance.server.address().port+'/v1/data',{method:'POST',body:'{}',headers:{'content-type':'application/json'}});assert.equal(gate.status,401);await gate.body.cancel();
 assert.equal(providerCalls,0);assert.deepEqual(await readFile(channelFile),original);
 await instance.close();instance=null;
 const otherFile=join(directory,'other-channel.json'),legacyFile=join(directory,'legacy-channel.json');
 await writeFile(otherFile,original,{mode:0o600});const {technical_renewal,...legacy}=channel;await writeFile(legacyFile,JSON.stringify(legacy),{mode:0o600});
 const beforeDuplicate=renewCalls;
 for(const paths of [[channelFile,otherFile],[legacyFile,channelFile],[channelFile,legacyFile]])await assert.rejects(startRuntime({...config,runtime_channel_files:paths},options),error=>error.code==='EMAIL_RUNTIME_RENEWAL_CONFIG_INVALID');
 assert.equal(renewCalls,beforeDuplicate);assert.equal(providerCalls,0);
});
