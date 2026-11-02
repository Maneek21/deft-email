import assert from 'node:assert/strict';
import test from 'node:test';
import {connectionHealthLabel} from './account-registry.mjs';
import {connectionStatusNode,reconnectActionNode,restoreAccessReviewNode,connectionSettingsNodes,restoreAccessCalls,reconnectCall} from './settings-ui.mjs';

const installationId='11111111-1111-4111-8111-111111111111';
const targetKey='personal_mailbox';

test('a reauth-required account shows "Needs reconnect", never a stale "Connected"',()=>{
  assert.equal(connectionHealthLabel('reauth_required'),'Needs reconnect');
  assert.equal(connectionHealthLabel('connected'),'Connected');
  assert.equal(connectionHealthLabel('revoked'),'Access revoked');
  assert.equal(connectionHealthLabel('unavailable'),'Unavailable');
  assert.equal(connectionHealthLabel('nonsense'),null);
  assert.equal(connectionStatusNode('reauth_required').text,'Needs reconnect');
  assert.notEqual(connectionStatusNode('reauth_required').text,'Connected');
  assert.equal(connectionStatusNode('connected').text,'Connected');
  assert.equal(connectionStatusNode('nonsense').text,'Status unavailable');
});

test('the settings node list carries the honest status and both recovery actions',()=>{
  const nodes=connectionSettingsNodes({health:'reauth_required',installation_id:installationId,target_key:targetKey});
  assert.deepEqual(nodes.map(node=>node.id),['connection_status','reconnect','restore_access']);
  const status=nodes.find(node=>node.id==='connection_status');
  const reconnect=nodes.find(node=>node.id==='reconnect');
  const restore=nodes.find(node=>node.id==='restore_access');
  assert.equal(status.text,'Needs reconnect');
  assert.equal(status.tone,'caption');
  assert.equal(reconnect.kind,'button');
  assert.equal(reconnect.label,'Reconnect');
  assert.equal(restore.kind,'button');
  assert.equal(restore.label,'Restore access');
});

test('the Reconnect action dispatches the Host reattach review',()=>{
  const node=reconnectActionNode({installation_id:installationId,target_key:targetKey});
  assert.deepEqual(node.connection_action,{kind:'reconnect',installation_id:installationId,target_key:targetKey});
  assert.deepEqual(reconnectCall({installation_id:installationId,target_key:targetKey}),{method:'POST',path:'/api/app-connection-sessions/reattach/review'});
});

test('the Restore access action dispatches restore-context, restore/review and restore/activate',()=>{
  const node=restoreAccessReviewNode({installation_id:installationId,target_key:targetKey});
  assert.deepEqual(node.connection_action,{kind:'restore_access',installation_id:installationId,target_key:targetKey});
  assert.deepEqual(restoreAccessCalls({installation_id:installationId,target_key:targetKey}),[
    {method:'GET',path:`/api/app-connection-sessions/installations/${installationId}/restore-context`},
    {method:'POST',path:'/api/app-connection-sessions/restore/review'},
    {method:'POST',path:'/api/app-connection-sessions/restore/activate'},
  ]);
});

test('recovery actions reject malformed ids and free text',()=>{
  assert.throws(()=>reconnectActionNode({installation_id:'not-a-uuid',target_key:targetKey}),/EMAIL_CONNECTION_ACTION_INVALID/);
  assert.throws(()=>restoreAccessReviewNode({installation_id:installationId,target_key:'Bad Target Key!'}),/EMAIL_CONNECTION_ACTION_INVALID/);
  assert.throws(()=>restoreAccessCalls({installation_id:installationId,target_key:'Bad Target Key!'}),/EMAIL_CONNECTION_ACTION_INVALID/);
});
