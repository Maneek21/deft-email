import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {createNativeImapReaderBridge} from './vendor/providers/native-imap-reader.mjs';
import {providerSourceForParent} from './vendor/providers/provider-browser.mjs';
import {LogicalMailIndex} from './vendor/logical-mail-index.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const scope={org_id:'synthetic-org',owner_id:'synthetic-owner',installation_id:'synthetic-installation'};
const nativeScope={...scope};

function sourceFixture(){
 const account={account_id:'synthetic-account',provider:'imap_smtp',authority_epoch:1};
 const parent=new LogicalMailIndex(scope).upsert(scope,{account_id:account.account_id,provider:'imap_smtp',locator:{kind:'imap_smtp',mailbox:'INBOX',uidvalidity:'1',uid:7}});
 return {account:value=>({...account,...value}),source:providerSourceForParent(account,parent)};
}

function clientFixture(chunks){
 const chunksRead={count:0},client={authenticated:true,secureConnection:true,mailbox:null,closed:false,
  async getMailboxLock(){client.mailbox={path:'INBOX',readOnly:true,uidValidity:'1'};return {release(){}};},
  async fetchOne(uid){return {uid,size:chunks.reduce((total,chunk)=>total+chunk.length,0)};},
  async download(){return {meta:{expectedSize:chunks.reduce((total,chunk)=>total+chunk.length,0)},content:Readable.from((async function*(){for(const chunk of chunks){chunksRead.count++;yield chunk;}})())};},
  close(){client.closed=true;}};
 return {client,chunksRead};
}

function bridgeFor({source,account,chunks,onCheck,onHost=()=>{},signal,expires_at=Date.now()+29000}){
 const {client,chunksRead}=clientFixture(chunks);
 const host={async withAuthorizedClient(_context,_account,work){onHost();return work(client);}};
 const runtime=async()=>({check:onCheck,scope:nativeScope,account:account()});
 const bridge=createNativeImapReaderBridge({runtime,host,now:Date.now});
 return {bridge,client,chunksRead,context:{account_id:'synthetic-account',signal,expires_at,imap_aliases:{}},source};
}

const mime=Buffer.alloc(5*1024*1024,0x5a);Buffer.from('From: sender@example.test\r\nSubject: 5 MiB source\r\nMIME-Version: 1.0\r\nContent-Type: application/octet-stream\r\n\r\n').copy(mime);
const chunks=Array.from({length:80},(_,index)=>mime.subarray(index*65536,(index+1)*65536));

test('a 5 MiB IMAP source run reads host authority a bounded number of times, not per chunk',async()=>{
 const fixture=sourceFixture();let checks=0,streamChecks=0,streaming=false;
 const {bridge,client,chunksRead,context}=bridgeFor({...fixture,chunks,onCheck:async()=>{checks++;if(streaming)streamChecks++;}});
 const original=client.download.bind(client);
 client.download=async(...args)=>{streaming=true;const value=await original(...args),stream=value.content;value.content={destroy:stream.destroy.bind(stream),[Symbol.asyncIterator](){const iterator=stream[Symbol.asyncIterator]();return {async next(){const row=await iterator.next();if(row.done)streaming=false;return row;},return:iterator.return?.bind(iterator)};}};return value;};
 const result=await bridge.nativeEmailSource({source:fixture.source},context);
 assert.equal(result.byte_length,mime.length);
 assert.equal(result.digest,sha(mime));
 assert.equal(chunksRead.count,80);
 assert.ok(streamChecks<=2,'host authority during the byte stream is bounded: '+streamChecks+' checks for 80 chunks');
 assert.ok(checks<=10,'total authority reads stay constant: '+checks);
});

test('abort mid-stream stops at the next chunk boundary and returns no bytes',async()=>{
 const fixture=sourceFixture(),controller=new AbortController();let delivered=0;
 const {bridge,client,chunksRead,context}=bridgeFor({...fixture,chunks,onCheck:async()=>{},signal:controller.signal});
 const original=client.download.bind(client);
 client.download=async(...args)=>{const value=await original(...args),stream=value.content;value.content={destroy:stream.destroy.bind(stream),[Symbol.asyncIterator](){const iterator=stream[Symbol.asyncIterator]();return {async next(){const row=await iterator.next();delivered++;if(delivered===10)controller.abort(new Error('synthetic stop'));return row;},return:iterator.return?.bind(iterator)};}};return value;};
 await assert.rejects(bridge.nativeEmailSource({source:fixture.source},context),error=>error.code==='EMAIL_SOURCE_ABORTED');
 assert.ok(delivered<80,'the stream stops at the next chunk boundary');assert.equal(client.closed,true);
 assert.ok(chunksRead.count<80);
});

test('an already-expired context fails before any provider byte is returned',async()=>{
 const fixture=sourceFixture();
 const {bridge,chunksRead,context}=bridgeFor({...fixture,chunks,onCheck:async()=>{},expires_at:Date.now()-1});
 await assert.rejects(bridge.nativeEmailSource({source:fixture.source},context),error=>error.code==='EMAIL_SOURCE_ABORTED');
 assert.equal(chunksRead.count,0);
});
