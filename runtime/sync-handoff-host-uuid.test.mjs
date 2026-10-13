import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createMailboxStore,resourceUuid} from './mailbox-store.mjs';
import {makeScope} from './test-support.mjs';
import {canonical} from './contract.mjs';
import {uuid as generatedUuid} from './draft-store.mjs';

const hostSession='f972b46c-9636-59d4-84e4-e91e34b4321a';
const check=async()=>{};
function fixture(){
 const rows=new Map(),store={rows,async withLock({key},work){return work({async read(){return structuredClone(rows.get(key)??null);},async compareAndSwap({expected_revision,value}){const row=rows.get(key);if((row?.revision??null)!==expected_revision)return false;rows.set(key,{revision:(row?.revision??0)+1,value:structuredClone(value)});return true;}});}};
 const full=makeScope(),scope={org_id:full.org_id,owner_user_id:full.owner_user_id,account_id:randomUUID()},producer={scope:full,session_id:hostSession,runtime_session_ref:'fixture-current-session',custody_generation:12,client_fingerprint:'a'.repeat(64)};
 const logical='mail_'+'1'.repeat(64),item={account_id:scope.account_id,logical_message_id:logical,revision:'fixture-revision',data:{subject:'Synthetic refresh'},provider_source:{provider:'gmail',synthetic_id:'fixture'},folders:['inbox'],flags:{},received_at:'2026-10-13T00:00:00Z',inventory_generation:'fixture-generation'};
 const page={account_id:scope.account_id,items:[item],tombstones:[],state_updates:[{state_key:'native',generation:'fixture-generation',value:{continuation:'fixture'}}],observed_at:'2026-10-13T00:00:00Z',complete:false,has_more:true,next_cursor:'gmail-native-v1:'+randomUUID(),failure_count:0};
 return {store,scope,producer,page,logical,mailbox:createMailboxStore({store})};
}

test('Host UUIDv5 producer commits foreground Refresh after query read without changing generated record UUIDs',async()=>{
 const f=fixture();await f.mailbox.commit(f.scope,{...f.page,state_updates:[]},check);
 assert.equal((await f.mailbox.list(f.scope,{},check)).items.length,1);assert.equal(await f.mailbox.cursor(f.scope,check),null);
 const observed=await f.mailbox.commit(f.scope,f.page,check,{localCheck:check,sync_producer:f.producer});
 assert.equal(observed.provider_observed,true);assert.equal(await f.mailbox.cursor(f.scope,check),f.page.next_cursor);
 assert.equal((await f.mailbox.syncHead(f.scope,check)).last,1);
 assert.equal((await f.mailbox.getLogical(f.scope,f.logical,check)).record_id,resourceUuid(f.scope,f.logical));
 assert.equal(generatedUuid(resourceUuid(f.scope,f.logical)),true);assert.equal(generatedUuid(hostSession),false);
});

test('foreground handoff rejects malformed producer IDs and foreign ownership before checkpoint writes',async()=>{
 for(const change of [{session_id:'not-a-uuid'},{session_id:'f972b46c-9636-99d4-84e4-e91e34b4321a'},{scope:{org_id:randomUUID()}},{scope:{owner_user_id:randomUUID()}}]){
  const f=fixture(),producer={...f.producer,...change,...(change.scope?{scope:{...f.producer.scope,...change.scope}}:{})},before=canonical([...f.store.rows]);
  await assert.rejects(f.mailbox.commit(f.scope,f.page,check,{localCheck:check,sync_producer:producer}),{code:'EMAIL_SYNC_HANDOFF_INVALID'});
  assert.equal(canonical([...f.store.rows]),before);assert.equal(await f.mailbox.cursor(f.scope,check),null);
 }
});
