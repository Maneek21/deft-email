import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {startRuntime} from './server.mjs';
import {makeScope,registrationFor,client} from './test-support.mjs';
import {createLifecycleFetch} from './lifecycle-fetch.mjs';

test('channel lifetime transport preserves a successful response and rejects work after shutdown',async()=>{
 const lifetime=new AbortController();let calls=0;
 const fetch=createLifecycleFetch(lifetime.signal,async()=>{calls++;return new Response('{"claim":null}',{status:200,headers:{'content-type':'application/json','x-fixture':'kept'}});});
 const response=await fetch('https://fixture.invalid/claim');
 assert.equal(response.status,200);assert.equal(response.headers.get('x-fixture'),'kept');assert.deepEqual(await response.json(),{claim:null});
 lifetime.abort();await assert.rejects(fetch('https://fixture.invalid/claim'),{name:'AbortError'});assert.equal(calls,1);
});

test('shutdown cancels a stalled actual Kit claim response and releases the writer for restart',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'email-shutdown-')),scope=makeScope();
 const clientFile=join(directory,'client.json'),channelFile=join(directory,'channel.json');
 await writeFile(clientFile,JSON.stringify(client),{mode:0o600});
 await writeFile(channelFile,JSON.stringify({channel_url:'https://fixture.invalid/api/app-runtime/channel',credential:{session_id:randomUUID(),session_token:randomBytes(32).toString('base64url')},registration:{org_id:scope.org_id,runtime_registration_id:scope.runtime_registration_id,runtime_epoch:scope.runtime_epoch}}),{mode:0o600});
 const config={listen_port:0,store_root:join(directory,'state'),key_id:'shutdown-fixture',encryption_key_hex:randomBytes(32).toString('hex'),runtime_auth_token:randomBytes(32).toString('base64url'),authority_token:randomBytes(32).toString('base64url'),authority_url:'https://fixture.invalid/authority',data_authority_url:'https://fixture.invalid/data-authority',registrations:[registrationFor(scope)],gmail_client_file:clientFile,runtime_channel_files:[channelFile]};
 let stream,claimedResolve,cancelled=false,instance,closing;
 const claimed=new Promise(resolve=>claimedResolve=resolve);
 try{
  instance=await startRuntime(config,{allow_windows_fixture:process.platform==='win32',channelFetch:async url=>{
   assert.equal(new URL(url).pathname.endsWith('/claim'),true);claimedResolve();
   return new Response(new ReadableStream({start(controller){stream=controller;},cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}});
  }});
  await claimed;closing=instance.close();
  const settled=await Promise.race([closing.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),700))]);
  // Release the pre-fix fixture so the failed assertion does not strand a process.
  if(!cancelled){stream.enqueue(new TextEncoder().encode('{"claim":null}'));stream.close();}
  await closing;instance=null;
  assert.equal(settled,true,'Shutdown must cancel the pending channel body, not wait for its remote peer');
  assert.equal(cancelled,true);
  instance=await startRuntime(config,{allow_windows_fixture:process.platform==='win32',start_send_workers:false});
  await instance.close();instance=null;
 }finally{if(instance)await instance.close();await rm(directory,{recursive:true,force:true});}
});
