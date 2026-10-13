import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {fixture,profile} from './connection-form-test-support.mjs';
import {createSmtpCompoundSend} from './smtp-compound.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
async function setup(options={}){
 const f=await fixture(),binding=randomUUID();f.request.action_consents=[{action_binding_id:binding,action_key:'send_message',authority_epoch:1,consent_id:binding,consent_digest:'sha256:'+'1'.repeat(64),expires_at:f.scope.consent_expires_at}];
 const input=profile();input.smtp={...input.imap,host:'smtp.example.test',port:465};const {connected}=await f.connect(input);
 const connection={session_id:f.request.session_id,runtime_session_ref:connected.runtime_session_ref,account_ref:connected.account.account_ref},counters={smtp:0,append:0},bytes=Buffer.from('From: owner@example.test\r\nTo: recipient@example.test\r\nSubject: Synthetic immutable SMTP\r\nMessage-ID: <fixture-send@example.test>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain\r\n\r\n'+'x'.repeat(options.bytes??1024)+'\r\n');
 let live=true,validity='1',savedBytes=null;const check=async()=>{if(!live)throw Object.assign(new Error('denied'),{code:'EMAIL_SMTP_AUTHORITY_DENIED'});};
 const connector={smtp:async(_p,context,work)=>{await context.check();return work({sendMail:async packet=>{counters.smtp++;assert.equal(sha(packet.raw),sha(bytes));if(options.smtpUnknown)throw Error('uncertain');if(options.reject)throw Object.assign(Error('synthetic rejection'),{responseCode:550,command:'DATA'});return {accepted:packet.envelope.to,rejected:[],pending:[]};}});},
  imap:async(_p,context,work)=>{await context.check();const client={authenticated:true,secureConnection:true,capabilities:new Map(),mailbox:null,async list(){return [{path:'Sent',specialUse:'\\Sent',flags:new Set(['\\Sent'])}];},async getMailboxLock(path,{readOnly}){this.mailbox={path,readOnly,uidValidity:validity,uidNext:savedBytes?2:1};return {release(){}};},async append(path,data){counters.append++;assert.equal(sha(data),sha(bytes));savedBytes=Buffer.from(data);if(options.appendUnknown)throw Error('uncertain');return {path,uid:1,uidValidity:validity};},async search(){return savedBytes?[1]:[];},async fetchOne(uid){return {uid,size:savedBytes.length};},async download(){return {meta:{expectedSize:savedBytes.length},content:Readable.from([Buffer.from(savedBytes)])};},close(){}};return work(client);}};
 const make=()=>createSmtpCompoundSend({forms:f.forms,store:f.store,connector,onPhase:async(phase,details)=>{if(phase==='copy_unavailable')console.error(JSON.stringify({fixture_phase:phase,...details}));if(options.revokeAt===phase)live=false;if(options.changeValidityAt===phase)validity='2';}}),service=make(),args={connection,scope:f.scope,action_binding_id:binding,mime_bytes:bytes,mime_digest:sha(bytes),mode:options.mode??'server_managed',check,signal:AbortSignal.timeout(30000),expires_at:Date.now()+29000};
 const copy_plan=await service.prepare(args),execute={...args,copy_plan,operation_id:randomUUID(),attempt_id:randomUUID(),snapshot_digest:'sha256:'+'2'.repeat(64),from_address:'owner@example.test',envelope:{from:'owner@example.test',to:['recipient@example.test']}};
 return {f,service,args,execute,make,counters,check,get live(){return live;},close:()=>f.close()};
}
test('immutable server-managed and exact APPEND compound Send require only independent Send purpose; duplicate and reboot status never transmit again',async()=>{
 for(const mode of ['server_managed','append_exact']){const f=await setup({mode,bytes:mode==='append_exact'?2*1024*1024:1024});try{
  const receipt=await f.service.execute(f.execute);assert.equal(receipt.transport_outcome,'accepted');assert.equal(receipt.copy_outcome,mode==='server_managed'?'server_managed':'copied');assert.equal(receipt.automatic_retry,false);
  assert.deepEqual(await f.make().execute(f.execute),receipt);const status=await f.make().status({org_id:f.f.scope.org_id,owner_user_id:f.f.scope.owner_user_id,account_id:f.execute.connection.account_ref},f.execute.operation_id,f.check);assert.deepEqual(status,receipt);
  assert.equal(f.counters.smtp,1);assert.equal(f.counters.append,mode==='append_exact'?1:0);assert(!f.f.request.action_consents.some(row=>row.action_key==='organize_messages'));
 }finally{await f.close();}}
});
test('known SMTP rejection and uncertain SMTP never authorize APPEND; unknown survives restart with zero effect replay',async()=>{
 for(const reject of [true,false]){const f=await setup({mode:'append_exact',reject,smtpUnknown:!reject});try{const receipt=await f.service.execute(f.execute);assert.equal(receipt.transport_outcome,reject?'rejected':'unknown');assert.equal(receipt.copy_outcome,'not_attempted');assert.deepEqual(await f.make().execute(f.execute),receipt);assert.equal(f.counters.smtp,1);assert.equal(f.counters.append,0);}finally{await f.close();}}
});
test('lost APPEND acknowledgement and sealed UIDVALIDITY drift never append or resend on a second invocation',async()=>{
 for(const mode of ['ack','validity']){const f=await setup({mode:'append_exact',appendUnknown:mode==='ack',changeValidityAt:mode==='validity'?'smtp_accepted':undefined});try{const receipt=await f.service.execute(f.execute);assert.equal(receipt.transport_outcome,'accepted');assert(['unknown','not_attempted'].includes(receipt.copy_outcome));assert.deepEqual(await f.make().execute(f.execute),receipt);assert.equal(f.counters.smtp,1);assert.equal(f.counters.append,mode==='ack'?1:0);}finally{await f.close();}}
});
test('uncertain APPEND is resolved only by exact Message-ID and full-byte inspection under fresh read authority, without a second SMTP or APPEND',async()=>{
 const f=await setup({mode:'append_exact',appendUnknown:true});try{
  assert.equal((await f.service.execute(f.execute)).copy_outcome,'unknown');
  const inspected=await f.make().inspectCopy(f.execute);assert.equal(inspected.copy_outcome,'copied');assert.equal(inspected.transport_outcome,'accepted');assert.equal(f.counters.smtp,1);assert.equal(f.counters.append,1);
  assert.deepEqual(await f.make().execute(f.execute),inspected);
 }finally{await f.close();}
});
test('fresh revoke after SMTP acceptance denies copy/disclosure; tampered MIME/copy plan and wrong binding deny before effects',async()=>{
 const f=await setup({mode:'append_exact',revokeAt:'smtp_accepted'});try{await assert.rejects(f.service.execute(f.execute));assert.equal(f.counters.smtp,1);assert.equal(f.counters.append,0);}finally{await f.close();}
 const valid=await setup({mode:'append_exact'});try{for(const change of [{mime_digest:'a'.repeat(64)},{action_binding_id:randomUUID()},{copy_plan:{...valid.execute.copy_plan,declaration:{...valid.execute.copy_plan.declaration,destination:{mailbox:'Foreign',uidvalidity:'1'}}}}])await assert.rejects(valid.service.execute({...valid.execute,...change}));assert.equal(valid.counters.smtp,0);assert.equal(valid.counters.append,0);}finally{await valid.close();}
});
