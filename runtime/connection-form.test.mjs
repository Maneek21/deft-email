import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createDurableStore} from './durable-store.mjs';
import {createConnectionFormRuntime} from './connection-form-runtime.mjs';
import {createConnectionFormHttpHandler} from './connection-form-http.mjs';
import {createImapConnector,pinnedLookup} from './imap-connector.mjs';
import {makeScope,registrationFor} from './test-support.mjs';
import {digest} from './contract.mjs';

import {fixture,profile} from './connection-form-test-support.mjs';
const status=(f,connected,input=f.request)=>({...f.fresh(input),operation:'status',runtime_session_ref:connected.runtime_session_ref});

test('direct runtime form authenticates owner-declared primary; encrypted custody and status restart never authenticate again',async()=>{const f=await fixture();try{
 const {connected}=await f.connect();assert.equal(connected.state,'connected');assert.equal(connected.account.identity_assurance,'owner_declared_authenticated');assert.equal(connected.receipt.custody_generation,1);assert.equal(f.probes,1);
 for(const file of await readdir(f.root)){if(file.endsWith('.json'))assert(!String(await readFile(join(f.root,file))).includes(profile().imap.password));}
 assert(!JSON.stringify(connected).includes(profile().imap.password));assert(!JSON.stringify(f.calls).includes(profile().imap.password));
 const repeated=await f.forms.request(f.fresh());assert.equal(repeated.state,'connected');assert(!Object.hasOwn(repeated,'setup_url'));
 await f.close();const store=await createDurableStore({root:f.root,encryption_key:f.encryption_key,key_id:'fixture',allow_windows_fixture:true});try{const restarted=createConnectionFormRuntime({...f.config,store});assert.deepEqual(await restarted.request(status(f,connected)),connected);assert.equal(f.probes,1);}finally{await store.close();}
 }finally{if(f.probes===0)await f.close();}});

test('submit intent/probe failure or custody-CAS crash remain indeterminate; original submission and status never repeat AUTH',async()=>{
 for(const mode of ['probe','custody_committed']){let interrupt=true;const f=await fixture({probe:mode==='probe'?async()=>{throw Error('fixture interrupted');}:undefined,onPhase:async phase=>{if(phase===mode&&interrupt){interrupt=false;throw Error('fixture interrupted');}}});try{
  const begun=await f.forms.request(f.request),browser=await f.forms.exchange(new URL(begun.setup_url).hash.slice(1));await assert.rejects(f.forms.submit({...browser,value:profile()}));
  await assert.rejects(f.forms.submit({...browser,value:profile()}),{code:'EMAIL_FORM_SUBMIT_DENIED'});assert.equal((await f.forms.request(status(f,begun))).state,'indeterminate');assert.equal(f.probes,1);
 }finally{await f.close();}}
});

test('stable same-principal rotation advances generation once and fences old current access; principal/password/endpoint nominations cannot replace custody',async()=>{const f=await fixture();try{
 const first=await f.connect(),source={session_id:f.request.session_id,session_revision:1,scope:f.scope,runtime_session_ref:first.connected.runtime_session_ref,account_ref:first.connected.account.account_ref};
 const next={...f.fresh(),session_id:randomUUID(),source},begun=await f.forms.request(next),browser=await f.forms.exchange(new URL(begun.setup_url).hash.slice(1));
 await assert.rejects(f.forms.currentAccount(f.request.session_id,f.scope,async()=>{}),{code:'EMAIL_IMAP_ACCESS_DENIED'});
 await assert.rejects(f.forms.submit({...browser,value:{...profile(),imap:{...profile().imap,username:'foreign'}}}),{code:'EMAIL_FORM_SOURCE_DENIED'});assert.equal(f.probes,1);
 const changed=profile();changed.imap.password='FIXTURE_ONLY_ROTATED_PASSWORD';const connected=await f.forms.submit({...browser,value:changed});assert.equal(connected.receipt.custody_generation,2);assert.equal(connected.account.account_ref,source.account_ref);assert.equal(f.probes,2);
 const wrong={...f.fresh(next),session_id:randomUUID(),source:{...source,session_id:next.session_id,runtime_session_ref:connected.runtime_session_ref}};const wrongBegun=await f.forms.request(wrong),wrongBrowser=await f.forms.exchange(new URL(wrongBegun.setup_url).hash.slice(1));
 await assert.rejects(f.forms.submit({...wrongBrowser,value:{...profile(),imap:{...profile().imap,host:'private.example.test'}}}),{code:'EMAIL_IMAP_ENDPOINT_DENIED'});assert.equal(f.probes,2);
 }finally{await f.close();}});

test('profile drift, expired lease and current revocation deny without credential IO',async()=>{const f=await fixture();try{
 await assert.rejects(f.forms.request({...f.request,scope:{...f.scope,profile_digest:'sha256:'+'e'.repeat(64)}}),{code:'EMAIL_FORM_REGISTRATION_DENIED'});
 const begun=await f.forms.request(f.request);f.advance(300001);assert.equal((await f.forms.request(status(f,begun))).state,'not_connected');assert.equal(f.probes,0);
 const fresh={...f.fresh(),session_id:randomUUID(),setup_expires_at:new Date(Date.parse(f.fresh().expires_at)+271000).toISOString()};const next=await f.forms.request(fresh);f.revoke();await assert.rejects(f.forms.exchange(new URL(next.setup_url).hash.slice(1)),{code:'EMAIL_FORM_AUTHORITY_DENIED'});assert.equal(f.probes,0);
 }finally{await f.close();}});

test('actual runtime HTTP is same-origin/CSRF/cookie fenced; host transport never accepts passwords or OAuth callback',async()=>{const f=await fixture(),secret=randomBytes(32).toString('base64url'),server=createServer(createConnectionFormHttpHandler({forms:f.forms,setup_origin:f.config.setup_origin,runtime_auth_token:secret}));await new Promise(done=>server.listen(0,'127.0.0.1',done));const base='http://127.0.0.1:'+server.address().port;
 const post=(path,value,headers={})=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(value)});try{
  const page=await fetch(base+'/setup');assert.equal(page.status,200);assert(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));assert(!(await page.text()).includes(profile().imap.password));
  assert.equal((await post('/v1/connections',f.request)).status,401);assert.equal((await post('/v1/connections',{...f.request,password:'NEVER_ENTER_HOST'},{authorization:'Bearer '+secret})).status,400);
  const begun=await (await post('/v1/connections',f.request,{authorization:'Bearer '+secret})).json();const ticket=new URL(begun.setup_url).hash.slice(1);
  assert.equal((await post('/setup/exchange',{ticket},{origin:'https://foreign.example.test','sec-fetch-site':'cross-site'})).status,403);
  const headers={origin:f.config.setup_origin,'sec-fetch-site':'same-origin'},exchange=await post('/setup/exchange',{ticket},headers),browser=await exchange.json(),cookie=exchange.headers.get('set-cookie').split(';')[0];assert(!Object.hasOwn(browser,'browser'));assert(exchange.headers.get('set-cookie').includes('HttpOnly'));
  assert.equal((await post('/setup/submit',{session_id:browser.session_id,csrf:'foreign',value:profile()},{...headers,cookie})).status,403);assert.equal(f.probes,0);
  const completed=await post('/setup/submit',{session_id:browser.session_id,csrf:browser.csrf,value:profile()},{...headers,cookie});assert.equal(completed.status,200);assert.equal((await completed.json()).state,'connected');assert.equal(f.probes,1);
  assert.equal((await post('/setup/submit',{session_id:browser.session_id,csrf:browser.csrf,value:profile()},{...headers,cookie})).status,403);assert.equal(f.probes,1);
 }finally{await new Promise(done=>server.close(done));await f.close();}});

test('pinned DNS/TLS deny mixed/private addresses, plaintext/unauthorized certificate; probe only AUTH and SMTP verify',async()=>{
 for(const addresses of [[{address:'127.0.0.1',family:4}],[{address:'93.184.216.34',family:4},{address:'10.0.0.1',family:4}]])await assert.rejects(pinnedLookup('mail.example.test',undefined,async()=>addresses),{code:'EMAIL_IMAP_ENDPOINT_DENIED'});
 let auth=0,verify=0,construct;class Imap{constructor(options){construct=options;this.options=options;this.authenticated=true;this.secureConnection=true;this.tls={authorized:true};}async connect(){auth++;}async logout(){}close(){}}
 const connector=createImapConnector({ImapFlow:Imap,createTransport:options=>({options,verify:async()=>{verify++;},close(){}}),lookup:async()=>[{address:'93.184.216.34',family:4}]});const value=profile();value.smtp={...value.imap,host:'smtp.example.test',port:587,transport:'starttls_required'};
 await connector.probe(value,{expires_at:Date.now()+60000,check:async()=>{}});assert.equal(auth,1);assert.equal(verify,1);assert.equal(construct.logger,false);assert.equal(construct.tls.rejectUnauthorized,true);assert.equal(construct.tls.servername,value.imap.host);
 class Bad extends Imap{constructor(options){super(options);this.secureConnection=false;}}await assert.rejects(createImapConnector({ImapFlow:Bad,lookup:async()=>[{address:'93.184.216.34',family:4}]}).probe(profile(),{expires_at:Date.now()+60000,check:async()=>{}}),{code:'EMAIL_IMAP_TLS_REQUIRED'});
});

test('a foreign predecessor or durable unknown account effect denies replacement without repeating credential AUTH',async()=>{const f=await fixture();try{
 const {connected}=await f.connect(),source={session_id:f.request.session_id,session_revision:1,scope:f.scope,runtime_session_ref:connected.runtime_session_ref,account_ref:connected.account.account_ref};
 await assert.rejects(f.forms.request({...f.fresh(),session_id:randomUUID(),source:{...source,scope:{...f.scope,owner_user_id:randomUUID()}}}),{code:'EMAIL_FORM_SOURCE_DENIED'});
 const key='email.imap.custody.'+digest([f.scope.org_id,f.scope.owner_user_id,connected.account.account_ref]);
 await f.store.withLock({key},async tx=>{const row=await tx.read();assert(await tx.compareAndSwap({expected_revision:row.revision,value:{...row.value,pending_effect:{state:'unknown',run_id:randomUUID()}}}));});
 await assert.rejects(f.forms.request({...f.fresh(),session_id:randomUUID(),source}),{code:'EMAIL_FORM_SOURCE_BUSY'});assert.equal(f.probes,1);
 }finally{await f.close();}});
