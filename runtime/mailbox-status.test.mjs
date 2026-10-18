import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {readUnreadChunk,mailboxStatusRecord} from './mailbox-status.mjs';
const scope={org_id:randomUUID(),owner_user_id:randomUUID(),account_id:randomUUID()};
test('unread counts the whole coherent cache beyond loaded pages, reuses warm results and resets on generation change',async()=>{
 const rows=Array.from({length:601},(_,i)=>({scope,record_id:randomUUID(),flags:{seen:i%3===0},folders:[i%5===0?'sent':'INBOX'],deleted:i%7===0})),index={scope,ids:rows.map(r=>r.record_id),complete:true,content_generation:1};let progress,reads=0;
 const read=(extra={})=>readUnreadChunk({scope,index,progress,readRecord:async id=>{reads++;return rows.find(r=>r.record_id===id);},saveProgress:async p=>{progress=p;},check:async()=>{},...extra});
 const first=await read();assert.equal(first.count_ready,false);assert.equal(first.unread_count,null);assert.equal(reads,250);
 await read();const final=await read();assert.equal(final.count_ready,true);assert.equal(final.unread_count,rows.filter(r=>!r.deleted&&!r.flags.seen&&r.folders[0]==='INBOX').length);assert.equal(reads,601);
 assert.deepEqual(await read(),final);assert.equal(reads,601);
 index.content_generation++;rows[1].flags.seen=true;assert.equal((await read()).count_ready,false);assert.equal(reads,851);
});
test('partial coverage, hidden snoozes, corruption and current authority do not produce false exact totals',async()=>{
 const row={scope,record_id:randomUUID(),flags:{seen:false},folders:['inbox']},index={scope,ids:[row.record_id],complete:false};
 const args={scope,index,readRecord:async()=>row,saveProgress:async()=>{},check:async()=>{}};
 const partial=await readUnreadChunk(args);assert.equal(partial.cached_unread_count,1);assert.equal(partial.unread_count,null);
 assert.equal((await readUnreadChunk({...args,index:{...index,complete:true},hidden:[row.record_id]})).unread_count,0);
 await assert.rejects(readUnreadChunk({...args,check:async()=>{throw Error('revoked');}}),/revoked/);
 await assert.rejects(readUnreadChunk({...args,readRecord:async()=>({...row,scope:{...scope,account_id:randomUUID()}})}));
 const meta=mailboxStatusRecord(scope,partial);assert.equal(meta.summary.coverage_complete,false);assert.equal(Object.hasOwn(meta.summary,'unread_count'),false);
});
