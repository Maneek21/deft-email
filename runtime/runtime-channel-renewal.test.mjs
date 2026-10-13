import test from 'node:test';
import assert from 'node:assert/strict';
import {createRuntimeChannelRenewal} from './runtime-channel-renewal.mjs';

const iso=n=>new Date(n).toISOString(),signal=()=>new AbortController().signal;
function fixture(options={}){
 let now=0,claims=0,renewals=0;
 const channel={channel_url:'https://fixture.invalid/api/app-runtime/channel',credential:{session_id:'session',session_token:'unchanged'},registration:{org_id:'org',runtime_registration_id:'registration',runtime_epoch:4},technical_renewal:{expires_at:iso(900000),renewable_until:iso(3600000)}};
 const calls=[],client={claim:async()=>{claims++;return {session_id:'session',session_epoch:7,attempt_id:'original'};},authorize:async claim=>{calls.push(claim);return claim;},heartbeat:async()=>true,start:async claim=>claim,result:async result=>result,
  renew:async(body,s)=>{renewals++;s.throwIfAborted();return options.renew?options.renew(body,s):{session_id:'session',expires_at:iso(Math.min(now+900000,3600000)),renewable_until:iso(3600000)};}};
 const lifecycle=createRuntimeChannelRenewal({channel,runtime_client:client,now:()=>now,wait:async(ms,_value,{signal:s})=>{s.throwIfAborted();now+=ms;}});
 return {channel,client,lifecycle,calls,setNow:n=>{now=n;},get now(){return now;},get claims(){return claims;},get renewals(){return renewals;}};
}

test('legacy enrollment returns the original client and never acquires renewal capability',()=>{
 const channel={channel_url:'https://fixture.invalid',credential:{session_id:'old',session_token:'unchanged'},registration:{}};
 const client={claim(){}};const before=JSON.stringify(channel);
 const life=createRuntimeChannelRenewal({channel,runtime_client:client});
 assert.equal(life.client,client);assert.equal(life.renewable,false);assert.equal(life.renew,undefined);assert.equal(JSON.stringify(channel),before);
});

test('same-session renewal crosses original expiry while existing attempt identity is unchanged',async()=>{
 const f=fixture();const before=JSON.stringify(f.channel),claim=await f.lifecycle.client.claim();
 f.setNow(820000);assert.equal(await f.lifecycle.renew(signal()),true);f.setNow(960000);
 assert.equal(await f.lifecycle.client.authorize(claim),claim);assert.equal(await f.lifecycle.client.start(claim),claim);assert.equal(await f.lifecycle.client.heartbeat(claim),true);
 assert.equal((await f.lifecycle.client.claim()).session_epoch,7);assert.equal(f.renewals,1);assert.equal(JSON.stringify(f.channel),before);
});

test('claims stop below normal request lifetime and never trigger renewal themselves',async()=>{
 const f=fixture();f.setNow(870001);assert.equal(await f.lifecycle.client.claim(),null);assert.equal(f.claims,0);assert.equal(f.renewals,0);
});

test('lost renewal ACK retries same expected deadline; concurrent calls share one transport',async()=>{
 let release;const held=new Promise(resolve=>{release=resolve;});let calls=0;
 const f=fixture({renew:async(body)=>{calls++;assert.equal(body.expected_expires_at,iso(900000));await held;if(calls===1)throw new TypeError('fetch failed');return {session_id:'session',expires_at:iso(1720000),renewable_until:iso(3600000)};}});
 f.setNow(820000);const a=f.lifecycle.renew(signal()),b=f.lifecycle.renew(signal());release();
 assert.deepEqual(await Promise.all([a,b]),[true,true]);assert.equal(calls,2);assert.equal(f.lifecycle.expires_at,iso(1720000));
});

test('revoked or shortened authority denial stops new claims without retrying active attempt methods',async()=>{
 const f=fixture({renew:async()=>{throw Object.assign(new Error('denied'),{status:403});}});
 const claim=await f.lifecycle.client.claim();f.setNow(820000);assert.equal(await f.lifecycle.renew(signal()),false);assert.equal(f.renewals,1);assert.equal(await f.lifecycle.client.claim(),null);
 assert.equal(await f.lifecycle.client.authorize(claim),claim);assert.equal(f.calls.length,1);
});

test('foreign identity, changed ceiling, malformed or regressed deadline permanently deny',async()=>{
 for(const change of [{session_id:'foreign'},{renewable_until:iso(7200000)},{expires_at:'bad'},{expires_at:iso(800000)},{expires_at:iso(3600001)}]){
  const f=fixture({renew:async()=>({session_id:'session',expires_at:iso(1720000),renewable_until:iso(3600000),...change})});f.setNow(820000);
  assert.equal(await f.lifecycle.renew(signal()),false);assert.equal(await f.lifecycle.client.claim(),null);assert.equal(f.renewals,1);
 }
});

test('late successful ACK cannot resurrect an expired local lease',async()=>{
 let f;f=fixture({renew:async()=>{f.setNow(900001);return {session_id:'session',expires_at:iso(1720000),renewable_until:iso(3600000)};}});f.setNow(820000);
 assert.equal(await f.lifecycle.renew(signal()),false);assert.equal(f.lifecycle.expires_at,iso(900000));assert.equal(await f.lifecycle.client.claim(),null);
});

test('transport retries are bounded and never retry a provider/start/result method',async()=>{
 const f=fixture({renew:async()=>{throw Object.assign(new Error('unavailable'),{status:503});}});f.setNow(820000);
 assert.equal(await f.lifecycle.renew(signal()),false);assert.equal(f.renewals,3);assert.equal(f.claims,0);assert.equal(f.calls.length,0);
});

test('one background task renews before margin and stops at immutable ceiling',async()=>{
 const f=fixture();await f.lifecycle.run(signal());assert.ok(f.renewals>=1);assert.equal(f.lifecycle.expires_at,iso(3600000));assert.equal(f.now<3600000,true);
});

test('shutdown aborts a pending renewal and prevents further claims',async()=>{
 let entered;const ready=new Promise(resolve=>{entered=resolve;});
 const f=fixture({renew:async(_body,s)=>{entered();await new Promise((_,reject)=>s.addEventListener('abort',()=>reject(s.reason),{once:true}));}});f.setNow(820000);
 const controller=new AbortController(),running=f.lifecycle.run(controller.signal);await ready;controller.abort();await running;
 assert.equal(await f.lifecycle.client.claim(),null);assert.equal(f.renewals,1);
});

test('invalid metadata and missing client renew deny opt-in',()=>{
 const f=fixture();
 for(const metadata of [{expires_at:iso(900000),renewable_until:iso(800000)},{...f.channel.technical_renewal,extra:true}])assert.throws(()=>createRuntimeChannelRenewal({channel:{...f.channel,technical_renewal:metadata},runtime_client:f.client,now:()=>0}));
 assert.throws(()=>createRuntimeChannelRenewal({channel:f.channel,runtime_client:{claim(){}},now:()=>0}));
});

test('stale initial expiry reconciles once against a still-current Host session; expired or uncertain Host remains dormant',async()=>{
 for(const mode of ['host_current','host_expired','unknown','ceiling_expired']){
  let calls=0,claims=0;
  const channel={channel_url:'https://fixture.invalid',credential:{session_id:'same',session_token:'unchanged'},registration:{},technical_renewal:{expires_at:iso(900000),renewable_until:iso(3600000)}};
  const client={claim:async()=>{claims++;return null;},renew:async(body)=>{calls++;assert.equal(body.expected_expires_at,iso(900000));if(mode==='host_expired')throw Object.assign(new Error('expired'),{status:403});if(mode==='unknown')throw new TypeError('fetch failed');return {session_id:'same',expires_at:iso(3600000),renewable_until:iso(3600000)};}};
  const life=createRuntimeChannelRenewal({channel,runtime_client:client,now:()=>mode==='ceiling_expired'?3600001:960000});
  assert.equal(await life.client.claim(),null);assert.equal(claims,0);
  await life.run(signal());assert.equal(calls,mode==='ceiling_expired'?0:1);
  await life.client.claim();assert.equal(claims,mode==='host_current'?1:0);
  assert.equal(channel.credential.session_token,'unchanged');
 }
});
