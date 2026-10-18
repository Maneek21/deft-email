import test from 'node:test';
import assert from 'node:assert/strict';
import {runPollingWorker} from './polling-worker.mjs';

async function sequence(values){
 const controller=new AbortController(),waits=[];let claims=0;
 const runner={async runOnce(signal){assert.equal(signal,controller.signal);const value=values[claims++];if(value instanceof Error)throw value;return value;}};
 await runPollingWorker(runner,{signal:controller.signal,waitMs:500,maxWaitMs:5000,wait:async ms=>{waits.push(ms);if(waits.length===values.length)controller.abort();}});
 return {waits,claims};
}
test('action polling backs off empty claims to5s and resets only after claimed work',async()=>{
 const work={status:'not_attempted',error_code:'APP_RUN_PROVIDER_UNAVAILABLE'};
 assert.deepEqual(await sequence([null,null,null,null,null,null,work,null,null]),{waits:[500,1000,2000,4000,5000,5000,500,500,1000],claims:9});
});
test('action polling exceptions back off without retrying a claimed start or action',async()=>{
 const denied=new Error('synthetic claim transport denied');
 assert.deepEqual(await sequence([denied,denied,denied,denied,denied]),{waits:[500,1000,2000,4000,5000],claims:5});
});
test('action polling starts immediately and shutdown aborts pending delay before another claim',async()=>{
 const controller=new AbortController();let claims=0,waiting;
 const entered=new Promise(resolve=>{waiting=resolve;});
 const running=runPollingWorker({async runOnce(){claims++;return null;}},{signal:controller.signal,waitMs:500,maxWaitMs:5000,wait:async(ms,unused,{signal})=>{assert.equal(ms,500);waiting();await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});}});
 assert.equal(claims,1);await entered;controller.abort();await running;assert.equal(claims,1);
});
