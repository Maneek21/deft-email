import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import nodemailer from 'nodemailer';
import {fixture,profile} from './connection-form-test-support.mjs';
import {createImapConnector} from './imap-connector.mjs';
import {createSmtpCompoundSend} from './smtp-compound.mjs';
import {protocolServer,ca} from './imap-tls-fixture.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
test('genuine strictTLS and requiredSTARTTLS SMTP AUTH sends immutable MIME once; acknowledgment loss never repeats DATA',{timeout:30000},async()=>{
 for(const mode of ['tls','starttls','lost_ack']){const smtp=await protocolServer({protocol:'smtp',starttls:mode==='starttls',dropDataAck:mode==='lost_ack'}),f=await fixture();try{
  const binding=randomUUID();f.request.action_consents=[{action_binding_id:binding,action_key:'send_message',authority_epoch:1,consent_id:binding,consent_digest:'sha256:'+'1'.repeat(64),expires_at:f.scope.consent_expires_at}];
  const input=profile();input.smtp={...input.imap,host:'smtp.example.test',port:mode==='starttls'?587:465,transport:mode==='starttls'?'starttls_required':'implicit_tls'};const {connected}=await f.connect(input),connection={session_id:f.request.session_id,runtime_session_ref:connected.runtime_session_ref,account_ref:connected.account.account_ref};
  const connector=createImapConnector({ImapFlow:class{},lookup:async()=>[{address:'93.184.216.34',family:4}],createTransport:options=>nodemailer.createTransport({...options,host:'127.0.0.1',port:smtp.port,tls:{...options.tls,ca}})}),service=createSmtpCompoundSend({forms:f.forms,store:f.store,connector});
  const bytes=Buffer.from('From: owner@example.test\r\nTo: recipient@example.test\r\nMessage-ID: <actual-tls-fixture@example.test>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nExact synthetic SMTP ✓\r\n'),args={connection,scope:f.scope,action_binding_id:binding,mime_bytes:bytes,mime_digest:sha(bytes),mode:'server_managed',check:async()=>{},signal:AbortSignal.timeout(10000),expires_at:Date.now()+10000};
  const copy_plan=await service.prepare(args),request={...args,copy_plan,operation_id:randomUUID(),attempt_id:randomUUID(),snapshot_digest:'sha256:'+'2'.repeat(64),from_address:'owner@example.test',envelope:{from:'owner@example.test',to:['recipient@example.test']}};
  const receipt=await service.execute(request);assert.equal(receipt.transport_outcome,mode==='lost_ack'?'unknown':'accepted');assert.deepEqual(await service.execute(request),receipt);assert.equal(smtp.counters.data,1);assert.equal(smtp.counters.auth,1);assert.equal(smtp.counters.plaintext_auth,0);assert.equal(smtp.messages.length,1);assert.equal(sha(smtp.messages[0]),sha(bytes));
 }finally{await f.close();await smtp.close();}}
});
