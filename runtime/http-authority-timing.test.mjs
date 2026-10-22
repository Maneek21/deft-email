import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAuthorityClient} from './http.mjs';
import {createDataChecker} from './data-contract.mjs';
import {makeScope} from './test-support.mjs';

test('actual authority dispatch timings distinguish in-flight guard sharing from fresh callbacks',async()=>{
 const samples=[];let dispatches=0;
 const current=createAuthorityClient({authority_url:'https://authority-timings.test/api/app-data/runtime/authority',authority_token:'a'.repeat(43),
  onTiming:event=>samples.push(event),fetch:async(url,options)=>{dispatches++;await new Promise(done=>setTimeout(done,10));return Response.json({...JSON.parse(options.body),allowed:true});}});
 const request={scope:makeScope(),request_id:randomUUID(),connection:{},authority:{},operation:'record_read',input:{},expires_at:new Date(Date.now()+29000).toISOString()};
 const guard=createDataChecker({request,assertCurrent:current});
 try{
  await Promise.all([guard.check(),guard.check()]);assert.equal(dispatches,1);assert.equal(samples.length,1);
  await Promise.all([guard.checkFresh(),guard.checkFresh()]);assert.equal(dispatches,3);assert.equal(samples.length,3);
  for(const sample of samples){assert.equal(sample.route,'data');assert.equal(sample.outcome,'completed');assert.equal(sample.dispatched,true);
   assert.ok(sample.http_ms>=5);assert.ok(sample.queue_ms>=0);assert.ok(sample.elapsed_ms>=sample.http_ms);}
  assert.deepEqual(Object.keys(samples[0]).sort(),['event','route','outcome','dispatched','elapsed_ms','queue_ms','http_ms'].sort());
 }finally{guard.dispose();}
});
test('denial, transport failure and a broken timing sink retain the original result and expose no private values',async()=>{
 for(const status of [200,403,503]){
  const samples=[],client=createAuthorityClient({authority_url:`https://authority-timings-${status}.test/api/app-data/runtime/authority`,authority_token:'s'.repeat(43),
   onTiming:event=>{samples.push(event);throw Error('private diagnostic failure');},fetch:async()=>Response.json(status===200?{allowed:true}:{error:'PRIVATE BODY AND TOKEN'},{status})});
  if(status===200)assert.deepEqual(await client({private:'PRIVATE BODY AND TOKEN'}),{allowed:true});else await assert.rejects(client({private:'PRIVATE BODY AND TOKEN'}));
  assert.equal(samples.length,1);assert.equal(samples[0].outcome,status===200?'completed':status===403?'denied':'failed');
  assert.ok(!JSON.stringify(samples).includes('PRIVATE'));assert.ok(!JSON.stringify(samples).includes('https:'));
 }
});
