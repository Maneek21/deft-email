import test from 'node:test';
import assert from 'node:assert/strict';
import {validateScope, canonical} from './contract.mjs';
import {makeScope} from './test-support.mjs';
import {createDataChecker} from './data-contract.mjs';
import {createRuntimeChannelRenewal} from './runtime-channel-renewal.mjs';

const persistentScope=()=>({...makeScope(),consent_expires_at:null,consent_lifetime:'until_revoked'});
test('explicit until-revoked scope is valid without changing finite scope bytes',()=>{
 const finite=makeScope(),before=canonical(finite);
 assert.equal(canonical(validateScope(finite)),before);
 const persistent=persistentScope();assert.deepEqual(validateScope(persistent),persistent);
});
test('absent, unknown, or mixed lifetime never turns a missing deadline into authority',()=>{
 for(const scope of [{...makeScope(),consent_expires_at:null},{...makeScope(),consent_lifetime:'until_revoked'},{...persistentScope(),consent_lifetime:'forever'},{...persistentScope(),consent_expires_at:undefined}])assert.throws(()=>validateScope(scope));
});
test('persistent permission still requires a finite fresh data authority and honors denial',async()=>{
 let now=Date.parse('2046-10-15T12:00:00Z'),allowed=true,calls=0;
 const request={scope:persistentScope(),expires_at:new Date(now+20000).toISOString(),operation:'record_read',request_id:'fixture',input:{store_key:'drafts'},connection:{},authority:{}};
 const checker=createDataChecker({request,now:()=>now,assertCurrent:async value=>{calls++;return {...value,allowed};}});
 try{assert.equal(await checker.check(),now+20000);assert.equal(calls,1);allowed=false;await assert.rejects(checker.check());now+=20001;assert.throws(()=>checker.checkLocal());}finally{checker.dispose();}
});
test('persistent permission cannot turn an invalid per-call deadline into an unbounded request',()=>{
 for(const expires_at of [null,undefined,'invalid'])assert.throws(()=>createDataChecker({request:{scope:persistentScope(),expires_at},now:Date.now,assertCurrent:async value=>({...value,allowed:true})}));
});
test('persistent technical renewal keeps finite leases and rejects changed authority',async()=>{
 const now=Date.now(),session_id='fixture-session';let nextMode='until_revoked',calls=0;
 const channel={channel_url:'https://host.example/runtime',credential:{session_id,session_token:'fixture'},registration:{},technical_renewal:{expires_at:new Date(now+60000).toISOString(),renewable_until:null,renewal_lifetime:'until_revoked'}};
 const renewal=createRuntimeChannelRenewal({channel,now:()=>now,runtime_client:{claim:async()=>({claimed:true}),renew:async()=>{calls++;return {session_id,expires_at:new Date(now+120000).toISOString(),renewable_until:null,renewal_lifetime:nextMode};}}});
 try{assert.equal(await renewal.renew(new AbortController().signal),true);assert.equal(calls,1);assert.deepEqual(await renewal.client.claim(),{claimed:true});nextMode='finite';assert.equal(await renewal.renew(new AbortController().signal),false);assert.equal(await renewal.client.claim(),null);}finally{renewal.close();}
});

test('persistent technical delegation never admits a missing or oversized technical lease',async()=>{
 const now=Date.now(),metadata={expires_at:new Date(now+60000).toISOString(),renewable_until:null,renewal_lifetime:'until_revoked'};
 const channel={channel_url:'https://host.example/runtime',credential:{session_id:'fixture',session_token:'fixture'},registration:{},technical_renewal:metadata};
 const client={claim:async()=>({claimed:true}),renew:async()=>({session_id:'fixture',...metadata,expires_at:new Date(now+900001).toISOString()})};
 for(const expiry of [null,undefined,new Date(now+900001).toISOString()])assert.throws(()=>createRuntimeChannelRenewal({channel:{...channel,technical_renewal:{...metadata,expires_at:expiry}},runtime_client:client,now:()=>now}));
 const renewal=createRuntimeChannelRenewal({channel,runtime_client:client,now:()=>now});
 try{assert.equal(await renewal.renew(new AbortController().signal),false);assert.equal(await renewal.client.claim(),null);}finally{renewal.close();}
});
