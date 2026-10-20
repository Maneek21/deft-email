import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {startRuntime} from './server.mjs';
import {makeScope,registrationFor,client} from './test-support.mjs';

for(const legacy of [false,true])test('Host and Runtime outage beyond fifteen minutes recovers '+(legacy?'legacy fixed':'expired renewable')+' sessions and persists them without a human',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'email-service-recovery-')),scope=makeScope(),initial=Date.now(),clock=Date.now;
 let now=initial+20*60000,instance,hostDown=true,serviceCalls=0,claims=0;
 Date.now=()=>now;
 t.after(async()=>{Date.now=clock;await instance?.close();await rm(dir,{recursive:true,force:true});});
 const registration={org_id:scope.org_id,runtime_registration_id:scope.runtime_registration_id,runtime_epoch:scope.runtime_epoch};
 const stale={session_id:randomUUID(),session_token:randomBytes(32).toString('base64url')},fresh={session_id:randomUUID(),session_token:randomBytes(32).toString('base64url')};
 const channel=credential=>({channel_url:'https://host.test/api/app-runtime/channel',credential,registration,
  ...(legacy&&credential===stale?{}:{technical_renewal:{expires_at:new Date(credential===stale?initial:now+900000).toISOString(),renewable_until:null,renewal_lifetime:'until_revoked'}})});
 await writeFile(join(dir,'client.json'),JSON.stringify(client),{mode:0o600});await writeFile(join(dir,'channel.json'),JSON.stringify(channel(stale)),{mode:0o600});
 const config={listen_port:0,store_root:join(dir,'state'),key_id:'service-test',encryption_key_hex:randomBytes(32).toString('hex'),
  runtime_auth_token:randomBytes(32).toString('base64url'),authority_token:randomBytes(32).toString('base64url'),
  authority_url:'https://host.test/api/app-connection-sessions/runtime/authority',data_authority_url:'https://host.test/api/app-data/runtime/authority',
  registrations:[registrationFor(scope)],gmail_client_file:join(dir,'client.json'),runtime_channel_files:[join(dir,'channel.json')]};
 const options={allow_windows_fixture:process.platform==='win32',start_background_reconciler:false,fetch:async()=>{assert.fail('Provider access was not authorized');},
  channelFetch:async(url,request)=>{const body=JSON.parse(request.body),path=new URL(url).pathname;
   if(path.endsWith('/background-access')){
    serviceCalls++;assert.equal(request.headers.authorization,'Bearer '+config.authority_token);assert.deepEqual(body,{registration:registrationFor(scope)});
    if(hostDown)return Response.json({},{status:503});
    const installed=await fetch('http://127.0.0.1:'+instance.server.address().port+'/v1/connections',{method:'POST',
     headers:{authorization:'Bearer '+config.runtime_auth_token,'content-type':'application/json'},
     body:JSON.stringify({schema_version:'deft.app_runtime_channel_install.v1',scope,channels:[{kind:'action',channel:channel(fresh)}]})});
    assert.equal(installed.status,200);const reply=await installed.json();return Response.json({installed:reply.installed,skipped:[]});
   }
   if(body.session_id===stale.session_id)return Response.json({},{status:403});
   assert.equal(body.session_id,fresh.session_id);assert.equal(request.headers.authorization,'AppRuntime '+fresh.session_token);
   if(path.endsWith('/renew'))return Response.json({renewed:{session_id:fresh.session_id,expires_at:new Date(now+900000).toISOString(),renewable_until:null,renewal_lifetime:'until_revoked'}});
   assert.ok(path.endsWith('/claim'));claims++;return Response.json({claim:null});
  }};
 const settle=async condition=>{for(let i=0;i<100&&!condition();i++)await new Promise(r=>setTimeout(r,10));assert.ok(condition());};
 instance=await startRuntime(config,options);await settle(()=>instance.send_runners.length===1);
 await new Promise(r=>setTimeout(r,20));assert.equal(claims,0);
 const signal=new AbortController().signal;
 for(let i=0;i<15;i++){await instance.background_reconciler.runOnce(signal);now+=300001;}
 assert.equal(claims,0);assert.ok(serviceCalls>10);hostDown=false;
 await instance.background_reconciler.runOnce(signal);await settle(()=>claims>0);
 assert.equal(instance.send_runners.length,1,'Superseded workers leave the active list');
 const before=serviceCalls;await instance.background_reconciler.runOnce(signal);assert.equal(serviceCalls,before);
 await instance.close();instance=null;now+=20*60000;
 instance=await startRuntime(config,options);await settle(()=>claims>1);assert.equal(serviceCalls,before,'Stale persisted metadata uses idempotent Host renewal before fetching again');
});
