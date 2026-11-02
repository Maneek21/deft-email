import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readResourceBytes} from './resource-bytes.mjs';
import {createSourceSnapshotCache} from './source-snapshot-cache.mjs';
import {inspectEmailSourceFiles} from './vendor/providers/incoming-source-files.mjs';

// Simulated provider delay. The row is fixture-based; the provider-fetch count
// is exact and is the real gate.
const PROVIDER_DELAY_MS=Number(process.env.ATTACH_PROVIDER_DELAY_MS??300);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const locators={gmail:{kind:'gmail',message_id:'synthetic-message'},microsoft:{kind:'microsoft',message_id:'synthetic-message',id_type:'immutable'},imap_smtp:{kind:'imap_smtp',mailbox:'INBOX',uidvalidity:'1',uid:1}};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const parts=count=>Array.from({length:count},(_,index)=>'--bounded\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="part-'+index+'.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\n'+Buffer.from('exact attachment '+index).toString('base64')+'\r\n').join('');
const mime=Buffer.from('From: sender@example.test\r\nTo: owner@example.test\r\nSubject: Attachment latency\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=bounded\r\n\r\n--bounded\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Body</p>\r\n'+parts(8)+'--bounded--\r\n');
const catalog=await inspectEmailSourceFiles(mime,{profile:'native',presentation:true});
const files=catalog.files.filter(row=>row.filename.startsWith('part-'));

function fixture(provider,providerDelayMs=PROVIDER_DELAY_MS){
 const counts={source:0,conversation:0},cache=createSourceSnapshotCache();
 const bridge={
  async nativeEmailSource(){counts.source++;if(providerDelayMs)await delay(providerDelayMs);return {account_id:'account',provider,digest:sha(mime),mime_bytes:Buffer.from(mime)};},
  async nativeEmailConversation(){counts.conversation++;return {account_id:'account',provider:'gmail',anchor_logical_message_id:'logical'};},
 };
 const provider_source={schema_version:'deft.email_provider_source.v1',account_id:'account',provider,logical_message_id:'logical',locator:locators[provider]};
 const context={account_id:'account',signal:new AbortController().signal},key=sha(Buffer.from('one-record-revision'));
 const read=file=>readResourceBytes({bridge,provider_source,input:{file_ref:'sha256:'+file.file_ref},operation:'resource_read_file',context,check:async()=>{},sourceCache:cache,sourceCacheKey:key});
 return {counts,cache,key,provider_source,bridge,context,read};
}

test('eight attachments with a '+PROVIDER_DELAY_MS+' ms provider delay fetch the source once',async()=>{
 for(const provider of ['gmail','microsoft','imap_smtp']){
  const single=fixture(provider);let started=performance.now();await single.read(files[0]);const singleMs=performance.now()-started;
  const bulk=fixture(provider);started=performance.now();
  for(const file of files)assert.deepEqual(Buffer.from((await bulk.read(file)).bytes),Buffer.from('exact attachment '+Number(/part-(\d+)/u.exec(file.filename)[1])));
  const bulkMs=performance.now()-started;
  assert.equal(bulk.counts.source,1,'8 files use one provider fetch for '+provider);
  assert.ok(bulkMs<singleMs*2,'8 files finish under twice one fetch: '+Math.round(bulkMs)+' ms vs '+Math.round(singleMs)+' ms for '+provider);
 }
});

test('a 900 ms provider delay still serves the cached parts within a bounded time',async()=>{
 const f=fixture('microsoft',900);let started=performance.now();await f.read(files[0]);const singleMs=performance.now()-started;
 started=performance.now();
 for(const file of files.slice(1))await f.read(file);
 const hitMs=performance.now()-started;
 assert.equal(f.counts.source,1);
 assert.ok(hitMs<singleMs*2,'seven cached parts stay under twice a 900 ms fetch: '+Math.round(hitMs)+' ms vs '+Math.round(singleMs)+' ms');
});
