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


async function retained(f,secret){const r=await f.custody.withAccount(f.bindings.get('google-a'),tx=>tx.read());assert.equal(r.health,'refresh_pending');assert.deepEqual(r.secret,secret);assert.equal(JSON.stringify([...f.store.rows.values()]).includes(secret.refresh_token),false);return r;}
async function noRetry(f,a){const n=f.calls.length;await assert.rejects(f.token(a),code('EMAIL_OAUTH_REAUTH_REQUIRED'));assert.equal(f.calls.length,n);}
test('lost refresh response retains encrypted credentials and blocks retry',async()=>{const f=fixture(),a=await f.complete(),s=(await f.custody.withAccount(f.bindings.get('google-a'),tx=>tx.read())).secret;f.advance(100000);f.setRefreshMode(()=>{throw Error('lost');});await assert.rejects(f.token(a),code('EMAIL_OAUTH_PROVIDER_UNAVAILABLE'));await retained(f,s);await noRetry(f,a);});
test('authority expiry after refresh preserves original custody and blocks retry',async()=>{const f=fixture(),a=await f.complete(),s=(await f.custody.withAccount(f.bindings.get('google-a'),tx=>tx.read())).secret;f.advance(100000);f.setAfterFetch(({init})=>{if(init.body instanceof URLSearchParams&&init.body.get('grant_type')==='refresh_token')f.expire();});await assert.rejects(f.token(a),code('EMAIL_OAUTH_AUTHORITY_DENIED'));await retained(f,s);f.setAfterFetch(null);});
test('verified identity mismatch preserves credentials without health promotion',async()=>{const f=fixture(),a=await f.complete(),s=(await f.custody.withAccount(f.bindings.get('google-a'),tx=>tx.read())).secret;f.advance(100000);f.setSubject('different');await assert.rejects(f.token(a),code('EMAIL_OAUTH_RECONNECT_IDENTITY_CHANGED'));await retained(f,s);await noRetry(f,a);});
test('explicit invalid_grant discards credentials and blocks refresh replay',async()=>{const f=fixture(),a=await f.complete();f.advance(100000);f.setRefreshMode(()=>response({error:'invalid_grant'},400));await assert.rejects(f.token(a),code('EMAIL_OAUTH_REAUTH_REQUIRED'));const r=await f.custody.withAccount(f.bindings.get('google-a'),tx=>tx.read());assert.equal(r.health,'reauth_required');assert.equal(r.secret.refresh_token,'discarded');assert.equal(r.secret.access_token,'discarded');await noRetry(f,a);});
