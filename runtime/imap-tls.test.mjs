import test from 'node:test';
import assert from 'node:assert/strict';
import {ImapFlow} from 'imapflow';
import nodemailer from 'nodemailer';
import {createImapConnector} from './imap-connector.mjs';
import {protocolServer,ca} from './imap-tls-fixture.mjs';
import {profile} from './connection-form-test-support.mjs';
const context=()=>({signal:AbortSignal.timeout(10000),expires_at:Date.now()+10000,check:async()=>{}});
function connector(imap,smtp,{trust=true,hostname}={}){
 // Explicit local synthetic override: public-address policy still executes;
 // only the test constructors map that validated nomination to loopback.
 class LocalImap extends ImapFlow{constructor(options){super({...options,port:imap.port,tls:{...options.tls,...(trust?{ca}:{}),servername:hostname??options.host,lookup:(_host,options,done)=>options.all?done(null,[{address:'127.0.0.1',family:4}]):done(null,'127.0.0.1',4)}});}}
 return createImapConnector({ImapFlow:LocalImap,lookup:async()=>[{address:'93.184.216.34',family:4}],createTransport:options=>nodemailer.createTransport({...options,host:'127.0.0.1',port:smtp.port,tls:{...options.tls,...(trust?{ca}:{}),lookup:(_host,options,done)=>options.all?done(null,[{address:'127.0.0.1',family:4}]):done(null,'127.0.0.1',4)}})});
}
test('genuine IMAP strict TLS and required STARTTLS authenticate nominated login; SMTP verify emits no message effect',async()=>{
 for(const starttls of [false,true]){const imap=await protocolServer({starttls}),smtp=await protocolServer({protocol:'smtp',starttls});try{
  const value=profile();value.imap.transport=starttls?'starttls_required':'implicit_tls';value.imap.port=starttls?143:993;
  value.smtp={...value.imap,host:'smtp.example.test',port:starttls?587:465};await connector(imap,smtp).probe(value,context());
  assert.equal(imap.counters.auth,1);assert.equal(smtp.counters.auth,1);assert.equal(imap.counters.plaintext_auth,0);assert.equal(smtp.counters.plaintext_auth,0);assert.equal(smtp.counters.mail+smtp.counters.rcpt+smtp.counters.data,0);
  if(starttls)assert(imap.commands.find(x=>x.op==='STARTTLS'&&!x.secure));
 }finally{await imap.close();await smtp.close();}}
});
test('genuine certificate chain/hostname, missing required STARTTLS, PREAUTH and rejected login fail closed',async()=>{
 for(const mode of ['untrusted','hostname','no_starttls','preauth','rejected']){const imap=await protocolServer({starttls:mode==='no_starttls',omitStarttls:mode==='no_starttls',preauth:mode==='preauth',rejectLogin:mode==='rejected'});try{
  const value=profile();if(mode==='no_starttls'){value.imap.transport='starttls_required';value.imap.port=143;}
  await assert.rejects(connector(imap,imap,{trust:mode!=='untrusted',hostname:mode==='hostname'?'foreign.example.test':undefined}).probe(value,context()));
  assert.equal(imap.counters.plaintext_auth,0);assert.equal(imap.counters.auth,mode==='rejected'?1:0);
 }finally{await imap.close();}}
});
