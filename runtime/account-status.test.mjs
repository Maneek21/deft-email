import assert from 'node:assert/strict';
import test from 'node:test';
import {checkConnectionStatus} from './account-status.mjs';

const connected=async()=>({state:'connected'});

test('a reauth observation overrides a stale connected connection record',async()=>{
  const status=await checkConnectionStatus(connected,{last_observation:'EMAIL_PROVIDER_REAUTH_REQUIRED'});
  assert.deepEqual(status,{state:'reauth_required',label:'Needs reconnect',action:'reconnect'});
  assert.notEqual(status.label,'Connected');
});

test('a transient custody observation reports unavailable-retry, never reconnect or Connected',async()=>{
  const status=await checkConnectionStatus(connected,{last_observation:'EMAIL_OAUTH_CUSTODY_UNAVAILABLE'});
  assert.equal(status.state,'custody_unavailable');
  assert.notEqual(status.label,'Connected');
  assert.equal(status.action,'retry');
  assert.notEqual(status.action,'reconnect');
});

test('without an observation the re-read context state is reported honestly',async()=>{
  assert.deepEqual(await checkConnectionStatus(connected),{state:'connected',label:'Connected',action:null});
  assert.deepEqual(await checkConnectionStatus(async()=>({health:'revoked'})),{state:'revoked',label:'Access revoked',action:null});
  assert.deepEqual(await checkConnectionStatus(async()=>({health:'reauth_required'})),{state:'reauth_required',label:'Needs reconnect',action:null});
});

test('a reauth observation wins even when the context is already connected and never surfaces a raw code',async()=>{
  const status=await checkConnectionStatus(async()=>({state:'connected'}),{last_observation:'EMAIL_PROVIDER_REAUTH_REQUIRED'});
  assert.equal(status.state,'reauth_required');
  assert.equal(status.action,'reconnect');
});
