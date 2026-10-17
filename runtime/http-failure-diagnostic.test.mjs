import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID,randomBytes} from 'node:crypto';
import {createHttpHandler} from './http.mjs';
import {makeScope} from './test-support.mjs';

test('HTTP Refresh failures expose only validated request pins, status and static codes',async t=>{
 const auth=randomBytes(32).toString('base64url'),entries=[];
 let failure=Object.assign(new Error('SECRET provider body and bearer token'),{code:'EMAIL_OAUTH_PROVIDER_UNAVAILABLE',cause:new Error('SECRET nested credential'),headers:{authorization:'SECRET'},body:'SECRET mailbox content'});
 const server=createServer(createHttpHandler({runtime_auth_token:auth,onFailure:entry=>entries.push(entry),data_runtime:{async request(){throw failure;}}}));
 await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>server.close(done)));
 const input={schema_version:'deft.app_data_runtime.v1',request_id:randomUUID(),scope:makeScope(),connection:{session_id:randomUUID(),session_revision:1,runtime_session_ref:'local',account_ref:'fixture-account'},authority:{consent_id:randomUUID(),consent_digest:'sha256:'+'d'.repeat(64),data_policy_digest:'sha256:'+'e'.repeat(64)},operation:'resource_refresh',expires_at:new Date(Date.now()+29000).toISOString(),input:{store_key:'drafts',resource_key:'inbox'}};
 const call=async(value=input,bearer=auth)=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/v1/data`,{method:'POST',headers:{authorization:'Bearer '+bearer,'content-type':'application/json'},body:JSON.stringify(value)});return {status:response.status,body:await response.json()};};
 const unavailable={status:503,body:{error:'EMAIL_RUNTIME_UNAVAILABLE'}};
 assert.deepEqual(await call(),unavailable);
 assert.deepEqual(entries,[{event:'email_runtime_http_failure',request_id:input.request_id,operation:'resource_refresh',status:503,code:'EMAIL_OAUTH_PROVIDER_UNAVAILABLE'}]);
 failure=Object.assign(new Error('SECRET message'),{code:'EMAIL_PROVIDER_SECRET_RAW_CODE',name:'SECRET name',cause:{code:'SECRET nested code'}});
 assert.deepEqual(await call(),unavailable);assert.equal(entries.at(-1).code,'EMAIL_RUNTIME_UNAVAILABLE');
 failure=new DOMException('SECRET timeout body','TimeoutError');
 assert.deepEqual(await call(),unavailable);assert.equal(entries.at(-1).code,'EMAIL_RUNTIME_TIMEOUT');
 assert.equal(JSON.stringify(entries).includes('SECRET'),false);
 await call({...input,request_id:'SECRET invalid ID'});await call({...input,operation:'SECRET operation'});await call({...input,input:{...input.input,extra:'SECRET payload'}});await call(input,randomBytes(32).toString('base64url'));
 assert.equal(entries.length,3);
});

test('diagnostic sink failure cannot change HTTP failure response',async t=>{
 const auth=randomBytes(32).toString('base64url');
 const server=createServer(createHttpHandler({runtime_auth_token:auth,onFailure(){throw Error('SECRET logging failure');},data_runtime:{async request(){throw Object.assign(Error('SECRET'),{code:'EMAIL_RUNTIME_TRANSPORT_DENIED'});}}}));
 await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>server.close(done)));
 const input={schema_version:'deft.app_data_runtime.v1',request_id:randomUUID(),scope:makeScope(),connection:{session_id:randomUUID(),session_revision:1,runtime_session_ref:'local',account_ref:'fixture-account'},authority:{consent_id:randomUUID(),consent_digest:'sha256:'+'d'.repeat(64),data_policy_digest:'sha256:'+'e'.repeat(64)},operation:'resource_refresh',expires_at:new Date(Date.now()+29000).toISOString(),input:{store_key:'drafts',resource_key:'inbox'}};
 const response=await fetch(`http://127.0.0.1:${server.address().port}/v1/data`,{method:'POST',headers:{authorization:'Bearer '+auth,'content-type':'application/json'},body:JSON.stringify(input)});
 assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'EMAIL_RUNTIME_UNAVAILABLE'});
});
