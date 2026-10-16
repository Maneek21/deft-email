import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeftResourceSyncClientV3} from '@deft/app-kit';
import {createRuntimeChannelRenewal} from './runtime-channel-renewal.mjs';

const iso=n=>new Date(n).toISOString();
function fixture({timeout_ms,fetch:transport,stale=false,remaining_ms,onWait}={}){
 const initial=Date.now(),session_id='752d6bb3-a77d-4c34-93fa-ae62b398bc2e';
 let now=initial+(remaining_ms===undefined?(stale?960000:820000):900000-remaining_ms),renewals=0,claims=0;
 const calls=[],errors=[],diagnostics=[],channel={channel_url:'https://fixture.invalid/api/app-resource-sync-channel/v3',credential:{session_id,session_token:'a'.repeat(43)},registration:{},technical_renewal:{expires_at:iso(initial+900000),renewable_until:iso(initial+3600000)}};
 const client=createDeftResourceSyncClientV3({channel_url:channel.channel_url,credential:channel.credential,...(timeout_ms===undefined?{}:{timeout_ms}),fetch:async(url,options)=>{
  const op=new URL(url).pathname.split('/').at(-1),body=JSON.parse(options.body);calls.push({op,body});
  if(op==='claim'){claims++;return Response.json({schema_version:'deft.app_runtime_channel.v3',audience:'app_resource_sync',claim:null});}
  assert.equal(op,'renew');renewals++;
  return transport?transport({renewals,body,now,initial,session_id,signal:options.signal}):Response.json({renewed:{session_id,expires_at:iso(initial+1720000),renewable_until:channel.technical_renewal.renewable_until}});
 }});
 const originalRenew=client.renew;
 const runtime_client={...client,renew:async(input,signal)=>{try{return await originalRenew(input,{signal});}catch(error){errors.push({name:error.name,status:error.status,code:error.code});throw error;}}};
 const life=createRuntimeChannelRenewal({channel,runtime_client,now:()=>now,wait:async(ms,_value,{signal})=>{signal.throwIfAborted();now+=ms;await onWait?.(ms);},onDiagnostic:event=>diagnostics.push(event)});
 return {life,channel,calls,errors,diagnostics,get renewals(){return renewals;},get claims(){return claims;},advance:ms=>{now+=ms;}};
}
const success=({session_id,initial})=>Response.json({renewed:{session_id,expires_at:iso(initial+1720000),renewable_until:iso(initial+3600000)}});
const unavailable=()=>Response.json({code:'APP_RESOURCE_SYNC_FAILURE'},{status:503});

test('recovery: actual Kit35 V3 default timer precedes the Runtime deadline',async()=>{
 const f=fixture({fetch:args=>args.renewals===1?new Promise(()=>{}):success(args)});
 const result=await f.life.renew(new AbortController().signal);
 assert.deepEqual(f.errors[0],{name:'ResourceSyncClientError',status:0,code:'APP_RESOURCE_SYNC_TIMEOUT'});
 assert.equal(result,true);
 assert.equal(f.renewals,2);
});

test('recovery: Runtime deadline first at actual lease expiry stays closed',async()=>{
 const f=fixture({remaining_ms:5,fetch:({signal})=>new Promise(()=>{signal.addEventListener('abort',()=>f.advance(6),{once:true});})});
 assert.equal(await f.life.renew(new AbortController().signal),false);
 assert.equal(f.errors[0].code,'APP_RESOURCE_SYNC_ABORTED');assert.equal(f.renewals,1);
 assert.equal(await f.life.client.claim(),null);assert.equal(f.claims,0);
 assert.equal(f.diagnostics.at(-1).reason,'expired');
});

test('recovery: SDK timer first renews with the same exact expectation',async()=>{
 const f=fixture({timeout_ms:5,fetch:args=>args.renewals===1?new Promise(()=>{}):success(args)});
 assert.equal(await f.life.renew(new AbortController().signal),true);
 assert.equal(f.errors[0].code,'APP_RESOURCE_SYNC_TIMEOUT');assert.equal(f.renewals,2);
 assert.deepEqual(f.calls[0],f.calls[1]);
});

test('recovery: outage longer than the immediate burst can recover without reopening claims while uncertain',async()=>{
 const f=fixture({fetch:args=>args.renewals<=3?unavailable():success(args)}),before=JSON.stringify(f.channel);
 assert.equal(await f.life.renew(new AbortController().signal),false);assert.equal(f.renewals,3);
 assert.equal(await f.life.client.claim(),null);assert.equal(f.claims,0);
 f.advance(10000);
 assert.equal(await f.life.renew(new AbortController().signal),true,'Transient exhaustion must not permanently latch a still-live channel');
 assert.equal(f.renewals,4);assert.equal(JSON.stringify(f.channel),before);
 await f.life.client.claim();assert.equal(f.claims,1,'Only the exact successful ACK reopens the public claim transport');
});

test('recovery: transient startup reconciliation can retry a still-current Host session',async()=>{
 const controller=new AbortController();
 const f=fixture({stale:true,fetch:args=>args.renewals===1?unavailable():success(args),onWait:()=>{if(f.life.state==='live')controller.abort();}});
 assert.equal(await f.life.client.claim(),null);assert.equal(f.claims,0);
 await f.life.run(controller.signal);
 assert.equal(f.renewals,2,'Transient startup failure must not end the only renewal worker');
 assert.ok(f.diagnostics.some(e=>e.phase==='live'));assert.equal(f.life.state,'closed');
});

test('recovery: background supervision survives an outage longer than a burst with no uncertain claims or effect calls',async()=>{
 const waits=[],controller=new AbortController();
 const f=fixture({fetch:async args=>{assert.equal(await f.life.client.claim(),null);return args.renewals<=4?unavailable():success(args);},onWait:ms=>{waits.push(ms);if(f.life.state==='live')controller.abort();}});
 await f.life.run(controller.signal);
 assert.equal(f.renewals,5);assert.equal(f.claims,0);assert.ok(waits.includes(5000));assert.ok(waits.every(ms=>ms<=30000));
 assert.ok(f.calls.every(c=>c.op==='renew'));assert.ok(f.diagnostics.some(e=>e.phase==='unavailable'));assert.ok(f.diagnostics.some(e=>e.phase==='live'));
});

test('recovery: outage expires at the known lease and never resurrects even after later transport recovery',async()=>{
 let recovered=false;const waits=[];
 const f=fixture({fetch:args=>recovered?success(args):unavailable(),onWait:ms=>waits.push(ms)});
 await f.life.run(new AbortController().signal);
 assert.equal(f.life.state,'expired');assert.equal(await f.life.client.claim(),null);const count=f.renewals;
 recovered=true;assert.equal(await f.life.renew(new AbortController().signal),false);assert.equal(f.renewals,count);assert.equal(f.claims,0);assert.ok(waits.every(ms=>ms>0&&ms<=30000));
});

test('recovery: actual public transport lost ACK retains exact expectation and original enrollment',async()=>{
 let hostCommitted,hostChanges=0;
 const f=fixture({fetch:args=>{if(!hostCommitted){hostCommitted={session_id:args.session_id,expires_at:iso(args.initial+1720000),renewable_until:iso(args.initial+3600000)};hostChanges++;throw new TypeError('fetch failed');}return Response.json({renewed:hostCommitted});}}),before=JSON.stringify(f.channel);
 assert.equal(await f.life.renew(new AbortController().signal),true);
 assert.deepEqual(f.calls[0],f.calls[1]);assert.equal(hostChanges,1);assert.equal(f.life.expires_at,hostCommitted.expires_at);assert.equal(JSON.stringify(f.channel),before);assert.equal(f.life.state,'live');
});

test('recovery: startup survives multiple transient bursts but cannot claim before exact Host acknowledgement',async()=>{
 const controller=new AbortController(),waits=[];
 const f=fixture({stale:true,fetch:async args=>{assert.equal(await f.life.client.claim(),null);return args.renewals<=6?unavailable():success(args);},onWait:ms=>{waits.push(ms);if(f.life.state==='live')controller.abort();}});
 await f.life.run(controller.signal);
 assert.equal(f.renewals,7);assert.equal(f.claims,0);assert.ok(waits.includes(5000));assert.ok(waits.includes(10000));assert.ok(f.diagnostics.some(e=>e.phase==='live'));
});

test('recovery: definitive revocation never retries or restores claims',async()=>{
 const f=fixture({fetch:()=>Response.json({code:'APP_RESOURCE_SYNC_ACCESS_DENIED'},{status:403})});
 assert.equal(await f.life.renew(new AbortController().signal),false);assert.equal(f.life.state,'denied');
 assert.equal(await f.life.renew(new AbortController().signal),false);assert.equal(f.renewals,1);assert.equal(await f.life.client.claim(),null);assert.equal(f.claims,0);
});

test('recovery: shutdown during actual public transport aborts once without another request',async()=>{
 let entered;const ready=new Promise(resolve=>{entered=resolve;}),controller=new AbortController();
 const f=fixture({fetch:()=>{entered();return new Promise(()=>{});}}),run=f.life.run(controller.signal);
 await ready;controller.abort();await run;
 assert.equal(f.life.state,'closed');assert.equal(f.renewals,1);assert.equal(f.errors[0].code,'APP_RESOURCE_SYNC_ABORTED');assert.equal(await f.life.client.claim(),null);
});
