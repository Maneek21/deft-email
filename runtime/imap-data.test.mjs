import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {fixture} from './connection-form-test-support.mjs';
import {createDataRuntime} from './data-runtime.mjs';
import {registrationFor,dataFixtureMessage} from './test-support.mjs';

test('actual public data contract reuses form custody for refresh/search/EML/files/CID and native-sized draft CAS without OAuth',{timeout:30000},async()=>{
 const f=await fixture(),mime=dataFixtureMessage().mime;let calls=0,allowed=true;
 const connector={imap:async(_profile,context,work)=>{calls++;await context.check();const client={authenticated:true,secureConnection:true,enabled:new Set(),mailbox:null,async list(){return [{path:'INBOX',flags:new Set(),specialUse:''}];},async getMailboxLock(path,{readOnly}){this.mailbox={path,readOnly,uidValidity:1,uidNext:2,exists:1};return {release(){}};},async search(){return [1];},async *fetch(){yield {uid:1,size:mime.length,flags:new Set(),internalDate:new Date('2024-01-01'),envelope:{subject:'Native IMAP',from:[{address:'sender@example.test'}],to:[{address:'owner@example.test'}],messageId:'<first-source@example.test>'},headers:Buffer.from('Message-ID: <first-source@example.test>\r\n')};},async fetchOne(uid){return {uid,size:mime.length};},async download(){return {meta:{expectedSize:mime.length},content:Readable.from([Buffer.from(mime)])};},close(){}};const result=await work(client);await context.check();return result;}};
 try{const {connected}=await f.connect(),runtime=createDataRuntime({registrations:[{...registrationFor(f.scope),connection_protocol:'credential_form.v1'}],provider:'imap_smtp',forms:f.forms,imapConnector:connector,store:f.store,encryption_key:f.encryption_key,key_id:'fixture',assertCurrent:async value=>{if(!allowed)throw Object.assign(new Error('denied'),{code:'EMAIL_DATA_AUTHORITY_DENIED'});return {...value,allowed:true};}});
 const request=(operation,input)=>({schema_version:'deft.app_data_runtime.v1',request_id:randomUUID(),scope:f.scope,connection:{session_id:f.request.session_id,session_revision:5,runtime_session_ref:connected.runtime_session_ref,account_ref:connected.account.account_ref},authority:{consent_id:randomUUID(),consent_digest:'sha256:'+'d'.repeat(64),data_policy_digest:'sha256:'+'e'.repeat(64)},operation,expires_at:new Date(Date.now()+29000).toISOString(),input});
 const run=(operation,input)=>runtime.request(request(operation,input));
 const metadata=await run('connection_metadata',{store_key:'drafts'});assert.deepEqual(metadata.identities,[{address:'owner@example.test',label:'Owner declared address'}]);assert.equal(calls,0);
 await run('resource_refresh',{store_key:'drafts',resource_key:'inbox'});const list=await run('resource_list',{store_key:'drafts',resource_key:'inbox',cursor:null,limit:25});assert.equal(list.items.length,1);const item=list.items[0],ref={store_key:'drafts',resource_key:'inbox',record_id:item.record_id,content_digest:item.content_digest};
 const search=await run('resource_list',{store_key:'drafts',resource_key:'inbox',cursor:null,limit:25,query:'subject:Native'});assert.equal(search.search.status,'supported');assert.equal(search.items[0].record_id,item.record_id);
 const source=await run('resource_read_source',ref);assert.deepEqual(Buffer.from(source.bytes),mime);
 const presentation=await run('resource_read_presentation',ref);assert(presentation.presentation.content.includes('Native first body'));assert.equal(presentation.files.length,2);
 const file=presentation.files.find(row=>row.filename==='received.txt'),read=await run('resource_read_file',{...ref,file_ref:file.file_ref});assert.deepEqual(Buffer.from(read.bytes),dataFixtureMessage().attachment);
 const cid=presentation.presentation.images.find(row=>row.kind==='cid'),image=await run('resource_read_image',{...ref,image_ref:cid.image_ref,external_images:'blocked'});assert.deepEqual(Buffer.from(image.bytes),dataFixtureMessage().png);
 const empty={mode:'compose',to:'recipient@example.test',cc:'',bcc:'',subject:'UNSENT IMAP fixture',body:'x'.repeat(200000),body_html:'<p>'+'x'.repeat(200000)+'</p>',reply_record_id:'',attachments:[]},draftID=randomUUID(),created=await run('record_create',{store_key:'drafts',record_id:draftID,value:empty});assert.equal(created.record.value.body.length,200000);const saved=await run('record_save',{store_key:'drafts',record_id:draftID,expected_revision:created.record.revision,expected_content_digest:created.record.content_digest,value:{...empty,subject:'UNSENT saved'}});assert.equal(saved.record.revision,2);
 const foreign=request('record_read',{store_key:'drafts',record_id:draftID});foreign.connection.account_ref=randomUUID();const before=calls;await assert.rejects(runtime.request(foreign),{code:'EMAIL_IMAP_ACCESS_DENIED'});assert.equal(calls,before);
 allowed=false;await assert.rejects(run('resource_read_source',ref));assert.equal(calls,before);
 }finally{await f.close();}
});
