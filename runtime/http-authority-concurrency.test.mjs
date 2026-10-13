import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createAuthorityClient} from './http.mjs';
const token='a'.repeat(43);
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const client=(host,fetch,path='/api/app-data/runtime/authority')=>createAuthorityClient({authority_url:`https://${host}${path}`,authority_token:token,fetch});

test('two account metadata bursts share bounded Host transport, retain every fresh check and fit Host16 cap',async()=>{
 let active=0,peak=0,rejected=0;const ids=[];
 const fetch=async(_url,options)=>{
  if(active===16){rejected++;return Response.json({error:'APP_RESOURCE_SYNC_FAILURE'},{status:503});}
  active++;peak=Math.max(peak,active);const input=JSON.parse(options.body);ids.push(input.request_id);
  try{await delay(20);return Response.json({...input,allowed:true});}finally{active--;}
 };
 const a=client('burst.test',fetch),b=client('burst.test',fetch,'/api/app-data/runtime/other-authority');
 const results=await Promise.allSettled(Array.from({length:20},(_,i)=>(i<10?a:b)({request_id:'fresh-'+i,operation:'resource_list',expires_at:new Date(Date.now()+10000).toISOString()})));
 assert.equal(results.filter(result=>result.status==='fulfilled').length,20);
 assert.equal(rejected,0);assert.ok(peak<=8);assert.equal(new Set(ids).size,20);
 await a({request_id:'same'});await a({request_id:'same'});assert.equal(ids.filter(id=>id==='same').length,2,'settled authority is never cached');
});

test('queued abort and elapsed original expiry prevent HTTP dispatch',async()=>{
 for(const kind of ['abort','expiry']){
  const hold=deferred(),started=deferred();let calls=0;
  const call=client(kind+'.test',async()=>{if(++calls===8)started.resolve();await hold.promise;return Response.json({allowed:true});});
  const occupying=Array.from({length:8},()=>call({}));await started.promise;
  const controller=new AbortController();
  const pending=call({expires_at:new Date(Date.now()+25).toISOString()},controller.signal);const rejected=assert.rejects(pending);
  if(kind==='abort')controller.abort();else await delay(40);
  hold.resolve();await Promise.all(occupying);await rejected;assert.equal(calls,8);
 }
});

test('queue is bounded and drains without dropping accepted checks',async()=>{
 const hold=deferred(),started=deferred();let calls=0;
 const call=client('queue.test',async()=>{if(++calls===8)started.resolve();await hold.promise;return Response.json({allowed:true});});
 const running=Array.from({length:8},()=>call({}));await started.promise;
 const queued=Array.from({length:128},()=>call({}));
 await assert.rejects(call({}),error=>error.code==='EMAIL_RUNTIME_TRANSPORT_LIMIT');
 hold.resolve();await Promise.all([...running,...queued]);assert.equal(calls,136);
 await call({});assert.equal(calls,137);
});

test('response bodies retain slots and non200 or malformed body releases them',async()=>{
 const body=deferred(),started=deferred();let calls=0;
 const call=client('body.test',async()=>{
  const index=++calls;if(calls===8)started.resolve();
  if(index<=8)return new Response(new ReadableStream({async start(controller){await body.promise;controller.enqueue(new TextEncoder().encode('{"allowed":true}'));controller.close();}}),{headers:{'content-type':'application/json'}});
  if(index===9)return Response.json({error:'denied'},{status:503});
  if(index===10)return new Response('invalid',{headers:{'content-type':'application/json'}});
  if(index===11)return new Response(new ReadableStream({start(controller){controller.error(Error('synthetic body failure'));}}),{headers:{'content-type':'application/json'}});
  return Response.json({allowed:true});
 });
 const pending=Array.from({length:8},()=>call({}));await started.promise;
 const later=[call({}),call({}),call({}),call({})];const settled=Promise.allSettled(later);
 await delay(10);assert.equal(calls,8,'headers alone cannot release a slot');
 body.resolve();await Promise.all(pending);assert.deepEqual((await settled).map(result=>result.status),['rejected','rejected','rejected','fulfilled']);
 await call({});assert.equal(calls,13);
});

test('abort cancels stalled bodies and releases slots to still-current queued calls',async()=>{
 const started=deferred();let calls=0,cancelled=0;
 const call=client('body-abort.test',async()=>{
  if(++calls===8)started.resolve();
  return calls<=8?new Response(new ReadableStream({cancel(){cancelled++;}}),{headers:{'content-type':'application/json'}}):Response.json({allowed:true});
 });
 const controllers=Array.from({length:8},()=>new AbortController());
 const pending=controllers.map(controller=>call({},controller.signal));const settled=Promise.allSettled(pending);
 await started.promise;const next=call({});await delay(5);assert.equal(calls,8);
 for(const controller of controllers)controller.abort();
 assert.ok((await settled).every(result=>result.status==='rejected'));assert.deepEqual(await next,{allowed:true});assert.equal(cancelled,8);assert.equal(calls,9);
});

test('the original five-second transport clock includes queued time and stalled response bodies',async()=>{
 const started=deferred();let calls=0;
 const call=client('deadline.test',async()=>{
  if(++calls===8)started.resolve();
  return new Response(new ReadableStream(),{headers:{'content-type':'application/json'}});
 });
 const pending=Array.from({length:8},()=>call({}));const occupying=Promise.allSettled(pending);await started.promise;
 const began=Date.now(),queued=call({});const timeout=delay(6000).then(()=>{throw Error('transport clock restarted after queue');});
 const result=await Promise.race([Promise.allSettled([queued]),timeout]);
 assert.equal(result[0].status,'rejected');assert.equal(result[0].reason.name,'TimeoutError');assert.ok(Date.now()-began<6000);
 assert.ok((await occupying).every(row=>row.status==='rejected'));
});
