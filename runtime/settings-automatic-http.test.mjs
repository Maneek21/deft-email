import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {createHttpHandler} from './http.mjs';
import {changeFixture,draftValue,cas} from './record-change-test-support.mjs';

test('actual authenticated independent HTTP keeps automatic nomination and immutable initial snapshot across Prepare/Apply/read',async t=>{
 const f=await changeFixture(t),token='S'.repeat(43),server=createServer(createHttpHandler({runtime_auth_token:token,runtime:{},data_runtime:f.runtime}));await new Promise(done=>server.listen(0,'127.0.0.1',done));t.after(()=>new Promise(done=>server.close(done)));
 const post=(raw,authorized=true)=>fetch('http://127.0.0.1:'+server.address().port+'/v1/data',{method:'POST',headers:{'content-type':'application/json',...(authorized?{authorization:'Bearer '+token}:{})},body:JSON.stringify(raw)});
 const signature=await f.create('signatures',{address:'fixture@example.test',plain:'Saved automatically enabled signature',html:'',placement:'new'}),saved=(await f.run(f.request('record_save',{...cas(signature),value:{...signature.value,automatic:{schema_version:'deft.signature_automatic.v1',enabled:true}}}))).record,draft=await f.create('drafts',draftValue());
 const raw=f.change('record_prepare_change',{...cas(draft),operation_key:'signature_default',invocation_mode:'initial',source:cas(saved)});assert.equal((await post(raw,false)).status,401);
 const prepare=await post(raw);assert.equal(prepare.status,200);const plan=(await prepare.json()).prepared_change;assert.equal(plan.invocation_mode,'initial');assert.ok(plan.value.body.endsWith(saved.value.plain));
 const apply=f.change('record_apply_change',{...plan.destination,operation_key:plan.operation_key,source:plan.source,invocation_mode:'initial',prepared_id:plan.prepared_id,prepared_digest:plan.prepared_digest});const result=await post(apply);assert.equal(result.status,200);const record=(await result.json()).record;assert.equal(record.revision,2);assert.deepEqual(record.value,plan.value);
 f.consents.preferences={consent_id:randomUUID(),consent_digest:'sha256:'+'7'.repeat(64),data_policy_digest:'sha256:'+'8'.repeat(64)};const pref=await f.create('preferences',{external_images:'ask'}),read=await post(f.request('record_read',{store_key:'preferences',record_id:pref.record_id}));assert.equal(read.status,200);const policy=await read.json();assert.equal(policy.document_policy.automatic_value,'always');assert.equal(policy.record.value.external_images,'ask');assert.equal(Object.hasOwn(policy,'human_save'),false);
 assert.equal(f.calls,3);
});
