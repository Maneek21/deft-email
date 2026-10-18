import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceSnapshotCache} from './source-snapshot-cache.mjs';
import {createReadSessionSnapshot} from './read-session-snapshot.mjs';
import {readResourceBytes} from './resource-bytes.mjs';
import {inspectEmailSourceFiles} from './vendor/providers/incoming-source-files.mjs';
import {dataFixtureMessage} from './test-support.mjs';
import {createHash} from 'node:crypto';
const key='a'.repeat(64),other='b'.repeat(64),source=()=>({mime_bytes:Buffer.from('private MIME'),digest:'source'}),check=async()=>{},validateHit=async()=>{};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

test('source cache joins pending exact data, rechecks each consumer, and returns isolated copies',async()=>{
 const cache=createSourceSnapshotCache(),gate=deferred();let loads=0,checks=0,existence=0;
 const read=()=>cache.read({key,load:async()=>{loads++;await gate.promise;return source();},check:async()=>{checks++;},validateHit:async()=>{existence++;}});
 const a=read(),b=read();gate.resolve();const [x,y]=await Promise.all([a,b]);
 assert.equal(loads,1);assert.equal(existence,1);assert.ok(checks>=5);x.mime_bytes.fill(0);assert.equal(y.mime_bytes.toString(),'private MIME');
 const z=await read();assert.equal(z.mime_bytes.toString(),'private MIME');assert.equal(existence,2);cache.close();
});
test('source cache bounds bytes/entries/fixed lifetime and never reuses a failed existence or authority check',async()=>{
 let now=0,loads=0,allowed=true;const cache=createSourceSnapshotCache({now:()=>now,maxEntries:1,maxBytes:20,ttl_ms:10});
 const read=(k=key,exists=validateHit)=>cache.read({key:k,load:async()=>{loads++;return source();},validateHit:exists,check:async()=>{assert.ok(allowed);}});
 await read();assert.equal(cache.bytes,12);now=9;await read();now=10;await read();assert.equal(loads,2);
 await read(other);assert.equal(cache.size,1);await read();assert.equal(loads,4);
 await assert.rejects(read(key,async()=>{throw Error('deleted');}),/deleted/);assert.equal(cache.size,0);
 await read();allowed=false;await assert.rejects(read());cache.close();assert.equal(cache.bytes,0);
 await assert.rejects(read());
});
test('canceling one pending waiter does not cancel the producer or disclose to the canceled caller',async()=>{
 const cache=createSourceSnapshotCache(),gate=deferred(),abort=new AbortController();let loads=0;
 const load=async()=>{loads++;await gate.promise;return source();};
 const owner=cache.read({key,load,check,validateHit});
 const peer=cache.read({key,load,check,validateHit,signal:abort.signal});await Promise.resolve();abort.abort(Error('peer canceled'));
 await assert.rejects(peer,/peer canceled/);gate.resolve();assert.equal((await owner).mime_bytes.toString(),'private MIME');assert.equal(loads,1);cache.close();
});
test('a canceled producer cannot poison an uncanceled waiter, which performs its own checked read',async()=>{
 const cache=createSourceSnapshotCache(),gate=deferred(),abort=new AbortController();let peerLoads=0;
 const owner=cache.read({key,load:async()=>{await gate.promise;return source();},check,validateHit,signal:abort.signal});
 const peer=cache.read({key,load:async()=>{peerLoads++;return source();},check,validateHit});
 await Promise.resolve();abort.abort(Error('owner canceled'));await assert.rejects(owner,/owner canceled/);gate.resolve();
 assert.equal((await peer).mime_bytes.toString(),'private MIME');assert.equal(peerLoads,1);cache.close();
});
test('session snapshots release the lock for network work and reject revised or same-revision changed rows before commit',async()=>{
 let held=false,row={revision:1,value:{state:'connected',account:'a'}};let writes=0;
 const snapshot=await createReadSessionSnapshot({check,withLock:async work=>{assert.equal(held,false);held=true;try{return await work({read:async()=>structuredClone(row)});}finally{held=false;}}});
 assert.equal(held,false);await snapshot.assertCurrent();await snapshot.withLocked(async()=>{await snapshot.assertCurrent();writes++;});assert.equal(writes,1);
 row.value.account='foreign';await assert.rejects(snapshot.withLocked(async()=>{writes++;}));assert.equal(writes,1);
 row={revision:2,value:{state:'connected',account:'a'}};await assert.rejects(snapshot.assertCurrent());
});
test('unsupported provider never reuses MIME with unchanged metadata; body change rejects old image nomination',async()=>{
 const message=dataFixtureMessage('fixture@example.test'),view=await inspectEmailSourceFiles(message.mime,{profile:'native',presentation:true});
 const image=view.presentation.images.find(x=>x.kind==='cid');let current=message.mime,loads=0;
 const cache=createSourceSnapshotCache(),bridge={async nativeEmailSource(){loads++;return {provider:'microsoft',account_id:'account',mime_bytes:Buffer.from(current),digest:createHash('sha256').update(current).digest('hex')};},async nativeEmailConversation(){throw Error('must not use immutable stamp');}};
 const read=()=>readResourceBytes({bridge,provider_source:{schema_version:'deft.email_provider_source.v1',provider:'microsoft',account_id:'account',logical_message_id:'same',locator:{kind:'gmail',message_id:'same'}},input:{image_ref:'sha256:'+image.image_ref,external_images:'blocked'},operation:'resource_read_image',context:{account_id:'account'},check,sourceCache:cache,sourceCacheKey:key});
 assert.deepEqual(Buffer.from((await read()).bytes),message.png);current=Buffer.concat([message.mime,Buffer.from('\r\nbody-only change')]);await assert.rejects(read());assert.equal(loads,2);assert.equal(cache.size,0);cache.close();
});
test('distinct scope/custody keys cannot join source data and close prevents pending disclosure',async()=>{
 const cache=createSourceSnapshotCache(),gate=deferred();let loads=0;
 const read=k=>cache.read({key:k,load:async()=>{loads++;await gate.promise;return source();},check,validateHit});
 const a=read(key),b=read(other);await Promise.resolve();cache.close();gate.resolve();await assert.rejects(a);await assert.rejects(b);assert.equal(loads,2);assert.equal(cache.size,0);
});
