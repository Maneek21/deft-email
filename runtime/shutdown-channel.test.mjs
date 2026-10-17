import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {startRuntime} from './server.mjs';
import {makeScope,registrationFor,client} from './test-support.mjs';
import {createLifecycleFetch} from './lifecycle-fetch.mjs';
import {connect} from 'node:net';

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

test('shutdown drains an authenticated incomplete HTTP body before releasing the writer',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'email-http-shutdown-')),scope=makeScope();
 const clientFile=join(directory,'client.json');await writeFile(clientFile,JSON.stringify(client),{mode:0o600});
 const config={listen_port:0,store_root:join(directory,'state'),key_id:'shutdown-http-fixture',encryption_key_hex:randomBytes(32).toString('hex'),runtime_auth_token:randomBytes(32).toString('base64url'),authority_token:randomBytes(32).toString('base64url'),authority_url:'https://fixture.invalid/authority',registrations:[registrationFor(scope)],gmail_client_file:clientFile};
 let instance,socket;
 try{
  const phases=[];instance=await startRuntime(config,{allow_windows_fixture:process.platform==='win32',onShutdown:entry=>phases.push(entry.phase)});
  const accepted=new Promise(resolve=>instance.server.once('request',resolve));
  socket=connect(instance.server.address().port,'127.0.0.1');socket.on('error',()=>{});
  await new Promise(resolve=>socket.once('connect',resolve));
  socket.write('POST /v1/connections HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer '+config.runtime_auth_token+'\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{');
  await accepted;const closing=instance.close();
  const settled=await Promise.race([closing.then(()=>true),new Promise(resolve=>setTimeout(()=>resolve(false),700))]);
  socket.destroy();await closing;instance=null;
  assert.equal(settled,true,'A connected peer must not hold the writer lease through shutdown');
  assert.deepEqual(phases,['admission_closed','workers_drained','http_drained','writer_released']);
  instance=await startRuntime(config,{allow_windows_fixture:process.platform==='win32'});await instance.close();instance=null;
 }finally{socket?.destroy();if(instance)await instance.close();await rm(directory,{recursive:true,force:true});}
});
