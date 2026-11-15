import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createConnectionFormHttpHandler} from './connection-form-http.mjs';
import {FORM_RETRY} from './connection-form-runtime.mjs';
import {createImapConnector,probeFailure,PROBE_REJECTIONS} from './imap-connector.mjs';
import {digest} from './contract.mjs';
import {fixture,profile} from './connection-form-test-support.mjs';

const WRONG='FIXTURE_ONLY_WRONG_PASSWORD';
const coded=code=>Object.assign(new Error(code),{code});
const wrong=()=>{const value=profile();value.imap.password=WRONG;return value;};
// The fixture mail server accepts exactly the fixture password.
const strict=async value=>{if(value.imap.password!==profile().imap.password)throw coded('EMAIL_IMAP_LOGIN_REJECTED');};
const status=(f,begun,input=f.request)=>({...f.fresh(input),operation:'status',runtime_session_ref:begun.runtime_session_ref});
const another=f=>({...f.fresh(),session_id:randomUUID(),setup_expires_at:new Date(Date.parse(f.fresh().expires_at)+271000).toISOString()});
const open=async(f,input=f.request)=>{const begun=await f.forms.request(input);return {begun,browser:await f.forms.exchange(new URL(begun.setup_url).hash.slice(1))};};
const longConsent={consent_expires_at:new Date(Date.now()+4*3600000).toISOString()};

test('a refused login stores nothing and reopens the same setup page; the corrected password then connects',async()=>{const f=await fixture({probe:strict});try{
 const {begun,browser}=await open(f);
 await assert.rejects(f.forms.submit({...browser,value:wrong()}),error=>error.code==='EMAIL_IMAP_LOGIN_REJECTED'&&error.retry===true&&!String(error.stack).includes(WRONG));
 assert.equal((await f.forms.request(status(f,begun))).state,'awaiting_input');
 const connected=await f.forms.submit({...browser,value:profile()});assert.equal(connected.state,'connected');assert.equal(connected.receipt.custody_generation,1);assert.equal(f.probes,2);
 for(const file of await readdir(f.root))if(file.endsWith('.json'))assert(!String(await readFile(join(f.root,file))).includes(WRONG));
 assert(!JSON.stringify(f.calls).includes(WRONG));
 }finally{await f.close();}});

test('the last allowed try closes the page; status proves nothing was stored and a fresh attempt may begin',async()=>{const f=await fixture({probe:strict});try{
 const {begun,browser}=await open(f);
 for(let attempt=1;attempt<=FORM_RETRY.tries_per_session;attempt++)await assert.rejects(f.forms.submit({...browser,value:wrong()}),error=>error.code==='EMAIL_IMAP_LOGIN_REJECTED'&&error.retry===(attempt<FORM_RETRY.tries_per_session));
 await assert.rejects(f.forms.submit({...browser,value:profile()}),{code:'EMAIL_FORM_SUBMIT_DENIED'});assert.equal(f.probes,FORM_RETRY.tries_per_session);
 const settled=await f.forms.request(status(f,begun));assert.equal(settled.state,'not_connected');assert.equal(settled.input_consumed,true);assert.equal(settled.account,null);
 const again=await open(f,another(f));assert.equal((await f.forms.submit({...again.browser,value:profile()})).state,'connected');
 }finally{await f.close();}});

test('an unclassified login-check failure stays unknown until status; afterwards the slot is free again',async()=>{let fail=true;const f=await fixture({probe:async()=>{if(fail)throw Error('fixture socket fault');}});try{
 const {begun,browser}=await open(f);await assert.rejects(f.forms.submit({...browser,value:profile()}),error=>error.retry===undefined);
 // Before any status check the unknown mark still reserves the connection.
 await assert.rejects(f.forms.request(another(f)),{code:'EMAIL_FORM_DOMAIN_RESERVED'});
 assert.equal((await f.forms.request(status(f,begun))).state,'not_connected');fail=false;
 const again=await open(f,another(f));assert.equal((await f.forms.submit({...again.browser,value:profile()})).state,'connected');assert.equal(f.probes,2);
 }finally{await f.close();}});

test('an attempt that already stored an account is never settled to not connected',async()=>{let interrupt=true;const f=await fixture({onPhase:async phase=>{if(phase==='custody_committed'&&interrupt){interrupt=false;throw Error('fixture interrupted');}}});try{
 const {begun,browser}=await open(f);await assert.rejects(f.forms.submit({...browser,value:profile()}));
 assert.equal((await f.forms.request(status(f,begun))).state,'indeterminate');assert.equal((await f.forms.request(status(f,begun))).state,'indeterminate');
 await assert.rejects(f.forms.request(another(f)),{code:'EMAIL_FORM_DOMAIN_RESERVED'});assert.equal(f.probes,1);
 }finally{await f.close();}});

test('failed checks are capped per connection per hour; a capped try contacts no server and consumes nothing',async()=>{const f=await fixture({probe:strict,scope:longConsent});try{
 let current={...await open(f),input:f.request},failures=0;
 while(failures<FORM_RETRY.failures_per_window){
  await assert.rejects(f.forms.submit({...current.browser,value:wrong()}),{code:'EMAIL_IMAP_LOGIN_REJECTED'});failures++;
  if(failures%FORM_RETRY.tries_per_session===0&&failures<FORM_RETRY.failures_per_window){assert.equal((await f.forms.request(status(f,current.begun,current.input))).state,'not_connected');const input=another(f);current={...await open(f,input),input};}
 }
 assert.equal(f.probes,FORM_RETRY.failures_per_window);
 // Even the right password is refused while the cap holds, and the page stays open.
 await assert.rejects(f.forms.submit({...current.browser,value:profile()}),{code:'EMAIL_FORM_ATTEMPTS_EXCEEDED'});assert.equal(f.probes,FORM_RETRY.failures_per_window);
 assert.equal((await f.forms.request(status(f,current.begun,current.input))).state,'awaiting_input');
 f.advance(FORM_RETRY.window_ms+1);assert.equal((await f.forms.request(status(f,current.begun,current.input))).state,'not_connected');
 const later=await open(f,another(f));assert.equal((await f.forms.submit({...later.browser,value:profile()})).state,'connected');
 }finally{await f.close();}});

// Replacing the stored password of a connected account ("Reconnect existing account").
const NEW='FIXTURE_ONLY_NEW_PASSWORD';
const renewed=()=>{const value=profile();value.imap.password=NEW;return value;};
const acceptsNew=async value=>{if(![profile().imap.password,NEW].includes(value.imap.password))throw coded('EMAIL_IMAP_LOGIN_REJECTED');};
async function connectedAccount(options={}){const f=await fixture({probe:acceptsNew,...options}),first=await f.connect();
 return {f,first,source:{session_id:f.request.session_id,session_revision:1,scope:f.scope,runtime_session_ref:first.connected.runtime_session_ref,account_ref:first.connected.account.account_ref},
  usable:()=>f.forms.currentAccount(f.request.session_id,f.scope,async()=>{})};}

test('a replacement with a mistyped password can be corrected on the same page; the account stays reserved meanwhile',async()=>{const {f,first,source,usable}=await connectedAccount();try{
 const input={...another(f),source},{begun,browser}=await open(f,input);
 await assert.rejects(usable(),{code:'EMAIL_IMAP_ACCESS_DENIED'});
 await assert.rejects(f.forms.submit({...browser,value:wrong()}),error=>error.code==='EMAIL_IMAP_LOGIN_REJECTED'&&error.retry===true);
 // Still reserved: the old credentials are not usable while the page is open.
 await assert.rejects(usable(),{code:'EMAIL_IMAP_ACCESS_DENIED'});assert.equal((await f.forms.request(status(f,begun,input))).state,'awaiting_input');
 const connected=await f.forms.submit({...browser,value:renewed()});assert.equal(connected.state,'connected');assert.equal(connected.receipt.custody_generation,2);assert.equal(connected.account.account_ref,first.connected.account.account_ref);
 assert.equal((await f.forms.currentAccount(input.session_id,f.scope,async()=>{})).profile.imap.password,NEW);await assert.rejects(usable(),{code:'EMAIL_IMAP_ACCESS_DENIED'});
 }finally{await f.close();}});

test('a replacement that fails for good releases the account: the old connection works again and a new replacement may begin',async()=>{const {f,source,usable}=await connectedAccount();try{
 const input={...another(f),source},{begun,browser}=await open(f,input);
 for(let attempt=1;attempt<=FORM_RETRY.tries_per_session;attempt++)await assert.rejects(f.forms.submit({...browser,value:wrong()}),error=>error.retry===(attempt<FORM_RETRY.tries_per_session));
 // Until the Host asks, the outcome is held and the account stays reserved.
 await assert.rejects(usable(),{code:'EMAIL_IMAP_ACCESS_DENIED'});await assert.rejects(f.forms.request({...another(f),source}),{code:'EMAIL_FORM_DOMAIN_RESERVED'});
 assert.equal((await f.forms.request(status(f,begun,input))).state,'not_connected');
 assert.equal((await usable()).custody_generation,1);assert.equal((await usable()).profile.imap.password,profile().imap.password);
 const again={...another(f),source},second=await open(f,again),connected=await f.forms.submit({...second.browser,value:renewed()});assert.equal(connected.receipt.custody_generation,2);
 }finally{await f.close();}});

test('an abandoned replacement page releases the account once its lease has lapsed',async()=>{const {f,source,usable}=await connectedAccount({scope:longConsent});try{
 const input={...another(f),source},begun=await f.forms.request(input);
 await assert.rejects(usable(),{code:'EMAIL_IMAP_ACCESS_DENIED'});assert.equal((await f.forms.request(status(f,begun,input))).state,'awaiting_input');await assert.rejects(usable(),{code:'EMAIL_IMAP_ACCESS_DENIED'});
 f.advance(300001);assert.equal((await f.forms.request(status(f,begun,input))).state,'not_connected');assert.equal((await usable()).custody_generation,1);
 const second=await open(f,{...another(f),source});assert.equal((await f.forms.submit({...second.browser,value:renewed()})).receipt.custody_generation,2);assert.equal(f.probes,2);
 }finally{await f.close();}});

test('a replacement that stored new credentials is never undone, and one begun before this rule is left alone',async()=>{
 let interrupt=false;const committed=await connectedAccount({onPhase:async phase=>{if(phase==='custody_committed'&&interrupt){interrupt=false;throw Error('fixture interrupted');}}});try{const {f,source,usable}=committed;
  interrupt=true;const input={...another(f),source},{begun,browser}=await open(f,input);await assert.rejects(f.forms.submit({...browser,value:renewed()}));
  assert.equal((await f.forms.request(status(f,begun,input))).state,'indeterminate');await assert.rejects(usable(),{code:'EMAIL_IMAP_ACCESS_DENIED'});
  const key='email.imap.custody.'+digest([f.scope.org_id,f.scope.owner_user_id,source.account_ref]),stored=(await f.store.withLock({key},tx=>tx.read())).value;
  assert.equal(stored.custody_generation,2);assert.equal(stored.profile.imap.password,NEW);assert.equal(stored.pending_transition,null);
 }finally{await committed.f.close();}
 const legacy=await connectedAccount({scope:longConsent});try{const {f,source,usable}=legacy,input={...another(f),source},begun=await f.forms.request(input);
  await f.store.withLock({key:'email.imap.form.session.'+input.session_id},async tx=>{const row=await tx.read(),{source_custody_generation,...before}=row.value;assert.equal(source_custody_generation,1);assert(await tx.compareAndSwap({expected_revision:row.revision,value:before}));});
  f.advance(300001);assert.equal((await f.forms.request(status(f,begun,input))).state,'indeterminate');await assert.rejects(usable(),{code:'EMAIL_IMAP_ACCESS_DENIED'});
 }finally{await legacy.f.close();}});

test('a replacement whose begin never recorded its attempt cannot leave the account reserved',async()=>{const {f,source,usable}=await connectedAccount();try{
 const key='email.imap.custody.'+digest([f.scope.org_id,f.scope.owner_user_id,source.account_ref]),reserve=id=>f.store.withLock({key},async tx=>{const row=await tx.read();assert(await tx.compareAndSwap({expected_revision:row.revision,value:{...row.value,pending_transition:id}}));});
 // The reservation was written, then the process stopped before the attempt row.
 const lost={...another(f),source};await reserve(lost.session_id);await assert.rejects(usable(),{code:'EMAIL_IMAP_ACCESS_DENIED'});
 assert.equal((await f.forms.request({...lost,operation:'status',runtime_session_ref:null})).state,'not_connected');assert.equal((await usable()).custody_generation,1);
 // A status for some other unknown attempt never releases a reservation it does not own.
 await reserve(randomUUID());assert.equal((await f.forms.request({...another(f),source,operation:'status',runtime_session_ref:null})).state,'not_connected');await assert.rejects(usable(),{code:'EMAIL_IMAP_ACCESS_DENIED'});
 }finally{await f.close();}});

test('the connector names only certain login-check outcomes and never carries provider text outward',async()=>{
 const secret='FIXTURE_ONLY_ECHOED_PASSWORD';
 assert.equal(probeFailure(Object.assign(new Error('NO [AUTHENTICATIONFAILED] '+secret),{authenticationFailed:true}),'IMAP').code,'EMAIL_IMAP_LOGIN_REJECTED');
 assert.equal(probeFailure(Object.assign(new Error('535 '+secret),{code:'EAUTH'}),'SMTP').code,'EMAIL_SMTP_LOGIN_REJECTED');
 for(const code of ['ENOTFOUND','ECONNREFUSED','ETIMEDOUT','CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID'])assert.equal(probeFailure(coded(code),'IMAP').code,'EMAIL_IMAP_SERVER_UNREACHABLE');
 assert.equal(probeFailure(coded('ESOCKET'),'SMTP').code,'EMAIL_SMTP_SERVER_UNREACHABLE');
 assert(!JSON.stringify([probeFailure(Object.assign(new Error(secret),{authenticationFailed:true}),'IMAP').stack,probeFailure(Object.assign(new Error(secret),{code:'EAUTH'}),'SMTP').stack]).includes(secret));
 // Authority, deadline and unknown faults are not outcomes of the login itself.
 for(const error of [coded('EMAIL_FORM_AUTHORITY_DENIED'),coded('EMAIL_IMAP_DEADLINE'),new Error('unknown'),coded('EPROTOCOL')])assert.equal(probeFailure(error,'IMAP'),error);
 assert(PROBE_REJECTIONS.every(code=>/^EMAIL_(?:IMAP|SMTP)_[A-Z_]+$/u.test(code))&&!PROBE_REJECTIONS.includes('EMAIL_IMAP_DEADLINE'));
 const lookup=async()=>[{address:'93.184.216.34',family:4}],context={expires_at:Date.now()+60000,check:async()=>{}};
 class Refusing{constructor(options){this.options=options;}async connect(){throw Object.assign(new Error('refused '+secret),{authenticationFailed:true});}close(){}}
 await assert.rejects(createImapConnector({ImapFlow:Refusing,lookup}).probe(profile(),context),error=>error.code==='EMAIL_IMAP_LOGIN_REJECTED'&&!String(error.stack).includes(secret));
 class Accepting{constructor(options){this.options=options;this.authenticated=true;this.secureConnection=true;this.tls={authorized:true};}async connect(){}async logout(){}close(){}}
 const value=profile();value.smtp={...value.imap,host:'smtp.example.test',port:465};
 await assert.rejects(createImapConnector({ImapFlow:Accepting,createTransport:()=>({verify:async()=>{throw coded('EAUTH');},close(){}}),lookup}).probe(value,context),{code:'EMAIL_SMTP_LOGIN_REJECTED'});
 await assert.rejects(createImapConnector({ImapFlow:Accepting,lookup:async()=>{throw coded('ENOTFOUND');}}).probe(profile(),context),{code:'EMAIL_IMAP_SERVER_UNREACHABLE'});
});

test('the setup page is told when the same page may be used again, and only then',async()=>{const f=await fixture({probe:strict}),secret=randomBytes(32).toString('base64url'),server=createServer(createConnectionFormHttpHandler({forms:f.forms,setup_origin:f.config.setup_origin,runtime_auth_token:secret}));await new Promise(done=>server.listen(0,'127.0.0.1',done));const base='http://127.0.0.1:'+server.address().port;
 const post=(path,value,headers={})=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(value)});try{
  const page=await (await fetch(base+'/setup')).text();assert(page.includes('Correct the details and try again.'));assert(!page.includes(WRONG));
  const begun=await (await post('/v1/connections',f.request,{authorization:'Bearer '+secret})).json(),headers={origin:f.config.setup_origin,'sec-fetch-site':'same-origin'};
  const exchange=await post('/setup/exchange',{ticket:new URL(begun.setup_url).hash.slice(1)},headers),browser=await exchange.json(),cookie=exchange.headers.get('set-cookie').split(';')[0],send=value=>post('/setup/submit',{session_id:browser.session_id,csrf:browser.csrf,value},{...headers,cookie});
  const shouting=profile();shouting.imap.host='MAIL.EXAMPLE.TEST';const invalid=await send(shouting);assert.equal(invalid.status,400);assert.deepEqual(await invalid.json(),{code:'EMAIL_FORM_INPUT_INVALID',retry:true});assert.equal(f.probes,0);
  const refused=await send(wrong());assert.equal(refused.status,403);assert.equal(refused.headers.get('set-cookie'),null);const body=await refused.text();assert.deepEqual(JSON.parse(body),{code:'EMAIL_IMAP_LOGIN_REJECTED',retry:true});assert(!body.includes(WRONG));
  const foreign=await post('/setup/submit',{session_id:browser.session_id,csrf:'foreign',value:profile()},{...headers,cookie});assert.equal(foreign.status,403);assert.deepEqual(await foreign.json(),{code:'EMAIL_FORM_SUBMIT_DENIED'});
  const completed=await send(profile());assert.equal(completed.status,200);assert.equal((await completed.json()).state,'connected');assert.equal(f.probes,2);
 }finally{await new Promise(done=>server.close(done));await f.close();}});

test('the genuine mail libraries produce the named outcomes for a refused login and an unverifiable server',async()=>{
 const {ImapFlow}=await import('imapflow'),nodemailer=(await import('nodemailer')).default,{protocolServer,ca}=await import('./imap-tls-fixture.mjs');
 const local=(_host,options,done)=>options.all?done(null,[{address:'127.0.0.1',family:4}]):done(null,'127.0.0.1',4),context=()=>({signal:AbortSignal.timeout(10000),expires_at:Date.now()+10000,check:async()=>{}});
 // Same synthetic override as imap-tls.test.mjs: the public-address policy still
 // runs; only the constructors map the validated name to the loopback fixture.
 const connector=(imap,smtp,trust=true)=>{class LocalImap extends ImapFlow{constructor(options){super({...options,port:imap.port,tls:{...options.tls,...(trust?{ca}:{}),lookup:local}});}}
  return createImapConnector({ImapFlow:LocalImap,lookup:async()=>[{address:'93.184.216.34',family:4}],createTransport:options=>nodemailer.createTransport({...options,host:'127.0.0.1',port:smtp.port,tls:{...options.tls,ca,lookup:local}})});};
 const withSmtp=()=>{const value=profile();value.smtp={...value.imap,host:'smtp.example.test',port:465};return value;};
 for(const [options,value,trust,code] of [[{imap:{rejectLogin:true}},profile(),true,'EMAIL_IMAP_LOGIN_REJECTED'],[{imap:{}},profile(),false,'EMAIL_IMAP_SERVER_UNREACHABLE'],[{imap:{},smtp:{protocol:'smtp',rejectLogin:true}},withSmtp(),true,'EMAIL_SMTP_LOGIN_REJECTED']]){
  const imap=await protocolServer(options.imap),smtp=options.smtp?await protocolServer(options.smtp):imap;
  try{await assert.rejects(connector(imap,smtp,trust).probe(value,context()),error=>error.code===code&&!String(error.stack).includes(profile().imap.password));assert.equal(imap.counters.plaintext_auth,0);}
  finally{await imap.close();if(smtp!==imap)await smtp.close();}
 }
});

test('status of an attempt the runtime never received is not connected, but only once the Host confirms it',async()=>{const f=await fixture();try{
 // The Host created its record and asked to begin; the request never arrived.
 const lost={...f.fresh(),operation:'status',runtime_session_ref:null},answer=await f.forms.request(lost);
 assert.equal(answer.state,'not_connected');assert.equal(answer.input_consumed,false);assert.equal(answer.account,null);assert.equal(answer.receipt,null);assert.match(answer.runtime_session_ref,/^[A-Za-z0-9_-]{43}$/u);
 assert.deepEqual(await f.forms.request({...f.fresh(),operation:'status',runtime_session_ref:null}),answer);
 assert.deepEqual(await f.forms.request({...f.fresh(),operation:'status',runtime_session_ref:answer.runtime_session_ref}),answer);
 assert(f.calls.every(call=>call.operation==='status'));
 // The delayed begin for that same attempt cannot open a setup page afterwards.
 const late=await f.forms.request(f.fresh());assert.equal(late.state,'not_connected');assert(!Object.hasOwn(late,'setup_url'));
 // The connection itself is free: a new attempt connects.
 const again=await open(f,another(f));assert.equal((await f.forms.submit({...again.browser,value:profile()})).state,'connected');
 }finally{await f.close();}
 const g=await fixture();try{g.revoke();
 await assert.rejects(g.forms.request({...g.fresh(),operation:'status',runtime_session_ref:null}),{code:'EMAIL_FORM_AUTHORITY_DENIED'});
 for(const file of await readdir(g.root))assert(!file.endsWith('.json'),'a refused status must not record an attempt');
 }finally{await g.close();}
 const h=await fixture();try{
 // An unknown attempt named with a session reference is still refused.
 await assert.rejects(h.forms.request({...h.fresh(),operation:'status',runtime_session_ref:randomBytes(32).toString('base64url')}),{code:'EMAIL_FORM_SESSION_DENIED'});
 await assert.rejects(h.forms.request({...h.fresh(),operation:'status',runtime_session_ref:null,scope:{...h.scope,profile_digest:'sha256:'+'e'.repeat(64)}}),{code:'EMAIL_FORM_REGISTRATION_DENIED'});
 }finally{await h.close();}
});

test('every answer on the retry paths is one the published Host contract accepts',async()=>{
 const {AppConnectionFormRuntimeResultSchema}=await import('@deft/app-kit/core'),accepted=value=>AppConnectionFormRuntimeResultSchema.parse(value);
 const f=await fixture({probe:strict});try{
  const begun=accepted(await f.forms.request(f.request));assert.equal(begun.state,'awaiting_input');const browser=await f.forms.exchange(new URL(begun.setup_url).hash.slice(1));
  await assert.rejects(f.forms.submit({...browser,value:wrong()}));
  // Reopened page: still awaiting input, not consumed, and no second setup link is issued.
  const reopened=accepted(await f.forms.request(status(f,begun)));assert.equal(reopened.state,'awaiting_input');assert.equal(reopened.input_consumed,false);assert(!Object.hasOwn(reopened,'setup_url'));
  for(let attempt=2;attempt<=FORM_RETRY.tries_per_session;attempt++)await assert.rejects(f.forms.submit({...browser,value:wrong()}));
  const settled=accepted(await f.forms.request(status(f,begun)));assert.equal(settled.state,'not_connected');assert.equal(settled.input_consumed,true);
  const lostInput={...another(f),operation:'status',runtime_session_ref:null},lost=accepted(await f.forms.request(lostInput));assert.equal(lost.state,'not_connected');
  const again=another(f),next=accepted(await f.forms.request(again)),page=await f.forms.exchange(new URL(next.setup_url).hash.slice(1));
  const connected=accepted(await f.forms.submit({...page,value:profile()}));assert.equal(connected.state,'connected');
  assert.deepEqual(accepted(await f.forms.request(status(f,connected,again))),connected);
 }finally{await f.close();}
});
