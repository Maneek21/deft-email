import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {resolveEndpointPolicy} from './endpoint-policy.mjs';
import {createConnectionFormRuntime} from './connection-form-runtime.mjs';
import {createImapConnector} from './imap-connector.mjs';
import {startFormRuntime} from './imap-server.mjs';
import {makeScope,registrationFor} from './test-support.mjs';
import {fixture,profile} from './connection-form-test-support.mjs';

const PUBLIC=[{address:'93.184.216.34',family:4}];
const at=(imap,smtp)=>{const value=profile();value.imap.host=imap;if(smtp!==undefined)value.smtp={...value.imap,host:smtp,port:465};return value;};
const open=async(forms,request)=>{const begun=await forms.request(request);return forms.exchange(new URL(begun.setup_url).hash.slice(1));};
// A mail library double that records whether the runtime ever tried to log in.
function library(){const seen={constructed:0,logins:0,options:null};class Imap{constructor(options){seen.constructed++;seen.options=options;this.options=options;this.authenticated=true;this.secureConnection=true;this.tls={authorized:true};}async connect(){seen.logins++;}async logout(){}close(){}}return {seen,Imap};}

test('the policy has exactly two forms; anything else refuses to start',()=>{
 assert.equal(resolveEndpointPolicy({mode:'public_addresses'}).mode,'public_addresses');
 assert.equal(resolveEndpointPolicy({imap_hosts:['mail.example.test'],smtp_hosts:[]}).mode,'listed_hosts');
 for(const raw of [undefined,null,[],'public_addresses',{},{mode:'any'},{mode:'public_addresses',imap_hosts:['mail.example.test'],smtp_hosts:[]},{mode:'public_addresses',extra:true},{imap_hosts:[],smtp_hosts:[]},{imap_hosts:['mail.example.test']},{imap_hosts:['Mail.Example.Test'],smtp_hosts:[]},{imap_hosts:['mail.example.test','mail.example.test'],smtp_hosts:[]},{imap_hosts:Array.from({length:33},(_,i)=>'m'+i+'.example.test'),smtp_hosts:[]}])
  assert.throws(()=>resolveEndpointPolicy(raw),{code:'EMAIL_FORM_CONFIG_INVALID'});
});

test('a listed policy still admits only its exact names',()=>{
 const policy=resolveEndpointPolicy({imap_hosts:['mail.example.test'],smtp_hosts:['smtp.example.test']});
 assert.equal(policy.allows(at('mail.example.test')),true);assert.equal(policy.allows(at('mail.example.test','smtp.example.test')),true);
 assert.equal(policy.allows(at('other.example.test')),false);assert.equal(policy.allows(at('mail.example.test','other.example.test')),false);
});

test('the public policy admits unlisted names but never a private-network name',()=>{
 const policy=resolveEndpointPolicy({mode:'public_addresses'});
 assert.equal(policy.allows(at('imap.anywhere.example')),true);assert.equal(policy.allows(at('imap.anywhere.example','smtp.elsewhere.example')),true);
 for(const name of ['db.internal','cell.flycast.internal','printer.local','mail.localhost','nas.lan','router.home.arpa','localhost','10.0.0.5','IMAP.Example.Test',''])
  {assert.equal(policy.allows(at(name)),false,name);assert.equal(policy.allows(at('imap.anywhere.example',name)),false,name);}
});

test('under the public policy an unlisted server connects only when every one of its addresses is public',async()=>{
 const endpointPolicy=resolveEndpointPolicy({mode:'public_addresses'}).allows,unlisted=()=>at('imap.unlisted.example'),context=()=>({expires_at:Date.now()+60000,check:async()=>{}});
 // The connector itself: no login is attempted against a name with any non-public address.
 for(const set of [[{address:'127.0.0.1',family:4}],[{address:'10.1.2.3',family:4}],[{address:'169.254.169.254',family:4}],[{address:'172.16.0.9',family:4}],[{address:'192.168.1.9',family:4}],[{address:'100.64.0.1',family:4}],[{address:'0.0.0.0',family:4}],[{address:'fdaa:0:1::3',family:6}],[{address:'fe80::1',family:6}],[{address:'::1',family:6}],[{address:'::ffff:10.0.0.1',family:6}],[...PUBLIC,{address:'10.0.0.1',family:4}],[{address:'93.184.216.34',family:6}],[]]){
  const {seen,Imap}=library();await assert.rejects(createImapConnector({ImapFlow:Imap,lookup:async()=>set}).probe(unlisted(),context()),{code:'EMAIL_IMAP_ENDPOINT_DENIED'},JSON.stringify(set));assert.equal(seen.constructed,0,JSON.stringify(set));
 }
 const f=await fixture();try{
  let addresses=[{address:'10.1.2.3',family:4}];const {seen,Imap}=library(),lookups=[],connector=createImapConnector({ImapFlow:Imap,lookup:async name=>{lookups.push(name);return addresses;}});
  const forms=createConnectionFormRuntime({...f.config,endpointPolicy,connector}),browser=await open(forms,f.request);
  // The same name is refused outright by the list this fixture was built with.
  await assert.rejects(f.forms.submit({...browser,value:unlisted()}),{code:'EMAIL_IMAP_ENDPOINT_DENIED'});assert.equal(lookups.length,0);
  await assert.rejects(forms.submit({...browser,value:unlisted()}),error=>error.code==='EMAIL_IMAP_ENDPOINT_DENIED'&&error.retry===true);assert.equal(seen.constructed,0);
  await assert.rejects(forms.submit({...browser,value:at('db.internal')}),error=>error.code==='EMAIL_IMAP_ENDPOINT_DENIED'&&error.retry===true);assert.deepEqual(lookups,['imap.unlisted.example']);
  // The owner corrects nothing but the server now resolves publicly: same page connects.
  addresses=PUBLIC;const connected=await forms.submit({...browser,value:unlisted()});assert.equal(connected.state,'connected');assert.equal(seen.logins,1);
  // The login went to the pinned address while the certificate name stayed the nominated one.
  assert.equal(seen.options.host,'imap.unlisted.example');assert.equal(seen.options.tls.servername,'imap.unlisted.example');assert.equal(seen.options.tls.rejectUnauthorized,true);
  const pinned=await new Promise((done,fail)=>seen.options.tls.lookup('attacker-controlled.example',{},(error,address)=>error?fail(error):done(address)));assert.equal(pinned,'93.184.216.34');
 }finally{await f.close();}
});

test('the form process starts with the public policy and serves a whole connection; a malformed policy does not start',async()=>{
 const scope=makeScope(),runtime_auth_token=randomBytes(32).toString('base64url'),authority_token=randomBytes(32).toString('base64url'),asked=[];
 const host=createServer(async(request,response)=>{const chunks=[];for await(const chunk of request)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));asked.push({path:request.url,operation:body.operation,bearer:request.headers.authorization==='Bearer '+authority_token,raw:JSON.stringify(body)});response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify({...body,allowed:true}));});
 await new Promise(done=>host.listen(0,'127.0.0.1',done));
 const {seen,Imap}=library(),connector=createImapConnector({ImapFlow:Imap,lookup:async()=>PUBLIC});
 const config=async endpoint_policy=>({listen_port:0,store_root:await mkdtemp(join(tmpdir(),'imap-form-start-')),key_id:'fixture',encryption_key_hex:randomBytes(32).toString('hex'),runtime_auth_token,authority_token,
  form_authority_url:'http://127.0.0.1:'+host.address().port+'/api/app-connection-forms/runtime/authority',registrations:[{...registrationFor(scope),connection_protocol:'credential_form.v1'}],
  provider_config:{provider:'imap_smtp',setup_origin:'https://runtime.example.test',profile_digests:[scope.profile_digest],endpoint_policy}});
 const options={allow_windows_fixture:true,allow_loopback_fixture:true,connector,start_send_workers:false,start_observation_workers:false};
 try{
  for(const bad of [{mode:'any'},{mode:'public_addresses',imap_hosts:['mail.example.test'],smtp_hosts:[]},{imap_hosts:[],smtp_hosts:[]}])await assert.rejects(async()=>startFormRuntime(await config(bad),options),{code:'EMAIL_FORM_CONFIG_INVALID'});
  const runtime=await startFormRuntime(await config({mode:'public_addresses'}),options);try{
   const base='http://127.0.0.1:'+runtime.server.address().port,post=(path,value,headers={})=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(value)});
   const now=Date.now(),begin={schema_version:'deft.app_connection_form_runtime.v1',session_id:crypto.randomUUID(),scope,operation:'begin',setup_expires_at:new Date(now+290000).toISOString(),expires_at:new Date(now+25000).toISOString(),action_consents:[],source:null};
   const begun=await post('/v1/connections',begin,{authorization:'Bearer '+runtime_auth_token});assert.equal(begun.status,200);const setup=new URL((await begun.json()).setup_url);assert.equal(setup.origin,'https://runtime.example.test');assert.equal(setup.pathname,'/setup');
   const same={origin:'https://runtime.example.test','sec-fetch-site':'same-origin'},exchange=await post('/setup/exchange',{ticket:setup.hash.slice(1)},same),browser=await exchange.json(),cookie=exchange.headers.get('set-cookie').split(';')[0];
   const done=await post('/setup/submit',{session_id:browser.session_id,csrf:browser.csrf,value:at('imap.unlisted.example')},{...same,cookie});assert.equal(done.status,200);assert.equal((await done.json()).state,'connected');assert.equal(seen.logins,1);
   assert(asked.length>=3&&asked.every(call=>call.bearer&&call.path==='/api/app-connection-forms/runtime/authority'));assert(asked.some(call=>call.operation==='submit'));
   // The Host is asked for permission but is never sent the mail password.
   assert(asked.every(call=>!call.raw.includes(profile().imap.password)));
  }finally{await runtime.close();}
 }finally{await new Promise(done=>host.close(done));}
});
