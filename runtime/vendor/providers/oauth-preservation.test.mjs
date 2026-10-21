import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createEmailOAuth} from './oauth-account.mjs';
import {createEncryptedEmailCustody} from './custody-encrypted.mjs';
import {oauthAccountKey,sameOAuthBinding} from './oauth-contract.mjs';
import {createOAuthProvider,requestedOAuthScopes,grantedOAuthCapabilities,normalizeOAuthScopes} from './oauth-provider.mjs';

const scope={org_id:'org',owner_id:'owner',installation_id:'installation'},browser='trusted-session-binding';
const copy=value=>structuredClone(value),response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const defer=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function memoryStore(){
 const rows=new Map(),queues=new Map();
 const store={rows,afterCallback:null,async withLock({key},callback){
  const previous=queues.get(key)??Promise.resolve(),done=defer();queues.set(key,done.promise);await previous;
  try{const result=await callback({async read(){return copy(rows.get(key)??null);},async compareAndSwap({expected_revision,value}){const prior=rows.get(key);if((prior?.revision??null)!==expected_revision)return false;rows.set(key,{revision:(prior?.revision??0)+1,value:copy(value)});return true;}});await store.afterCallback?.({key});return result;}finally{done.resolve();if(queues.get(key)===done.promise)queues.delete(key);}
 }};return store;
}
function fixture(){
 let time=1000000,authorityAllowed=true,authorityExpiry=null,refreshMode=null,exchangeScopes=null,exchangeSubject=null,afterFetch=null;
 const store=memoryStore(),key=Uint8Array.from({length:32},(_,i)=>i+1),bindings=new Map(),calls=[],tokens=new Map();
 const clients={gmail:{client_id:'google-client',client_secret:'google-secret',redirect_uri:'https://deft.example.test/email/callback/gmail',verify_aliases:true},microsoft:{client_id:'microsoft-client',client_secret:'microsoft-secret',redirect_uri:'https://deft.example.test/email/callback/microsoft',tenant:'common'}};
 for(const [account_id,provider] of [['google-a','gmail'],['google-b','gmail'],['graph-a','microsoft'],['graph-b','microsoft']])bindings.set(account_id,{scope,account_id,provider,connection_target:'target-'+account_id,resource_binding_id:'resource-'+account_id,action_binding_id:'action-'+account_id,authority_epoch:1,capabilities:['read','search','thread','send']});
 const now=()=>time;
 const host={async resolveAccount({scope:requested,account_id}){if(JSON.stringify(requested)!==JSON.stringify(scope))throw Error('foreign owner');return copy(bindings.get(account_id));},async assertAuthority({binding}){return {allowed:authorityAllowed&&sameOAuthBinding(binding,bindings.get(binding.account_id)),expires_at:authorityExpiry??time+300000};}};
 const fetch=async(url,init)=>{
  const parsed=new URL(url),form=init.body instanceof URLSearchParams?Object.fromEntries(init.body):null;
  calls.push({url,method:init.method,form,redirect:init.redirect});let result;
  if(parsed.pathname.endsWith('/token')){
   const id=form.grant_type==='authorization_code'?form.code:tokens.get(form.refresh_token)?.account_id;assert.ok(id,'mock token belongs to an account');
   if(form.grant_type==='refresh_token'&&refreshMode){const result=await refreshMode({id,form});if(result)return result;}
   const binding=bindings.get(id),access_token='access-'+id+'-'+calls.length,refresh_token='refresh-'+id+'-'+calls.length,subject=exchangeSubject??id;
   tokens.set(access_token,{account_id:id,subject});tokens.set(refresh_token,{account_id:id,subject});
   const requested=form.scope??'openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send';
   result=response({access_token,refresh_token,token_type:'Bearer',expires_in:120,scope:exchangeScopes??requested,id_token:'caller-must-never-decode-this'});
   assert.equal(binding.provider==='gmail'?parsed.origin==='https://oauth2.googleapis.com':parsed.origin==='https://login.microsoftonline.com',true);
  }else if(url==='https://openidconnect.googleapis.com/v1/userinfo'){
   const token=tokens.get(init.headers.Authorization.slice(7));result=response({sub:token.subject,email:token.account_id+'@example.test',email_verified:true,name:token.account_id});
  }else if(parsed.pathname.endsWith('/profile')){
   const token=tokens.get(init.headers.Authorization.slice(7));result=response({emailAddress:token.account_id+'@example.test'});
  }else if(parsed.pathname.endsWith('/sendAs')){
   const token=tokens.get(init.headers.Authorization.slice(7));result=response({sendAs:[{sendAsEmail:'alias-'+token.account_id+'@example.test',verificationStatus:'accepted'},{sendAsEmail:'unverified@example.test',verificationStatus:'pending'}]});
  }else if(parsed.origin==='https://graph.microsoft.com'){
   const token=tokens.get(init.headers.Authorization.slice(7));result=response({id:token.subject,mail:token.account_id+'@example.test',displayName:token.account_id,userPrincipalName:'not-a-mailbox@elsewhere.test',proxyAddresses:['smtp:unchecked@example.test']});
  }else if(url==='https://oauth2.googleapis.com/revoke')result=new Response('',{status:200});
  else assert.fail('Unexpected provider URL '+url);
  if(afterFetch)await afterFetch({url,init,result});return result;
 };
 const custody=createEncryptedEmailCustody({encryption_key:key,key_id:'test-key',store,now}),oauth=createEmailOAuth({clients,host,custody,fetch,now});
 const begin=(id='google-a')=>oauth.begin({scope,account_id:id,browser_binding:browser});
 const complete=async(id='google-a',pending=null)=>{pending??=await begin(id);return oauth.complete({scope,state:new URL(pending.authorization_url).searchParams.get('state'),code:id,browser_binding:browser});};
 const token=(account,operation='read',service=oauth)=>service.getAccessToken({scope,account,account_id:account.account_id,operation,authority_epoch:account.authority_epoch});
 return {store,key,bindings,calls,tokens,custody,oauth,clients,host,fetch,now,begin,complete,token,setTime:value=>{time=value;},advance:ms=>{time+=ms;},deny:()=>{authorityAllowed=false;},expire:()=>{authorityExpiry=time;},setExchangeScopes:value=>{exchangeScopes=value;},setSubject:value=>{exchangeSubject=value;},setAfterFetch:fn=>{afterFetch=fn;},setRefreshMode:fn=>{refreshMode=fn;}};
}
const code=expected=>error=>error?.code===expected;


async function row(f,id='google-a'){return f.custody.withAccount(f.bindings.get(id),tx=>tx.read());}
async function noRetry(f,a){const n=f.calls.length;await assert.rejects(f.token(a),code('EMAIL_OAUTH_REAUTH_REQUIRED'));assert.equal(f.calls.length,n);}

test('lost Gmail refresh response retains last usable token and retries after durable backoff',async()=>{
 const f=fixture(),a=await f.complete(),before=(await row(f)).secret;f.advance(100000);
 f.setRefreshMode(()=>{throw Error('lost response');});await assert.rejects(f.token(a),code('EMAIL_OAUTH_PROVIDER_UNAVAILABLE'));
 const pending=await row(f);assert.equal(pending.health,'connected');assert.equal(pending.secret.refresh_token,before.refresh_token);
 assert.equal(pending.secret.refresh_reconciliation.phase,'transport_unavailable');assert.ok(pending.secret.refresh_reconciliation.next_retry_at>f.now());
 const count=f.calls.length;await assert.rejects(f.token(a),code('EMAIL_OAUTH_PROVIDER_UNAVAILABLE'));assert.equal(f.calls.length,count);
 f.setRefreshMode(null);f.advance(1001);assert.ok(await f.token(a));assert.equal((await row(f)).secret.refresh_reconciliation,undefined);
 assert.equal(JSON.stringify([...f.store.rows.values()]).includes(before.refresh_token),false);
});

test('received Gmail credentials commit before authority expires, then verification resumes after restart without another refresh',async()=>{
 const f=fixture(),a=await f.complete(),before=(await row(f)).secret;f.advance(100000);
 let unavailable=true;const original=f.host.assertAuthority;
 f.host.assertAuthority=async input=>{if(unavailable&&f.calls.some(c=>c.form?.grant_type==='refresh_token'))throw Error('Host down');return original(input);};
 await assert.rejects(f.token(a),code('EMAIL_OAUTH_AUTHORITY_DENIED'));
 const pending=await row(f);assert.notEqual(pending.secret.refresh_token,before.refresh_token);assert.equal(pending.secret.refresh_reconciliation.phase,'verification_pending');
 unavailable=false;f.advance(1001);const oauth=createEmailOAuth({clients:f.clients,host:f.host,custody:f.custody,fetch:f.fetch,now:f.now});
 assert.ok(await f.token(a,'read',oauth));assert.equal(f.calls.filter(c=>c.form?.grant_type==='refresh_token').length,1);
});

test('verification GET failure retries verification with persisted rotated credentials',async()=>{
 const f=fixture(),a=await f.complete();f.advance(100000);let fail=true;
 f.setAfterFetch(({url})=>{if(fail&&url.includes('userinfo'))throw Error('GET timeout');});
 await assert.rejects(f.token(a),code('EMAIL_OAUTH_PROVIDER_UNAVAILABLE'));
 assert.equal((await row(f)).secret.refresh_reconciliation.phase,'verification_pending');
 fail=false;f.advance(1001);assert.ok(await f.token(a));assert.equal(f.calls.filter(c=>c.form?.grant_type==='refresh_token').length,1);
});

test('legacy Gmail refresh_pending state reconciles under the same account lock',async()=>{
 const f=fixture(),a=await f.complete();f.advance(100000);
 await f.custody.withAccount(f.bindings.get('google-a'),async tx=>{const r=tx.read();await tx.write({health:'refresh_pending',secret:r.secret});});
 await Promise.all([f.token(a),f.token(a)]);assert.equal(f.calls.filter(c=>c.form?.grant_type==='refresh_token').length,1);
});

test('revocation at the live boundary prevents retry and token disclosure',async()=>{
 const f=fixture(),a=await f.complete();f.advance(100000);f.setRefreshMode(()=>{throw Error('timeout');});
 await assert.rejects(f.token(a),code('EMAIL_OAUTH_PROVIDER_UNAVAILABLE'));f.advance(300001);f.deny();
 const count=f.calls.length;await assert.rejects(f.token(a),code('EMAIL_OAUTH_AUTHORITY_DENIED'));assert.equal(f.calls.length,count);
});

test('verified identity mismatch requires reconnect and never retries provider access',async()=>{
 const f=fixture(),a=await f.complete();f.advance(100000);f.setSubject('different');
 await assert.rejects(f.token(a),code('EMAIL_OAUTH_RECONNECT_IDENTITY_CHANGED'));assert.equal((await row(f)).health,'reauth_required');await noRetry(f,a);
});

test('explicit invalid_grant discards credentials and blocks refresh replay',async()=>{
 const f=fixture(),a=await f.complete();f.advance(100000);f.setRefreshMode(()=>response({error:'invalid_grant'},400));
 await assert.rejects(f.token(a),code('EMAIL_OAUTH_REAUTH_REQUIRED'));const r=await row(f);assert.equal(r.health,'reauth_required');assert.equal(r.secret.refresh_token,'discarded');await noRetry(f,a);
});

test('Microsoft lost rotating refresh response remains fenced',async()=>{
 const f=fixture(),a=await f.complete('graph-a');f.advance(100000);f.setRefreshMode(()=>{throw Error('lost');});
 await assert.rejects(f.token(a),code('EMAIL_OAUTH_PROVIDER_UNAVAILABLE'));assert.equal((await row(f,'graph-a')).health,'refresh_pending');await noRetry(f,a);
});

test('Gmail refresh without replacement retains the last usable refresh token',async()=>{
 const f=fixture(),a=await f.complete(),before=(await row(f)).secret.refresh_token;f.advance(100000);
 f.tokens.set('unrotated-access',{account_id:'google-a',subject:'google-a'});
 f.setRefreshMode(()=>response({access_token:'unrotated-access',token_type:'Bearer',expires_in:3600}));
 assert.equal(await f.token(a),'unrotated-access');assert.equal((await row(f)).secret.refresh_token,before);
});

test('legacy pending projection is restricted to operational read custody',async()=>{
 const f=fixture();await f.complete();const binding=f.bindings.get('google-a');
 await f.custody.withAccount(binding,tx=>{const r=tx.read();return tx.write({health:'refresh_pending',secret:r.secret});});
 const operational=createEncryptedEmailCustody({encryption_key:f.key,key_id:'test-key',store:f.store,now:f.now,recover_gmail_refresh:true});
 assert.equal((await row(f)).health,'refresh_pending');assert.equal((await operational.withAccount(binding,tx=>tx.read())).health,'connected');
 assert.equal((await row(f)).health,'refresh_pending','A read projection never promotes the durable state or weakens repair readers');
});
