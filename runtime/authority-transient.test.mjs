import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createDataChecker} from './data-contract.mjs';
import {makeScope} from './test-support.mjs';

function request(){return {scope:makeScope(),request_id:randomUUID(),connection:{},authority:{},operation:'record_read',input:{},expires_at:new Date(Date.now()+29000).toISOString()};}
const transport=()=>Object.assign(new Error('synthetic Host transport failure'),{code:'EMAIL_RUNTIME_TRANSPORT_DENIED'});

test('one transient Host authority transport failure is retried once and the authorized decision is kept',async()=>{
 let calls=0;const checker=createDataChecker({request:request(),assertCurrent:async input=>{calls++;if(calls===1)throw transport();return {...input,allowed:true};}});
 try{
  await checker.check();
  assert.equal(calls,2,'the failed dispatch is repeated exactly once');
  const next=checker.check();
  assert.equal(calls,3,'a settled decision is never reused for the next fence');
  await next;
 }finally{checker.dispose();}
});

test('an explicit denial or an ordinary failure is final and never retried',async()=>{
 for(const code of ['EMAIL_RUNTIME_AUTHORITY_DENIED','EMAIL_DATA_AUTHORITY_DENIED','EMAIL_DATA_AUTHORITY_EXPIRED','EMAIL_DATA_CONNECTION_DENIED']){
  let calls=0;const checker=createDataChecker({request:request(),assertCurrent:async input=>{calls++;if(calls===1)throw Object.assign(new Error('denied'),{code});return {...input,allowed:true};}});
  try{await assert.rejects(checker.check(),error=>error.code===code);assert.equal(calls,1,`${code} is not retried`);}finally{checker.dispose();}
 }
 let plain=0;const unclassified=createDataChecker({request:request(),assertCurrent:async()=>{plain++;throw Error('revoked');}});
 try{await assert.rejects(unclassified.check(),/revoked/);assert.equal(plain,1,'an unclassified error is not assumed to be transient');}finally{unclassified.dispose();}
 let responses=0;const denied=createDataChecker({request:request(),assertCurrent:async input=>{responses++;return {...input,allowed:false};}});
 try{await assert.rejects(denied.check(),error=>error.code==='EMAIL_DATA_AUTHORITY_DENIED');assert.equal(responses,1,'an allowed:false response is final');}finally{denied.dispose();}
});

test('two consecutive transient authority transport failures still fail after one bounded retry',async()=>{
 let calls=0;const checker=createDataChecker({request:request(),assertCurrent:async()=>{calls++;throw transport();}});
 try{await assert.rejects(checker.check(),error=>error.code==='EMAIL_RUNTIME_TRANSPORT_DENIED');assert.equal(calls,2,'the retry is bounded to one extra dispatch');}finally{checker.dispose();}
});

test('an aborted or expired authority fence is never retried',async()=>{
 let calls=0;const controller=new AbortController(),checker=createDataChecker({request:request(),signal:controller.signal,assertCurrent:async()=>{calls++;controller.abort();throw transport();}});
 try{await assert.rejects(checker.check());assert.equal(calls,1);}finally{checker.dispose();}
 let expired=0;const request_=request(),clock=Date.now(),expiring=createDataChecker({request:request_,now:()=>clock+29000,assertCurrent:async()=>{expired++;throw transport();}});
 try{await assert.rejects(expiring.check());assert.equal(expired,0,'an already expired deadline never dispatches');}finally{expiring.dispose();}
});
