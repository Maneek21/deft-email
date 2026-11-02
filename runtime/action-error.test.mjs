import assert from 'node:assert/strict';
import test from 'node:test';
import {parseNextStep, actionForRuntimeError, NEXT_STEP_KINDS} from './action-error.mjs';

const installationId='11111111-1111-4111-8111-111111111111';
const targetKey='personal_mailbox';

test('a Host 403 with a valid restore_access next_step yields the matching action',()=>{
  const body={error:'The app access check was denied for your current account.',code:'APP_ACCESS_DENIED',details:{next_step:{kind:'restore_access',installation_id:installationId,target_key:targetKey}}};
  assert.deepEqual(parseNextStep(body),{kind:'restore_access',label:'Restore access',installation_id:installationId,target_key:targetKey});
});

test('a valid reconnect next_step yields the reconnect action',()=>{
  const body={error:'…',code:'APP_REVIEW_REQUIRED',details:{next_step:{kind:'reconnect',installation_id:installationId,target_key:targetKey}}};
  assert.deepEqual(parseNextStep(body),{kind:'reconnect',label:'Reconnect',installation_id:installationId,target_key:targetKey});
});

test('a review_consent next_step is on-enum and maps to a review action',()=>{
  const body={code:'APP_REVIEW_REQUIRED',details:{next_step:{kind:'review_consent',installation_id:installationId,target_key:targetKey}}};
  assert.deepEqual(parseNextStep(body),{kind:'review_consent',label:'Review access',installation_id:installationId,target_key:targetKey});
});

test('malformed or off-enum next_step is dropped',()=>{
  assert.equal(parseNextStep(null),null);
  assert.equal(parseNextStep({}),null);
  assert.equal(parseNextStep({code:'APP_ACCESS_DENIED'}),null);
  assert.equal(parseNextStep({code:'APP_ACCESS_DENIED',details:{}}),null);
  assert.equal(parseNextStep({code:'APP_ACCESS_DENIED',details:{next_step:null}}),null);
  assert.equal(parseNextStep({code:'APP_ACCESS_DENIED',details:{next_step:{kind:'free_text',installation_id:installationId,target_key:targetKey}}}),null);
  assert.equal(parseNextStep({code:'APP_ACCESS_DENIED',details:{next_step:{kind:'restore_access',installation_id:'not-a-uuid',target_key:targetKey}}}),null);
  assert.equal(parseNextStep({code:'APP_ACCESS_DENIED',details:{next_step:{kind:'restore_access',installation_id:installationId,target_key:'Bad Target Key!'}}}),null);
  assert.equal(parseNextStep({code:'APP_ACCESS_DENIED',details:{next_step:{kind:'restore_access',installation_id:installationId,target_key:targetKey,extra:'raw callback data'}}}),null);
});

test('EMAIL_PROVIDER_REAUTH_REQUIRED maps to reconnect',()=>{
  assert.deepEqual(actionForRuntimeError('EMAIL_PROVIDER_REAUTH_REQUIRED'),{kind:'reconnect',label:'Reconnect'});
});

test('transient EMAIL_OAUTH_CUSTODY_UNAVAILABLE maps to retry, not reconnect',()=>{
  const action=actionForRuntimeError('EMAIL_OAUTH_CUSTODY_UNAVAILABLE');
  assert.equal(action.kind,'retry');
  assert.notEqual(action.kind,'reconnect');
  assert.equal(actionForRuntimeError('EMAIL_RUNTIME_UNAVAILABLE'),null);
  assert.equal(actionForRuntimeError('EMAIL_PROVIDER_RESPONSE_INVALID'),null);
});

test('the next_step enum is fixed and closed',()=>{
  assert.deepEqual([...NEXT_STEP_KINDS].sort(),['reconnect','restore_access','review_consent']);
});
