import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppRuntimeClient} from '@deft/app-kit';
import {createRuntimeChannelRenewal} from './runtime-channel-renewal.mjs';

test('actual public Kit renew transport keeps credential/session and does not reserve or dispatch',async()=>{
 const initial=Date.now(),session_id='752d6bb3-a77d-4c34-93fa-ae62b398bc2e',token='a'.repeat(43),ceiling=new Date(initial+3600000).toISOString();let now=initial;
 const channel={channel_url:'https://fixture.invalid/api/app-runtime/channel',credential:{session_id,session_token:token},registration:{org_id:'fixture',runtime_registration_id:'fixture',runtime_epoch:1},technical_renewal:{expires_at:new Date(initial+900000).toISOString(),renewable_until:ceiling}};
 const calls=[];
 const client=createAppRuntimeClient({channel_url:channel.channel_url,credential:channel.credential,fetch:async(url,options)=>{
  const body=JSON.parse(options.body);calls.push({path:new URL(url).pathname,body,authorization:options.headers.authorization});
  assert.equal(options.headers.authorization,'AppRuntime '+token);
  if(new URL(url).pathname.endsWith('/renew')){
   assert.deepEqual(body,{schema_version:'deft.app_runtime_channel.v1',session_id,expected_expires_at:channel.technical_renewal.expires_at});
   return new Response(JSON.stringify({renewed:{session_id,expires_at:new Date(initial+1720000).toISOString(),renewable_until:ceiling}}),{status:200,headers:{'content-type':'application/json'}});
  }
  assert.equal(new URL(url).pathname.endsWith('/claim'),true);
  return new Response(JSON.stringify({claim:null}),{status:200,headers:{'content-type':'application/json'}});
 }});
 const renewal=createRuntimeChannelRenewal({channel,runtime_client:client,now:()=>now});
 now=initial+820000;assert.equal(await renewal.renew(new AbortController().signal),true);
 now=initial+960000;assert.equal(await renewal.client.claim(),null);
 assert.deepEqual(calls.map(c=>c.path),['/api/app-runtime/channel/renew','/api/app-runtime/channel/claim']);
 assert.equal(channel.credential.session_id,session_id);assert.equal(channel.credential.session_token,token);
 renewal.close();assert.equal(await renewal.client.claim(),null);assert.equal(calls.length,2);
});
