import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('hard kill after Gmail token commit resumes verification with the newest refresh token',async t=>{
 const root=await mkdtemp(join(tmpdir(),'email-refresh-crash-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const source=mode=>`
 import {createDurableStore} from ${JSON.stringify(new URL('./durable-store.mjs',import.meta.url).href)};
 import {createEncryptedEmailCustody} from ${JSON.stringify(new URL('./vendor/providers/custody-encrypted.mjs',import.meta.url).href)};
 import {createEmailOAuth} from ${JSON.stringify(new URL('./vendor/providers/oauth-account.mjs',import.meta.url).href)};
 const mode=${JSON.stringify(mode)},key=new Uint8Array(32).fill(1),now=()=>1000000;
 const store=await createDurableStore({root:${JSON.stringify(root)},encryption_key:key,key_id:'test',allow_windows_fixture:true});
 const custody=createEncryptedEmailCustody({encryption_key:key,key_id:'test',store,now});
 const scope={org_id:'org',owner_id:'owner',installation_id:'installation'};
 const binding={scope,account_id:'account',provider:'gmail',connection_target:'target',resource_binding_id:'binding',action_binding_id:null,authority_epoch:1,capabilities:['read']};
 const identity={provider_subject:'subject',primary_address:'a@example.test',verified_sender_identities:['a@example.test'],display_label:'Account'};
 const client={client_id:'client',client_secret:'secret',redirect_uri:'https://app.test/callback'};
 const {createOAuthProvider}=await import(${JSON.stringify(new URL('./vendor/providers/oauth-provider.mjs',import.meta.url).href)});
 const fingerprint=createOAuthProvider({provider:'gmail',client}).client_fingerprint;
 if(mode==='crash')await custody.withAccount(binding,tx=>tx.write({health:'connected',secret:{access_token:'old',refresh_token:'old-refresh',expires_at:0,scopes:['openid','email','https://www.googleapis.com/auth/gmail.readonly'],identity,client_fingerprint:fingerprint}}));
 const oauth=createEmailOAuth({clients:{gmail:client},custody,now,host:{resolveAccount:async()=>binding,assertAuthority:async()=>({allowed:true,expires_at:2000000})},fetch:async(url)=>{
  if(url.endsWith('/token')){if(mode!=='crash')throw Error('refresh must not replay');return Response.json({access_token:'new-access',refresh_token:'new-refresh',token_type:'Bearer',expires_in:3600});}
  if(mode==='crash'){process.stdout.write('verification-ready');await new Promise(()=>{setInterval(()=>{},1000);});}
  return Response.json(url.includes('userinfo')?{sub:'subject',email:'a@example.test',email_verified:true}:{emailAddress:'a@example.test'});
 }});
 const account={account_id:'account',provider:'gmail',display_label:'Account',primary_address:'a@example.test',verified_sender_identities:['a@example.test'],capabilities:['read'],connection_target:'target',resource_binding_id:'binding',action_binding_id:null,authority_epoch:1,health:'connected'};
 const token=await oauth.getAccessToken({scope,account,account_id:'account',operation:'read',authority_epoch:1});
 const record=await custody.withAccount(binding,tx=>tx.read());if(token!=='new-access'||record.secret.refresh_token!=='new-refresh'||record.secret.refresh_reconciliation)throw Error('credentials did not reconcile');
 await store.close();process.stdout.write('recovered');`;
 const boot=mode=>spawn(process.execPath,['--input-type=module','-e',source(mode)],{stdio:['ignore','pipe','pipe']});
 const child=boot('crash');let errors='';child.stderr.on('data',x=>errors+=x);
 await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',code=>reject(Error('child exited '+code+': '+errors)));});
 const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;
 const recovered=boot('recover');let output='';errors='';recovered.stdout.on('data',x=>output+=x);recovered.stderr.on('data',x=>errors+=x);
 const code=await new Promise(resolve=>recovered.once('exit',resolve));assert.equal(code,0,errors);assert.equal(output,'recovered');
});
