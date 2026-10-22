import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {createAuthorityClient,createHttpHandler} from './http.mjs';
import {makeScope} from './test-support.mjs';

test('a forbidden Host authority callback remains denied instead of reporting a Runtime outage',async t=>{
 const token=randomBytes(32).toString('base64url');let callbacks=0;
 const authority=createAuthorityClient({authority_url:'https://authority-denied.test/api/app-data/runtime/authority',authority_token:token,
  fetch:async()=>{callbacks++;return Response.json({error:'App data access ended',code:'APP_ACCESS_DENIED'},{status:403});}});
 const input={schema_version:'deft.app_data_runtime.v1',request_id:randomUUID(),scope:makeScope(),connection:{session_id:randomUUID(),session_revision:1,runtime_session_ref:'local',account_ref:'fixture-account'},authority:{consent_id:null,consent_digest:null,data_policy_digest:'sha256:'+'e'.repeat(64)},operation:'resource_list',expires_at:new Date(Date.now()+29000).toISOString(),input:{store_key:'drafts',resource_key:'inbox',cursor:null,limit:10}};
 const server=createServer(createHttpHandler({runtime_auth_token:token,data_runtime:{async request(){await authority(input);throw Error('denied authority must stop execution');}}}));
 await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>server.close(done)));
 const response=await fetch(`http://127.0.0.1:${server.address().port}/v1/data`,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(input)});
 assert.equal(response.status,403);assert.deepEqual(await response.json(),{error:'EMAIL_RUNTIME_AUTHORITY_DENIED'});assert.equal(callbacks,1,'forbidden authority is never retried');
});

test('authority authentication denial and backend failure remain distinct and never reuse authority',async()=>{
 for(const status of [401,403,429,500,503]){let calls=0;const client=createAuthorityClient({authority_url:`https://authority-status-${status}.test/callback`,authority_token:'a'.repeat(43),fetch:async()=>{calls++;return Response.json({error:'SECRET provider body'},{status});}});
  await assert.rejects(client({}),error=>error.code===(status===401||status===403?'EMAIL_RUNTIME_AUTHORITY_DENIED':'EMAIL_RUNTIME_TRANSPORT_DENIED'));assert.equal(calls,1);
 }
});
