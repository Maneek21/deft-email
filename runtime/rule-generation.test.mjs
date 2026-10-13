import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createDurableStore} from './durable-store.mjs';
import {createRuleStore} from './rule-store.mjs';
import {digest} from './contract.mjs';

const rule={enabled:true,name:'Synthetic generation rule',match:'all',conditions:[{field:'subject',operator:'contains',value:'Synthetic'}],exceptions:[],actions:['mark_read'],stop_processing:false,execution_location:'deft_service'};
const scope=()=>Object.fromEntries(['org_id','owner_user_id','account_id','installation_id'].map(name=>[name,randomUUID()]));
const check=async()=>{};
const options=(s,row)=>({request_id:randomUUID(),user_id:s.owner_user_id,check,...(row?{expected_revision:row.revision,expected_content_digest:row.content_digest}:{})});

test('every mutation invalidates a verified collection across reopen; legacy indexes cannot use fast fences',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'deft-rule-generation-')),key=randomBytes(32),s=scope();
 let store=await createDurableStore({root,encryption_key:key,key_id:'test',allow_windows_fixture:true}),rules=createRuleStore({store});
 const id=randomUUID(),one=await rules.create(s,id,rule,options(s));
 const a=await rules.snapshot(s,check);assert.ok(a.generation>0);await rules.assertGeneration(s,a.generation,check);
 const two=await rules.save(s,id,{...rule,name:'Changed'},options(s,one));
 await assert.rejects(rules.assertGeneration(s,a.generation,check),{code:'EMAIL_RULE_CONFLICT'});
 const b=await rules.snapshot(s,check);assert.ok(b.generation>a.generation);
 const second=await rules.create(s,randomUUID(),rule,options(s));
 await assert.rejects(rules.assertGeneration(s,b.generation,check),{code:'EMAIL_RULE_CONFLICT'});
 const c=await rules.snapshot(s,check);
 await rules.reorder(s,[second,two].map(r=>({record_id:r.record_id,expected_revision:r.revision,expected_content_digest:r.content_digest})),c.order_digest,options(s));
 await assert.rejects(rules.assertGeneration(s,c.generation,check),{code:'EMAIL_RULE_CONFLICT'});
 const d=await rules.snapshot(s,check);await rules.archive(s,id,options(s,two));
 await assert.rejects(rules.assertGeneration(s,d.generation,check),{code:'EMAIL_RULE_CONFLICT'});
 const e=await rules.snapshot(s,check);await store.close();
 store=await createDurableStore({root,encryption_key:key,key_id:'test',allow_windows_fixture:true});rules=createRuleStore({store});
 await rules.assertGeneration(s,e.generation,check);
 await assert.rejects(rules.assertGeneration(s,e.generation,async()=>{throw Error('revoked');}),/revoked/);
 let checks=0;await assert.rejects(rules.assertGeneration(s,e.generation,async()=>{if(++checks===2)throw Error('expired');}),/expired/);
 const legacy=scope();await store.withLock({key:'email.data.rule_index.'+digest([legacy,''])},tx=>tx.compareAndSwap({expected_revision:null,value:{schema_version:'email.app_rule_index.v1',scope:legacy,ids:[],receipts:[]}}));
 assert.equal((await rules.snapshot(legacy,check)).generation,null);
 await assert.rejects(rules.assertGeneration(legacy,1,check),{code:'EMAIL_RULE_CONFLICT'});await store.close();
});

test('interrupted row write advances the fence without hiding the old record',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'deft-rule-generation-crash-')),s=scope();
 const store=await createDurableStore({root,encryption_key:randomBytes(32),key_id:'test',allow_windows_fixture:true});
 const rules=createRuleStore({store}),id=randomUUID(),row=await rules.create(s,id,rule,options(s)),before=await rules.snapshot(s,check);
 let failRow=true;const wrapped={...store,withLock(input,work){return store.withLock(input,tx=>work({...tx,compareAndSwap(args){if(failRow&&input.key==='email.data.rule_record.'+digest([s,id]))throw Error('synthetic crash before row commit');return tx.compareAndSwap(args);}}));}};
 await assert.rejects(createRuleStore({store:wrapped}).save(s,id,{...rule,name:'Uncommitted'},options(s,row)),/synthetic crash/);
 failRow=false;await assert.rejects(rules.assertGeneration(s,before.generation,check),{code:'EMAIL_RULE_CONFLICT'});
 const after=await rules.snapshot(s,check);assert.equal(after.records[0].revision,row.revision);assert.equal(after.records[0].value.name,row.value.name);assert.equal(after.records.length,1);await store.close();
});
