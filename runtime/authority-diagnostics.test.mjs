import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthorityTimingReporter,measureAuthorityTiming} from './authority-diagnostics.mjs';

const sample=(elapsed_ms,extra={})=>({route:'data',outcome:'completed',elapsed_ms,queue_ms:elapsed_ms/10,http_ms:elapsed_ms*0.9,...extra});
test('bounded authority summaries include fast successful calls and exact batch percentiles',()=>{
 let now=0;const events=[],report=createAuthorityTimingReporter({clock:()=>now,emit:event=>events.push(event)});
 for(let n=1;n<=63;n++)report(sample(n));assert.equal(events.length,0);
 report(sample(64));assert.equal(events.length,1);
 const event=events[0];assert.equal(event.route,'data');assert.equal(event.calls,64);assert.equal(event.completed,64);
 assert.equal(event.completed_under_150_ms,64);assert.deepEqual(event.elapsed_ms,{p50:32,p95:61,max:64,total:2080});
 assert.equal(event.queue_ms.p95,6.1);assert.equal(event.http_ms.p95,54.9);
 for(let n=1;n<=64;n++)report(sample(100+n));
 assert.equal(events.length,2);assert.equal(events[1].elapsed_ms.p50,132);assert.equal(events[1].completed_under_150_ms,49);
});
test('routes and failures are separate, periodic flush is bounded and diagnostics expose no content',()=>{
 let now=0;const events=[],report=createAuthorityTimingReporter({clock:()=>now,emit:event=>events.push(event)});
 report(sample(10));report(sample(20,{route:'connection'}));report(sample(999,{outcome:'denied'}));
 report(sample(888,{outcome:'failed',private:'SECRET',route:'https://private.example.test/path?token=SECRET'}));
 now=60000;report(sample(30));
 assert.equal(events.length,1);assert.equal(events[0].calls,3);assert.equal(events[0].completed,2);
 assert.equal(events[0].denied,1);assert.equal(events[0].failed,0);assert.equal(events[0].elapsed_ms.p95,30);
 assert.ok(!JSON.stringify(events).includes('SECRET'));
 report(sample(40,{route:'connection'}));assert.equal(events[1].route,'connection');assert.equal(events[1].calls,2);
 report(sample(1,{route:'other'}));assert.equal(events[2].route,'other');assert.equal(events[2].failed,1);
});
test('summary sink failures cannot affect authority work',()=>{
 const report=createAuthorityTimingReporter({emit(){throw Error('unavailable diagnostics');}});
 assert.doesNotThrow(()=>{for(let n=0;n<64;n++)report(sample(n));});
});
test('public Kit callback timing retains exact results and failures without changing its client',async()=>{
 const samples=[],result={allowed:true};
 assert.strictEqual(await measureAuthorityTiming({route:'resource',queue_ms:7,onTiming:event=>samples.push(event)},async()=>result),result);
 assert.equal(samples[0].queue_ms,7);assert.equal(samples[0].dispatched,true);assert.equal(samples[0].route,'resource');
 const error=Object.assign(Error('PRIVATE'),{status:403});
 await assert.rejects(measureAuthorityTiming({route:'resource',onTiming:event=>{samples.push(event);throw Error('sink');}},async()=>{throw error;}),value=>value===error);
 assert.equal(samples[1].outcome,'denied');assert.ok(!JSON.stringify(samples).includes('PRIVATE'));
 await assert.rejects(measureAuthorityTiming({route:'resource',onTiming:event=>samples.push(event)},async()=>{throw Error('pre-transport validation');}));
 assert.equal(samples[2].dispatched,false,'a public client failure without HTTP evidence cannot claim a dispatch');
});
test('asynchronously failed diagnostic sinks are isolated too',async()=>{
 const report=createAuthorityTimingReporter({emit:async()=>{throw Error('unavailable async sink');}});
 for(let n=0;n<64;n++)report(sample(n));
 const result={allowed:true};
 assert.strictEqual(await measureAuthorityTiming({route:'resource',onTiming:async()=>{throw Error('async sink');}},async()=>result),result);
 await new Promise(done=>setImmediate(done));
});
