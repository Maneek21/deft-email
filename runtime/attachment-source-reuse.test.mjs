import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readResourceBytes} from './resource-bytes.mjs';
import {createSourceSnapshotCache} from './source-snapshot-cache.mjs';
import {inspectEmailSourceFiles} from './vendor/providers/incoming-source-files.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const locators={gmail:{kind:'gmail',message_id:'synthetic-message'},microsoft:{kind:'microsoft',message_id:'synthetic-message',id_type:'immutable'},imap_smtp:{kind:'imap_smtp',mailbox:'INBOX',uidvalidity:'1',uid:1}};
const parts=count=>Array.from({length:count},(_,index)=>'--bounded\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="part-'+index+'.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\n'+Buffer.from('exact attachment '+index).toString('base64')+'\r\n').join('');
function syntheticMessage(count=8){
 const mime=Buffer.from('From: sender@example.test\r\nTo: owner@example.test\r\nSubject: Attachment source\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=bounded\r\n\r\n--bounded\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Body<img src="cid:inline-image"><img src="https://public.example.test/image.png"></p>\r\n--bounded\r\nContent-Type: image/png\r\nContent-ID: <inline-image>\r\nContent-Disposition: inline; filename="inline.png"\r\nContent-Transfer-Encoding: base64\r\n\r\niVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/wAAAABJRU5ErkJggg==\r\n'+parts(count)+'--bounded--\r\n');
 return {mime,images:[],attachments:Array.from({length:count},(_,index)=>Buffer.from('exact attachment '+index))};
}
async function fixture(provider,{ttl_ms=300000}={}){
 const message=syntheticMessage(),catalog=await inspectEmailSourceFiles(message.mime,{profile:'native',presentation:true}),counts={source:0,conversation:0};
 let now=1000;
 const cache=createSourceSnapshotCache({ttl_ms,now:()=>now});
 const bridge={
  async nativeEmailSource(){counts.source++;return {account_id:'account',provider,digest:sha(message.mime),mime_bytes:Buffer.from(message.mime)};},
  async nativeEmailConversation(){counts.conversation++;return {account_id:'account',provider:'gmail',anchor_logical_message_id:'logical'};},
 };
 const provider_source={schema_version:'deft.email_provider_source.v1',account_id:'account',provider,logical_message_id:'logical',locator:locators[provider]};
 const context={account_id:'account',signal:new AbortController().signal};
 const key=(seed='content-digest')=>sha(Buffer.from(seed));
 const read=(operation,ref,{key:selected=key(),check=async()=>{},imageDependencies}={})=>readResourceBytes({bridge,provider_source,input:operation==='resource_read_file'?{file_ref:'sha256:'+ref}:{image_ref:'sha256:'+ref,external_images:'allowed'},operation,context:{...context},...{check,imageDependencies},sourceCache:cache,sourceCacheKey:selected});
 return {message,catalog,cache,counts,read,key,advance:ms=>{now+=ms;},currentNow:()=>now};
}

for(const provider of ['gmail','microsoft','imap_smtp']){
 test('one provider source fetch serves eight attachment reads for '+provider,async()=>{
  const f=await fixture(provider);
  const files=f.catalog.files.filter(row=>row.filename.startsWith('part-'));assert.equal(files.length,8);
  for(const file of files)assert.deepEqual(Buffer.from((await f.read('resource_read_file',file.file_ref)).bytes),f.message.attachments[Number(/part-(\d+)/u.exec(file.filename)[1])]);
  assert.equal(f.counts.source,1,'every attachment of one message uses one provider source fetch');
  assert.equal(f.counts.conversation,provider==='gmail'?7:0,'only Gmail keeps its immutable-message provider check; other providers validate locally');
 });
}

test('inline images reuse the same message snapshot after the file list',async()=>{
 const f=await fixture('microsoft'),image=f.catalog.presentation.images.find(row=>row.kind==='cid');
 for(const file of f.catalog.files.slice(0,4))await f.read('resource_read_file',file.file_ref);
 assert.equal(f.counts.source,1);
 for(let index=0;index<4;index++)assert.deepEqual(Buffer.from((await f.read('resource_read_image',image.image_ref)).bytes),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/wAAAABJRU5ErkJggg==','base64'));
 assert.equal(f.counts.source,1,'four inline images after the files add no provider fetch');
});

test('record revision and explicit invalidation force a new source fetch',async()=>{
 const f=await fixture('microsoft',{ttl_ms:300000}),file=f.catalog.files[0];
 await f.read('resource_read_file',file.file_ref);
 await f.read('resource_read_file',file.file_ref);
 assert.equal(f.counts.source,1);
 await f.read('resource_read_file',file.file_ref,{key:f.key('revised-content-digest')});
 assert.equal(f.counts.source,2,'a changed record digest cannot join the old snapshot');
 f.cache.invalidate();
 await f.read('resource_read_file',file.file_ref);
 assert.equal(f.counts.source,3,'authority invalidation drops the snapshot');
});

test('expired snapshot is a miss and unchanged digest cannot cross a TTL',async()=>{
 const f=await fixture('imap_smtp',{ttl_ms:10}),file=f.catalog.files[0];
 await f.read('resource_read_file',file.file_ref);
 f.advance(10);
 await f.read('resource_read_file',file.file_ref);
 assert.equal(f.counts.source,2);
});

test('remote image bytes are zeroed when a late authority check fails',async()=>{
 const f=await fixture('imap_smtp'),remote=f.catalog.presentation.images.find(row=>row.kind==='remote'),bytes=Buffer.from('public image'),events=[];
 let allowed=true;
 await assert.rejects(f.read('resource_read_image',remote.image_ref,{check:async()=>{events.push('check');if(!allowed)throw Error('synthetic late denial');},imageDependencies:{async lookup(){return [{address:'8.8.8.8',family:4}];},async request(){allowed=false;return {bytes,media_type:'image/png'};}}}));
 assert.ok(events.length>1);assert.ok(bytes.every(byte=>byte===0),'decoded bytes are cleared before the error escapes');
});
