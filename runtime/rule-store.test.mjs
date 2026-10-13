import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRuleStore} from './rule-store.mjs';
import {validateRuleValue,evaluateRule,previewRules} from './rule-matcher.mjs';
import {createDurableStore} from './durable-store.mjs';
import {digest} from './contract.mjs';

const scope=()=>({org_id:randomUUID(),owner_user_id:randomUUID(),account_id:randomUUID(),installation_id:randomUUID()});
const value=(name='Manual project mail')=>({enabled:true,name,match:'all',conditions:[{field:'subject',operator:'contains',value:'Project'}],exceptions:[],actions:['star'],stop_processing:false,execution_location:'deft_service'});
const options=(s,extra={})=>({request_id:randomUUID(),user_id:s.owner_user_id,check:async()=>{},...extra});
const cas=row=>({expected_revision:row.revision,expected_content_digest:row.content_digest});
const ref=row=>({record_id:row.record_id,...cas(row)});
function memory(){const rows=new Map(),locks=new Map();return {rows,async withLock({key},work){const before=locks.get(key)??Promise.resolve();let release;const pending=new Promise(done=>release=done);locks.set(key,pending);await before;try{return await work({read:async()=>structuredClone(rows.get(key)??null),compareAndSwap:async({expected_revision,value})=>{const old=rows.get(key);if((old?.revision??null)!==expected_revision)return false;rows.set(key,{revision:(old?.revision??0)+1,value:structuredClone(value)});return true;}});}finally{release();if(locks.get(key)===pending)locks.delete(key);}}};}
const rule=raw=>({record_id:randomUUID(),revision:1,status:'draft',content_digest:'sha256:'+digest(raw),value:raw});
const message=account_id=>({account_id,record_id:randomUUID(),content_digest:'sha256:'+digest(randomUUID()),folders:['INBOX'],data:{subject:'ＰＲＯＪＥＣＴ Harbor',sender:'Mira@example.test',recipients:'me@example.test',cc:''}});

test('native condition normalization, any/all, exception, pause and stop order remain bounded and side-effect free',()=>{
 const s=scope(),row=message(s.account_id),first=value(),second={...value('Second'),actions:['archive'],stop_processing:true},third={...value('Third'),actions:['trash']};
 assert.equal(evaluateRule(first,row).matched,true);
 assert.equal(evaluateRule({...first,exceptions:[{field:'from',operator:'starts_with',value:'mira@'}]},row).excluded,true);
 assert.equal(evaluateRule({...first,enabled:false},row).matched,false);
 assert.equal(evaluateRule({...first,conditions:[...first.conditions,{field:'folder',operator:'equals',value:'sent'}]},row).matched,false);
 assert.equal(evaluateRule({...first,match:'any',conditions:[...first.conditions,{field:'folder',operator:'equals',value:'sent'}]},row).matched,true);
 const preview=previewRules({account_id:s.account_id,rules:[rule(first),rule(second),rule(third)],loadedRows:[row]});
 assert.equal(preview.automatic_execution,false);assert.equal(preview.scope,'current_cached_page');
 assert.deepEqual(preview.review_targets[0].matches.map(item=>item.actions),[['star'],['archive'],[]]);
 assert.equal(preview.review_targets[0].matches[2].skipped,true);
 for(const changed of [{...first,actions:['send_message']},{...first,conditions:[]},{...first,conditions:Array(11).fill(first.conditions[0])},{...first,unexpected:true}])assert.throws(()=>validateRuleValue(changed));
});

test('preview requires explicit selection above25; foreign, duplicate, deleted and stale rule references are rejected',()=>{
 const s=scope(),rules=[rule(value())],rows=Array.from({length:26},()=>message(s.account_id));
 const preview=previewRules({account_id:s.account_id,rules,loadedRows:rows});assert.equal(preview.matched_count,26);assert.equal(preview.requires_selection,true);assert.equal(preview.review_targets.length,0);
 assert.equal(previewRules({account_id:s.account_id,rules,loadedRows:rows,selected_record_ids:rows.slice(0,25).map(row=>row.record_id)}).review_targets.length,25);
 for(const invalid of [[{...rows[0],account_id:randomUUID()}],[rows[0],rows[0]],[{...rows[0],deleted:true}]])assert.throws(()=>previewRules({account_id:s.account_id,rules,loadedRows:invalid}));
 assert.throws(()=>previewRules({account_id:s.account_id,rules:[{...rules[0],value:value('Changed')}],loadedRows:rows}));
});

test('CAS, exact original-request recovery, full-value preservation and per-install/owner/account isolation',async()=>{
 const s=scope(),rules=createRuleStore({store:memory()}),id=randomUUID(),create=options(s),saved=await rules.create(s,id,value(),create);
 assert.deepEqual(await rules.create(s,id,value(),create),saved);
 await assert.rejects(rules.create(s,id,value('Different'),create),error=>error.code==='EMAIL_RULE_CONFLICT');
 for(const key of ['org_id','owner_user_id','account_id','installation_id'])await assert.rejects(rules.read({...s,[key]:randomUUID()},id,async()=>{}),error=>error.code==='EMAIL_RULE_NOT_FOUND');
 await assert.rejects(rules.save(s,id,value(),options(s,{...cas(saved),user_id:randomUUID()})),error=>error.code==='EMAIL_RULE_ACCESS_DENIED');
 const changed={...saved.value,enabled:false,exceptions:[{field:'cc',operator:'equals',value:'private@example.test'}]},write=options(s,cas(saved));
 const next=await rules.save(s,id,changed,write);assert.deepEqual(next.value,changed);assert.equal(next.revision,2);
 await assert.rejects(rules.save(s,id,value(),options(s,cas(saved))),error=>error.code==='EMAIL_RULE_CONFLICT');
 assert.equal((await rules.receipt(s,id,write.request_id,async()=>{})).revision,2);
 const archived=await rules.archive(s,id,options(s,cas(next)));assert.equal(archived.status,'archived');assert.deepEqual((await rules.read(s,id,async()=>{})).value,changed);assert.equal((await rules.list(s,{},async()=>{})).items.length,0);
 await assert.rejects(rules.save(s,id,value(),options(s,cas(archived))),error=>error.code==='EMAIL_RULE_CONFLICT');
});

test('ordered pagination rejects edits and reorders mid-page; reorder validates entire current set and recovers exact receipt',async()=>{
 const s=scope(),rules=createRuleStore({store:memory()}),rows=[];
 for(let i=0;i<3;i++)rows.push(await rules.create(s,randomUUID(),value('Rule '+i),options(s)));
 const first=await rules.list(s,{limit:1},async()=>{}),request=options(s),ordered=[rows[2],rows[0],rows[1]];
 await assert.rejects(rules.reorder(s,ordered.slice(0,2).map(ref),first.order_digest,options(s)),error=>error.code==='EMAIL_RULE_CONFLICT');
 const receipt=await rules.reorder(s,ordered.map(ref),first.order_digest,request);
 assert.deepEqual(await rules.reorder(s,ordered.map(ref),first.order_digest,request),receipt);
 assert.deepEqual((await rules.list(s,{},async()=>{})).items.map(row=>row.record_id),ordered.map(row=>row.record_id));
 await assert.rejects(rules.list(s,{cursor:first.next_cursor,limit:1},async()=>{}),error=>error.code==='EMAIL_RULE_CONFLICT');
 const second=await rules.list(s,{limit:1},async()=>{});await rules.save(s,rows[0].record_id,value('Changed'),options(s,cas(rows[0])));
 await assert.rejects(rules.list(s,{cursor:second.next_cursor,limit:1},async()=>{}),error=>error.code==='EMAIL_RULE_CONFLICT');
});

test('100 active-rule cap is serialized, archival frees a slot, and revoked post-CAS response is recoverable without duplicate mutation',async()=>{
 const s=scope(),rules=createRuleStore({store:memory()}),rows=[];
 for(let i=0;i<99;i++)rows.push(await rules.create(s,randomUUID(),value('Rule '+i),options(s)));
 const raced=await Promise.allSettled([0,1].map(i=>rules.create(s,randomUUID(),value('Race '+i),options(s))));assert.equal(raced.filter(row=>row.status==='fulfilled').length,1);
 await rules.archive(s,rows[0].record_id,options(s,cas(rows[0])));assert.equal((await rules.create(s,randomUUID(),value('New'),options(s))).revision,1);
 const separate=scope(),id=randomUUID();let calls=0;const write=options(separate,{check:async()=>{if(++calls===4)throw Error('revoked');}});
 await assert.rejects(rules.create(separate,id,value(),write),/revoked/);assert.equal((await rules.receipt(separate,id,write.request_id,async()=>{})).revision,1);
 await assert.rejects(rules.read(separate,id,async()=>{throw Error('revoked');}),/revoked/);
});

test('actual encrypted durable store reopens rule IDs, full values, order and request receipts without provider IO',async()=>{
 const root=await mkdtemp(join(tmpdir(),'deft-rule-restart-')),encryption_key=randomBytes(32),config={root,encryption_key,key_id:'rule_fixture',allow_windows_fixture:process.platform==='win32'},s=scope();
 let store=await createDurableStore(config),rules=createRuleStore({store});const request=options(s),first=await rules.create(s,randomUUID(),value('Synthetic private rule nonce '+randomUUID()),request),second=await rules.create(s,randomUUID(),value('Second'),options(s));
 const before=await rules.list(s,{},async()=>{}),reorder=options(s);await rules.reorder(s,[ref(second),ref(first)],before.order_digest,reorder);await store.close();
 for(const file of await readdir(root))if(file.endsWith('.json'))assert.equal((await readFile(join(root,file),'utf8')).includes(first.value.name),false);
 store=await createDurableStore(config);try{rules=createRuleStore({store});assert.deepEqual((await rules.read(s,first.record_id,async()=>{})).value,first.value);assert.deepEqual((await rules.list(s,{},async()=>{})).items.map(row=>row.record_id),[second.record_id,first.record_id]);assert.equal((await rules.receipt(s,first.record_id,request.request_id,async()=>{})).revision,1);assert.ok(await rules.receipt(s,null,reorder.request_id,async()=>{}));}finally{await store.close();encryption_key.fill(0);}
});
