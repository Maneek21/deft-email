import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {fixture,profile} from './connection-form-test-support.mjs';
import {createImapReadPorts} from './imap-runtime-ports.mjs';
import {createMailboxStore} from './mailbox-store.mjs';
import {currentImapOwnedSource} from './imap-owned-source.mjs';
import {dataFixtureMessage} from './test-support.mjs';

test('frozen native IMAP full-folder page/query/EML/CID/file run through app-owned custody; generation2 preserves UUID/source and requires current nomination',async()=>{
 const f=await fixture(),mime=dataFixtureMessage().mime;let connections=0,validity=1,revoked=false;
 const client=()=>({authenticated:true,secureConnection:true,enabled:new Set(),mailbox:null,async list(){return [{path:'INBOX',flags:new Set(),specialUse:''}];},async getMailboxLock(path,{readOnly}){this.mailbox={path,readOnly,uidValidity:validity,uidNext:2,exists:1};return {release(){}};},async search(){return [1];},async *fetch(){yield {uid:1,size:mime.length,flags:new Set(),internalDate:new Date('2024-01-01'),envelope:{subject:'Native IMAP',from:[{address:'sender@example.test'}],to:[{address:'owner@example.test'}],messageId:'<first-source@example.test>'},headers:Buffer.from('Message-ID: <first-source@example.test>\r\n')};},async fetchOne(uid){return {uid,size:mime.length};},async download(){return {meta:{expectedSize:mime.length},content:Readable.from([Buffer.from(mime)])};},close(){}});
 try{const first=await f.connect(),check=async()=>{if(revoked)throw Object.assign(new Error('denied'),{code:'EMAIL_FORM_AUTHORITY_DENIED'});},connector={imap:async(_profile,context,work)=>{connections++;await context.check();const value=await work(client());await context.check();return value;}};
 const owned={org_id:f.scope.org_id,owner_user_id:f.scope.owner_user_id,account_id:first.connected.account.account_ref},mailbox=createMailboxStore({store:f.store}),context={org_id:f.scope.org_id,owner_user_id:f.scope.owner_user_id,installation_id:f.scope.installation_id,resource_binding_id:f.scope.resource_binding_id,account_id:owned.account_id,authority_version:'fixture',expires_at:Date.now()+29000,recheck:check,provider_state:await mailbox.providerState(owned,check),owner_capabilities:['read']};
 let {bridge}=createImapReadPorts({forms:f.forms,connector,session_id:f.request.session_id,scope:f.scope,check});
 const page=await bridge.nativeEmailPage({cursor:null,limit:25},context);assert.equal(page.items.length,1);assert(page.state_updates.length);await mailbox.commit(owned,page,check);const list=await mailbox.list(owned,{limit:25},check),record=await mailbox.get(owned,list.items[0].record_id,check);const originalSource=structuredClone(record.provider_source);
 const search=await bridge.nativeEmailSearch({cursor:null,limit:25,query:'subject:Native'},context);assert.equal(search.status,'supported');assert.equal(search.items[0].logical_message_id,record.logical_message_id);
 const unsupported=await bridge.nativeEmailSearch({cursor:null,limit:25,query:'in:unsupported'},context);assert.equal(unsupported.status,'unsupported');
 const source=await bridge.nativeEmailSource({source:record.provider_source},context);assert.deepEqual(Buffer.from(source.mime_bytes),mime);
 const presentation=await bridge.nativeEmailPresentation({source:record.provider_source},context);assert(presentation.presentation.content.includes('Native first body'));assert.equal(presentation.files.length,2);
 const received=await bridge.nativeEmailFile({source:record.provider_source,source_digest:source.digest,file_ref:presentation.files.find(row=>row.filename==='received.txt').file_ref},context);assert.deepEqual(Buffer.from(received.bytes),dataFixtureMessage().attachment);
 const inline=await bridge.nativeEmailImage({source:record.provider_source,source_digest:source.digest,image_ref:presentation.presentation.images.find(row=>row.kind==='cid').image_ref},context);assert.deepEqual(Buffer.from(inline.bytes),dataFixtureMessage().png);
 const sourcePin={session_id:f.request.session_id,session_revision:1,scope:f.scope,runtime_session_ref:first.connected.runtime_session_ref,account_ref:owned.account_id},next={...f.fresh(),session_id:randomUUID(),source:sourcePin},begun=await f.forms.request(next),browser=await f.forms.exchange(new URL(begun.setup_url).hash.slice(1));const rotated=profile();rotated.imap.password='ROTATED_IMAP_FIXTURE';const second=await f.forms.submit({...browser,value:rotated});assert.equal(second.account.account_ref,owned.account_id);
 ({bridge}=createImapReadPorts({forms:f.forms,connector,session_id:next.session_id,scope:f.scope,check}));
 await assert.rejects(bridge.nativeEmailSource({source:originalSource},context),{code:'EMAIL_CONNECTION_RESOURCE_DENIED'});const nominated=await currentImapOwnedSource({forms:f.forms,session_id:next.session_id,scope:f.scope,record,check});assert.equal(nominated.authority_epoch,2);assert.deepEqual((await mailbox.get(owned,record.record_id,check)).provider_source,originalSource);assert.deepEqual(Buffer.from((await bridge.nativeEmailSource({source:nominated},context)).mime_bytes),mime);
 validity=2;await assert.rejects(bridge.nativeEmailSource({source:nominated},context),{code:'EMAIL_NATIVE_SOURCE_STALE'});validity=1;const before=connections;revoked=true;await assert.rejects(bridge.nativeEmailSource({source:nominated},context));assert.equal(connections,before);
 }finally{await f.close();}
});
