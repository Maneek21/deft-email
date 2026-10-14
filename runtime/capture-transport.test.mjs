import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {createHttpHandler} from './http.mjs';
import {integrationKnowledgePresentation} from './integration-knowledge.mjs';
import {validateDataResult,dataInputDigest} from './data-contract.mjs';
test('V2 normalized Unicode evidence fits real data transport and presentation budgets',async t=>{
 const body='We agreed to keep this durable procedure. '+'語'.repeat(15900),id='11111111-1111-4111-8111-111111111111',hash='sha256:'+'a'.repeat(64);
 const record={record_id:id,logical_message_id:'mail_'+'a'.repeat(64),provider_revision:'revision',provider_source:{provider:'gmail'},data:{sender:'Person',date:'2026-10-11T00:00:00Z'},revision:1,folders:['inbox']};
 const presentation=integrationKnowledgePresentation(record,{plain_text:body,metadata:{}}),request={request_id:id,operation:'resource_read_presentation',input:{store_key:'drafts',resource_key:'inbox',record_id:id,content_digest:hash}};
 const result={schema_version:'deft.app_data_result.v1',request_id:id,operation:request.operation,input_digest:dataInputDigest(request),outcome:'completed',resource:{record_id:id,content_digest:hash,revision:'revision',label:'Procedure',data:{},tombstone:false,membership_generation:1,checkpoint_generation:1},files:[],presentation};
 assert.ok(Buffer.byteLength(presentation.metadata.capture_nomination)>16384);assert.ok(Buffer.byteLength(JSON.stringify(presentation))<262144);validateDataResult(result,request);
 const secret='a'.repeat(43),server=createServer(createHttpHandler({runtime_auth_token:secret,runtime:{},data_runtime:{request:async()=>result}}));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const response=await fetch('http://127.0.0.1:'+server.address().port+'/v1/data',{method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'application/json'},body:JSON.stringify(request)});
 assert.equal(response.status,200);const delivered=await response.json();assert.equal(JSON.parse(delivered.presentation.metadata.capture_nomination).body,body);
});
