import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createDurableStore} from './durable-store.mjs';
import {createRegistrationBook} from './registration-book.mjs';
import {createConnectionFormRuntime} from './connection-form-runtime.mjs';
import {createDataRuntime} from './data-runtime.mjs';
import {createImapConnector} from './imap-connector.mjs';
import {startFormRuntime} from './imap-server.mjs';
import {makeScope,registrationFor} from './test-support.mjs';
import {fixture,profile} from './connection-form-test-support.mjs';

const begin=(scope,at=Date.now())=>({schema_version:'deft.app_connection_form_runtime.v1',session_id:randomUUID(),scope,operation:'begin',setup_expires_at:new Date(at+290000).toISOString(),expires_at:new Date(at+25000).toISOString(),action_consents:[],source:null});
const reopen=f=>createDurableStore({root:f.root,encryption_key:f.encryption_key,key_id:'fixture',allow_windows_fixture:true});
// A runtime over the fixture's store that was configured with no registrations.
async function unconfigured(f,options={}){const book=await createRegistrationBook({configured:[],store:f.store,...options});return {book,forms:createConnectionFormRuntime({...f.config,registrations:[],registrationBook:book})};}
const connect=async(forms,request)=>{const begun=await forms.request(request),browser=await forms.exchange(new URL(begun.setup_url).hash.slice(1));return forms.submit({...browser,value:profile()});};

test('without the setting an unlisted registration is refused and the Host is never asked',async()=>{const f=await fixture();try{
 const {book,forms}=await unconfigured(f);assert.equal(book.decide(f.scope),'denied');
 await assert.rejects(forms.request(f.request),{code:'EMAIL_FORM_REGISTRATION_DENIED'});assert.equal(f.calls.length,0);assert.deepEqual(book.all(),[]);
 await assert.rejects(book.confirm(f.scope),{code:'EMAIL_FORM_REGISTRATION_DENIED'});
 assert.throws(()=>createConnectionFormRuntime({...f.config,registrations:[]}),{code:'EMAIL_FORM_CONFIG_INVALID'});
 await assert.rejects(createRegistrationBook({configured:[],store:f.store,admission:'anyone'}),{code:'EMAIL_FORM_CONFIG_INVALID'});
 }finally{await f.close();}});

test('with the setting the Host confirms an unlisted registration once; it connects and survives a restart with no configuration',async()=>{const f=await fixture();try{
 const {book,forms}=await unconfigured(f,{admission:'host_authority'});assert.equal(book.decide(f.scope),'ask_host');
 assert.equal((await connect(forms,f.request)).state,'connected');assert.equal(f.calls[0].operation,'begin');assert.equal(book.decide(f.scope),'known');
 assert.deepEqual(book.all(),[{...registrationFor(f.scope),connection_protocol:'credential_form.v1'}]);
 await f.close();const store=await reopen(f);try{
  const again=await createRegistrationBook({configured:[],store,admission:'host_authority'});assert.equal(again.decide(f.scope),'known');assert.deepEqual(again.all(),book.all());
  // Turning the setting off returns the runtime to exactly its configured list.
  const off=await createRegistrationBook({configured:[],store});assert.deepEqual(off.all(),[]);assert.equal(off.decide(f.scope),'denied');
 }finally{await store.close();}
 }finally{if(f.calls.length===0)await f.close();}});

test('a registration the Host refuses is not saved',async()=>{const f=await fixture();try{
 const {book,forms}=await unconfigured(f,{admission:'host_authority'});f.revoke();
 await assert.rejects(forms.request(f.request),{code:'EMAIL_FORM_AUTHORITY_DENIED'});assert.equal(f.calls.length,1);assert.deepEqual(book.all(),[]);assert.equal(book.decide(f.scope),'ask_host');
 await f.close();const store=await reopen(f);try{assert.deepEqual((await createRegistrationBook({configured:[],store,admission:'host_authority'})).all(),[]);}finally{await store.close();}
 }finally{if(f.calls.length===0)await f.close();}});

test('only the first organisation, a bounded count and a non-decreasing epoch are ever accepted',async()=>{const f=await fixture();try{
 const {book,forms}=await unconfigured(f,{admission:'host_authority',limit:2});await forms.request(f.request);const asked=f.calls.length;
 // Another organisation is refused before the Host is asked, even though this fixture Host would agree.
 const foreign={...makeScope(),consent_expires_at:f.scope.consent_expires_at};assert.equal(book.decide(foreign),'denied');
 await assert.rejects(forms.request(begin(foreign)),{code:'EMAIL_FORM_REGISTRATION_DENIED'});assert.equal(f.calls.length,asked);
 // Same registration: a later epoch replaces it, an earlier one is refused.
 const later={...f.scope,runtime_epoch:2},earlier={...f.scope,runtime_epoch:1};assert.equal(book.decide(later),'ask_host');await forms.request(begin(later));
 assert.equal(book.decide(later),'known');assert.equal(book.decide(earlier),'denied');assert.equal(book.all().length,1);assert.equal(book.all()[0].runtime_epoch,2);
 await assert.rejects(forms.request(begin(earlier)),{code:'EMAIL_FORM_REGISTRATION_DENIED'});
 // The count is bounded.
 const second={...f.scope,runtime_registration_id:randomUUID(),target_key:'second'},third={...f.scope,runtime_registration_id:randomUUID(),target_key:'third'};
 await forms.request(begin(second));assert.equal(book.all().length,2);assert.equal(book.decide(third),'denied');await assert.rejects(forms.request(begin(third)),{code:'EMAIL_FORM_REGISTRATION_DENIED'});
 // Confirmation is only reachable through begin or status, never through a later step.
 assert.equal(book.decide({...f.scope,runtime_epoch:'2'}),'denied');assert.equal(book.decide(null),'denied');
 }finally{await f.close();}});

test('a configured registration stays an exact pin; the Host cannot move it',async()=>{const f=await fixture();try{
 const book=await createRegistrationBook({configured:[{...registrationFor(f.scope),connection_protocol:'credential_form.v1'}],store:f.store,admission:'host_authority'});
 const forms=createConnectionFormRuntime({...f.config,registrationBook:book});assert.equal(book.decide(f.scope),'known');
 assert.equal(book.decide({...f.scope,runtime_epoch:2}),'denied');await assert.rejects(forms.request(begin({...f.scope,runtime_epoch:2})),{code:'EMAIL_FORM_REGISTRATION_DENIED'});assert.equal(f.calls.length,0);
 // A further registration of the same organisation may still be confirmed.
 assert.equal(book.decide({...f.scope,runtime_registration_id:randomUUID()}),'ask_host');assert.equal(book.decide({...makeScope(),consent_expires_at:f.scope.consent_expires_at}),'denied');
 }finally{await f.close();}});

test('data requests are served for a confirmed registration and refused for an unconfirmed one',async()=>{const f=await fixture();try{
 const {book,forms}=await unconfigured(f,{admission:'host_authority'}),connected=await connect(forms,f.request);
 const runtime=createDataRuntime({registrations:[],getRegistrations:book.all,provider:'imap_smtp',forms,imapConnector:{imap:async()=>{throw Error('no mail server in this test');}},store:f.store,encryption_key:f.encryption_key,key_id:'fixture',assertCurrent:async value=>({...value,allowed:true})});
 const request=scope=>({schema_version:'deft.app_data_runtime.v1',request_id:randomUUID(),scope,connection:{session_id:f.request.session_id,session_revision:5,runtime_session_ref:connected.runtime_session_ref,account_ref:connected.account.account_ref},authority:{consent_id:randomUUID(),consent_digest:'sha256:'+'d'.repeat(64),data_policy_digest:'sha256:'+'e'.repeat(64)},operation:'connection_metadata',expires_at:new Date(Date.now()+29000).toISOString(),input:{store_key:'drafts'}});
 assert.deepEqual((await runtime.request(request(f.scope))).identities,[{address:'owner@example.test',label:'Owner declared address'}]);
 await assert.rejects(runtime.request(request({...f.scope,runtime_registration_id:randomUUID()})),{code:'EMAIL_RUNTIME_REGISTRATION_DENIED'});
 }finally{await f.close();}});

test('the form process starts with no registrations at all and serves one the Host confirms; without the setting it does not start',async()=>{
 const scope=makeScope(),runtime_auth_token=randomBytes(32).toString('base64url'),authority_token=randomBytes(32).toString('base64url');let asked=0;
 const host=createServer(async(request,response)=>{const chunks=[];for await(const chunk of request)chunks.push(chunk);asked++;response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({...JSON.parse(Buffer.concat(chunks).toString('utf8')),allowed:true}));});
 await new Promise(done=>host.listen(0,'127.0.0.1',done));
 class Imap{constructor(options){this.options=options;this.authenticated=true;this.secureConnection=true;this.tls={authorized:true};}async connect(){}async logout(){}close(){}}
 const store_root=await mkdtemp(join(tmpdir(),'imap-form-book-')),encryption_key_hex=randomBytes(32).toString('hex');
 const config=extra=>({listen_port:0,store_root,key_id:'fixture',encryption_key_hex,runtime_auth_token,authority_token,form_authority_url:'http://127.0.0.1:'+host.address().port+'/api/app-connection-forms/runtime/authority',registrations:[],
  provider_config:{provider:'imap_smtp',setup_origin:'https://runtime.example.test',profile_digests:[],endpoint_policy:{mode:'public_addresses'}},...extra});
 const options={allow_windows_fixture:true,allow_loopback_fixture:true,connector:createImapConnector({ImapFlow:Imap,lookup:async()=>[{address:'93.184.216.34',family:4}]}),start_send_workers:false,start_observation_workers:false};
 const serve=async()=>{const runtime=await startFormRuntime(config({registration_admission:'host_authority'}),options),base='http://127.0.0.1:'+runtime.server.address().port;return {runtime,post:(path,value,headers={})=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(value)})};};
 try{
  await assert.rejects(startFormRuntime(config({}),options),{code:'EMAIL_FORM_CONFIG_INVALID'});
  await assert.rejects(startFormRuntime(config({registration_admission:'anyone'}),options),{code:'EMAIL_FORM_CONFIG_INVALID'});
  const first=await serve(),request=begin(scope);let connected;try{
   const begun=await first.post('/v1/connections',request,{authorization:'Bearer '+runtime_auth_token});assert.equal(begun.status,200);
   const same={origin:'https://runtime.example.test','sec-fetch-site':'same-origin'},exchange=await first.post('/setup/exchange',{ticket:new URL((await begun.json()).setup_url).hash.slice(1)},same),browser=await exchange.json();
   const done=await first.post('/setup/submit',{session_id:browser.session_id,csrf:browser.csrf,value:profile()},{...same,cookie:exchange.headers.get('set-cookie').split(';')[0]});assert.equal(done.status,200);assert.equal((await done.json()).state,'connected');
   connected=await (await first.post('/v1/connections',{...request,operation:'status',runtime_session_ref:null,expires_at:new Date(Date.now()+25000).toISOString()},{authorization:'Bearer '+runtime_auth_token})).json();assert.equal(connected.state,'connected');
  }finally{await first.runtime.close();}
  // A restart with the same unchanged configuration still serves the account.
  const second=await serve();try{
   const status=await second.post('/v1/connections',{...request,operation:'status',runtime_session_ref:connected.runtime_session_ref,expires_at:new Date(Date.now()+25000).toISOString()},{authorization:'Bearer '+runtime_auth_token});
   assert.equal(status.status,200);assert.deepEqual(await status.json(),connected);assert(asked>=4);
  }finally{await second.runtime.close();}
 }finally{await new Promise(done=>host.close(done));}
});
