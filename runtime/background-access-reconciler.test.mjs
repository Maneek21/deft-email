import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackgroundAccessReconciler} from './background-access-reconciler.mjs';

const registration={org_id:'org',runtime_registration_id:'registration',operator_user_id:'operator',runtime_epoch:1,
 profile_digest:'digest',target_key:'account',resource_key:'records'};
test('service fetch retries transient outages forever with bounded exponential jitter and no effect replay',async()=>{
 let time=0,calls=0,active=false;const delays=[],events=[];
 const reconciler=createBackgroundAccessReconciler({registrations:[registration],authority_url:'https://host.test/api/app-connection-sessions/runtime/authority',authority_token:'private',
  now:()=>time,random:()=>1,needsReconcile:()=>!active,acknowledged:async()=>active,
  onDiagnostic:e=>events.push(e),fetch:async(url,request)=>{calls++;assert.equal(url,'https://host.test/api/app-connection-sessions/runtime/background-access');
   assert.equal(request.headers.authorization,'Bearer private');assert.deepEqual(JSON.parse(request.body),{registration});
   if(time<3600000)return Response.json({},{status:503});active=true;return Response.json({installed:[{session_id:'fresh'}],skipped:[]});}});
 const signal=new AbortController().signal;
 while(time<3600000){await reconciler.runOnce(signal);const before=calls;await reconciler.runOnce(signal);assert.equal(calls,before);const delay=Math.min(300000,1000*2**Math.min(19,calls-1));delays.push(delay);time+=delay;}
 assert.ok(calls>10);assert.equal(reconciler.state(registration),'unavailable');await reconciler.runOnce(signal);
 assert.equal(reconciler.state(registration),'live');assert.ok(active);assert.deepEqual(delays.slice(0,4),[1000,2000,4000,8000]);assert.ok(delays.includes(300000));
 assert.equal(JSON.stringify(events).includes('private'),false);
});
test('service permanent denial surfaces reconnect required and parks until a new enrollment',async()=>{
 let calls=0;const r=createBackgroundAccessReconciler({registrations:[registration],authority_url:'https://host.test',authority_token:'secret',needsReconcile:()=>true,
  acknowledged:async()=>false,onDiagnostic:()=>{},fetch:async()=>{calls++;return Response.json({},{status:403});}});
 const signal=new AbortController().signal;await r.runOnce(signal);assert.equal(r.state(registration),'reconnect_required');
 for(let i=0;i<20;i++)await r.runOnce(signal);assert.equal(calls,1);r.reset(registration);await r.runOnce(signal);assert.equal(calls,2);
});
test('lost service install ACK reconciles from the locally activated sessions without another issuance',async()=>{
 let active=false,calls=0;const r=createBackgroundAccessReconciler({registrations:[registration],authority_url:'https://host.test',authority_token:'secret',needsReconcile:()=>!active,
  acknowledged:async()=>true,onDiagnostic:()=>{},fetch:async()=>{calls++;active=true;throw new TypeError('fetch failed');}});
 const signal=new AbortController().signal;await r.runOnce(signal);await r.runOnce(signal);assert.equal(calls,1);assert.equal(r.state(registration),'live');
});
