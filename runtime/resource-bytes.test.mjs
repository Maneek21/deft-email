import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readResourceBytes} from './resource-bytes.mjs';
import {inspectEmailSourceFiles} from './vendor/providers/incoming-source-files.mjs';
import {dataFixtureMessage} from './test-support.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(){
  const value=dataFixtureMessage(),catalog=await inspectEmailSourceFiles(value.mime,{profile:'native',presentation:true});
  let calls=0,lastSource;const context={account_id:'synthetic-account',signal:new AbortController().signal},provider_source={provider:'gmail'};
  const read=overrides=>readResourceBytes({bridge:{async nativeEmailSource(){calls++;lastSource=Buffer.from(value.mime);return {account_id:context.account_id,provider:'gmail',digest:sha(lastSource),mime_bytes:lastSource};}},provider_source,context,check:async()=>{},...overrides});
  return {value,catalog,context,provider_source,read,get calls(){return calls;},get lastSource(){return lastSource;}};
}
test('one exact MIME read yields frozen file and CID bytes; consumed MIME is cleared',async()=>{
 const f=await fixture(),file=f.catalog.files.find(row=>row.filename==='received.txt'),image=f.catalog.presentation.images.find(row=>row.kind==='cid');
 const result=await f.read({operation:'resource_read_file',input:{file_ref:'sha256:'+file.file_ref}});assert.equal(f.calls,1);assert.deepEqual(Buffer.from(result.bytes),f.value.attachment);assert.equal(result.filename,'received.txt');assert.ok(f.lastSource.every(byte=>byte===0));
 const cid=await f.read({operation:'resource_read_image',input:{image_ref:'sha256:'+image.image_ref,external_images:'blocked'}});assert.equal(f.calls,2);assert.deepEqual(Buffer.from(cid.bytes),f.value.png);assert.ok(f.lastSource.every(byte=>byte===0));
});
test('old digest-derived part ref refuses changed MIME despite unchanged locator nomination',async()=>{
 const f=await fixture(),file=f.catalog.files[0],changed=Buffer.concat([f.value.mime,Buffer.from('\r\nchanged')]);
 await assert.rejects(f.read({operation:'resource_read_file',input:{file_ref:'sha256:'+file.file_ref},bridge:{async nativeEmailSource(){return {account_id:f.context.account_id,provider:'gmail',digest:sha(changed),mime_bytes:changed};}}}));assert.ok(changed.every(byte=>byte===0));
});
test('foreign account/provider and tampered MIME digest deny and clear source without bytes',async()=>{
 for(const override of [{account_id:'foreign'},{provider:'microsoft'},{digest:'0'.repeat(64)}]){
  const f=await fixture(),bytes=Buffer.from(f.value.mime);await assert.rejects(f.read({operation:'resource_read_file',input:{file_ref:'sha256:'+f.catalog.files[0].file_ref},bridge:{async nativeEmailSource(){return {account_id:f.context.account_id,provider:'gmail',digest:sha(bytes),mime_bytes:bytes,...override};}}}),error=>error.code==='EMAIL_DATA_SOURCE_CHANGED');assert.ok(bytes.every(byte=>byte===0));
 }
});
test('blocked remote nomination causes zero DNS/image requests',async()=>{
 const f=await fixture(),image=f.catalog.presentation.images.find(row=>row.kind==='remote');let calls=0;
 await assert.rejects(f.read({operation:'resource_read_image',input:{image_ref:'sha256:'+image.image_ref,external_images:'blocked'},imageDependencies:{lookup(){calls++;throw Error();},request(){calls++;throw Error();}}}),error=>error.code==='EMAIL_DATA_IMAGE_DENIED');assert.equal(calls,0);assert.equal(f.calls,1);assert.ok(f.lastSource.every(byte=>byte===0));
});
test('allowed remote image uses current checks before DNS/network and each redirect',async()=>{
 const f=await fixture(),image=f.catalog.presentation.images.find(row=>row.kind==='remote'),events=[];let requests=0;
 const result=await f.read({operation:'resource_read_image',input:{image_ref:'sha256:'+image.image_ref,external_images:'allowed'},check:async()=>events.push('current'),imageDependencies:{async lookup(){assert.equal(events.at(-1),'current');events.push('dns');return [{address:'8.8.8.8',family:4}];},async request(url,address,signal){assert.equal(events.at(-1),'current');assert.ok(signal instanceof AbortSignal);assert.equal(address.address,'8.8.8.8');events.push('network');return ++requests===1?{redirect:'https://other.example.test/image.png'}:{bytes:Buffer.from(f.value.png),media_type:'image/png'};}}});
 assert.equal(f.calls,1);assert.equal(requests,2);assert.equal(events.filter(value=>value==='dns').length,2);assert.deepEqual(Buffer.from(result.bytes),f.value.png);
});
test('revocation after first redirect prevents second DNS/network',async()=>{
 const f=await fixture(),image=f.catalog.presentation.images.find(row=>row.kind==='remote');let allowed=true,dns=0,network=0;
 await assert.rejects(f.read({operation:'resource_read_image',input:{image_ref:'sha256:'+image.image_ref,external_images:'allowed'},check:async()=>{if(!allowed)throw Error('synthetic revoked');},imageDependencies:{async lookup(){dns++;return [{address:'8.8.8.8',family:4}];},async request(){network++;allowed=false;return {redirect:'https://other.example.test/image.png'};}}}));assert.equal(dns,1);assert.equal(network,1);assert.ok(f.lastSource.every(byte=>byte===0));
});
test('late remote authority denial clears returned image buffer and MIME',async()=>{
 const f=await fixture(),image=f.catalog.presentation.images.find(row=>row.kind==='remote'),bytes=Buffer.from(f.value.png);let allowed=true;
 await assert.rejects(f.read({operation:'resource_read_image',input:{image_ref:'sha256:'+image.image_ref,external_images:'allowed'},check:async()=>{if(!allowed)throw Error('synthetic late denial');},imageDependencies:{async lookup(){return [{address:'8.8.8.8',family:4}];},async request(){allowed=false;return {bytes,media_type:'image/png'};}}}));assert.ok(bytes.every(byte=>byte===0));assert.ok(f.lastSource.every(byte=>byte===0));
});
test('expiry/abort before MIME extraction returns no binary and clears source',async()=>{
 const f=await fixture(),controller=new AbortController();controller.abort();
 await assert.rejects(f.read({operation:'resource_read_file',input:{file_ref:'sha256:'+f.catalog.files[0].file_ref},context:{...f.context,signal:controller.signal},check:async()=>controller.signal.throwIfAborted()}));assert.ok(f.lastSource.every(byte=>byte===0));
});
test('source and decoded native file budgets refuse oversize without returning bytes',async()=>{
 const f=await fixture();
 for(const kind of ['source','decoded']){
  const bytes=kind==='source'?Buffer.alloc(35*1024*1024+1,1):Buffer.concat([Buffer.from('MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=bounded\r\n\r\n--bounded\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="oversize.bin"\r\n\r\n'),Buffer.alloc(25*1024*1024+1,0x61),Buffer.from('\r\n--bounded--\r\n')]);
  const digest=sha(bytes);await assert.rejects(f.read({operation:'resource_read_file',input:{file_ref:'sha256:'+sha(Buffer.from(digest+':file:0'))},bridge:{async nativeEmailSource(){return {account_id:f.context.account_id,provider:'gmail',digest,mime_bytes:bytes};}}}));assert.ok(bytes.every(byte=>byte===0));
 }
});
test('the native 32 part catalog does not permit selecting an omitted 33rd file',async()=>{
 const f=await fixture(),parts=Array.from({length:33},(_,index)=>'--bounded\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="part-'+index+'.bin"\r\n\r\ncontent\r\n').join(''),bytes=Buffer.from('MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=bounded\r\n\r\n'+parts+'--bounded--\r\n'),digest=sha(bytes);
 await assert.rejects(f.read({operation:'resource_read_file',input:{file_ref:'sha256:'+sha(Buffer.from(digest+':file:32'))},bridge:{async nativeEmailSource(){return {account_id:f.context.account_id,provider:'gmail',digest,mime_bytes:bytes};}}}));assert.ok(bytes.every(byte=>byte===0));
});
test('remote DNS private addresses deny before image network despite explicit permission',async()=>{
 const f=await fixture(),image=f.catalog.presentation.images.find(row=>row.kind==='remote');let network=0;
 await assert.rejects(f.read({operation:'resource_read_image',input:{image_ref:'sha256:'+image.image_ref,external_images:'allowed'},imageDependencies:{async lookup(){return [{address:'127.0.0.1',family:4}];},async request(){network++;throw Error();}}}));assert.equal(network,0);assert.ok(f.lastSource.every(byte=>byte===0));
});
