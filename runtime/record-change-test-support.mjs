import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createDurableStore} from './durable-store.mjs';
import {createConnectionRuntime} from './connection-runtime.mjs';
import {createDataRuntime} from './data-runtime.mjs';
import {makeScope,registrationFor,client,providerFixture,authority,beginFor,nextFor} from './test-support.mjs';
export const draftValue=()=>({mode:'compose',to:'recipient@example.test',cc:'cc@example.test',bcc:'',subject:'Existing',body:'Existing text',body_html:'<p>Existing text</p>',reply_record_id:'',attachments:[]});
export const cas=row=>({store_key:row.store_key,record_id:row.record_id,expected_revision:row.revision,expected_content_digest:row.content_digest});
export async function changeFixture(t){
 const parent=await mkdtemp(join(tmpdir(),'email-record-change-')),root=join(parent,'state'),key=Buffer.alloc(32,29),scope=makeScope(),registration=registrationFor(scope);let store,calls=0,lose=false,denied=null,beforeDraftCommit=null,authorityCalls=0,authorityHook=null,offset=0;const now=()=>Date.now()+offset;
 const open=()=>createDurableStore({root,encryption_key:key,key_id:'record-change-fixture',allow_windows_fixture:process.platform==='win32'});store=await open();
 const fetch=async(...args)=>{calls++;return providerFixture(...args);},connection=createConnectionRuntime({registration,client,store,encryption_key:key,key_id:'record-change-fixture',assertCurrent:authority,fetch}),begin=beginFor(scope),begun=await connection.request(begin),connected=await connection.request(nextFor(begin,begun,'callback'));
 const wrapped={withLock(options,work){return store.withLock(options,tx=>work({...tx,async compareAndSwap(input){if(input.value.schema_version==='email.app_draft.v1'&&input.value.revision>1&&beforeDraftCommit)await beforeDraftCommit();if(lose&&input.value.schema_version==='email.app_mutation.v1'&&input.value.state==='completed'&&input.value.operation==='record_apply_change'){lose=false;throw Error('synthetic lost apply response journal');}return tx.compareAndSwap(input);}}));}};
 const consents=Object.fromEntries(['drafts','templates','signatures'].map((name,index)=>[name,{consent_id:randomUUID(),consent_digest:'sha256:'+String(index+1).repeat(64),data_policy_digest:'sha256:'+'e'.repeat(64)}]));
 const dependencies=()=>({registrations:[registration],client,store:wrapped,encryption_key:key,key_id:'record-change-fixture',fetch,now,assertCurrent:async input=>{authorityCalls++;if(input.schema_version==='deft.app_data_authority.v2'){for(const proof of input.record_authorities){const expected=consents[proof.store_key];if(proof.store_key===denied||!expected||Object.entries(expected).some(([key,value])=>proof[key]!==value))throw Error('synthetic store denied');}}else if(!Object.entries(consents).some(([store,consent])=>store!==denied&&JSON.stringify(consent)===JSON.stringify(input.authority)))throw Error('synthetic store denied');if(authorityHook)await authorityHook(input);return {...input,allowed:true};}});let runtime=createDataRuntime(dependencies());
 t.after(async()=>{await store.close();await rm(parent,{recursive:true,force:true});});
 const request=(operation,input)=>({schema_version:'deft.app_data_runtime.v1',request_id:randomUUID(),scope,connection:{session_id:begin.session_id,session_revision:5,runtime_session_ref:begun.runtime_session_ref,account_ref:connected.account.account_ref},authority:consents[input.store_key],operation,expires_at:new Date(now()+29000).toISOString(),input});
 return {root,scope,store:wrapped,consents,get runtime(){return runtime;},get authorityCalls(){return authorityCalls;},get calls(){return calls;},request,
  change(operation,input){const raw=request(operation,input);delete raw.authority;return {...raw,schema_version:'deft.app_data_runtime.v2',record_authorities:[{role:'destination',store_key:input.store_key,...consents[input.store_key],consent_expires_at:scope.consent_expires_at},{role:'source',store_key:input.source.store_key,...consents[input.source.store_key],consent_expires_at:scope.consent_expires_at}]};},
  run:(...args)=>runtime.request(...args),deny(store){denied=store;},allow(){denied=null;},lose(){lose=true;},beforeDraftCommit(callback){beforeDraftCommit=callback;},authorityHook(callback){authorityHook=callback;},advance(milliseconds){offset+=milliseconds;},async restart(){await store.close();store=await open();runtime=createDataRuntime(dependencies());},
  async create(store_key,value){return (await runtime.request(request('record_create',{store_key,record_id:randomUUID(),value}))).record;},
 };
}
