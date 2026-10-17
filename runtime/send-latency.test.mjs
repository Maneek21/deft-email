import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './send-latency-fixture.mjs';
import {createPreparedActions} from './prepared-actions.mjs';
const snapshot=async f=>{const scope=f.makeRequest('record_read',{}).scope;return createPreparedActions({store:f.store}).read({org_id:scope.org_id,owner_user_id:scope.owner_user_id,account_id:f.input.account_ref},f.input.snapshot_id,async()=>{});};
test('Send with realistic Host authorization latency reaches provider once within its original operation budget',async t=>{
 const f=await setup(t,{latencyMs:1100}),before=f.clock,result=await f.execute();
 console.log(JSON.stringify({scenario:'1100ms-online-authority',result,authorizations:f.authorizations,provider_send_calls:f.sendCalls,authority_time_ms:f.clock-before}));
 assert.equal(result.status,'returned');assert.equal(f.sendCalls,1);assert.ok(f.authorizations<=8);
});
test('every fresh authority boundary rejects revocation; accepted effect custody survives final disclosure denial',async t=>{
 for(const at of [1,2,3,4,5]){
  const f=await setup(t,{latencyMs:1100,authorizeOverride:(value,count)=>{if(count>=at)throw Error('synthetic revoked');return value;}});
  const result=await f.runOnce();assert.equal(f.sendCalls,at===5?1:0,'boundary '+at);assert.equal(result.status,at<=2?'not_attempted':'indeterminate');
  const retained=await snapshot(f);assert.equal(retained.state,at<=2?'prepared':at===5?'accepted':'unknown');
  if(at===5){assert.equal(retained.effect.provider_receipt.provider_message_id,'synthetic-provider-accepted');assert.equal(retained.effect.result.provider_succeeded,true);}
  await f.restart();await assert.rejects(f.execute());assert.equal(f.sendCalls,at===5?1:0);
 }
});
test('authority returned after operation deadline cannot dispatch Gmail even when lease remains valid',async t=>{
 const f=await setup(t,{latencyMs:11000}),result=await f.execute();assert.deepEqual(result,{status:'indeterminate'});assert.equal(f.sendCalls,0);assert.equal((await snapshot(f)).state,'unknown');
});
test('OAuth refresh and Send each receive independent fresh online authority under original custody',async t=>{
 const f=await setup(t,{latencyMs:1100}),session=(await f.store.withLock({key:'email.runtime.session.'+f.input.connection_session_id},tx=>tx.read())).value;
 await f.data().custody.withAccount(session.binding,async tx=>{const row=tx.read();await tx.write({health:row.health,secret:{...row.secret,expires_at:0}});});
 const tokens=f.tokenCalls;assert.equal((await f.execute()).provider_succeeded,true);assert.equal(f.tokenCalls,tokens+1);assert.equal(f.sendCalls,1);assert.equal(f.authorizations,8); // Refresh also revalidates provider identity through guarded reads.
});
test('changed authority pins at provider HTTP boundary prevent dispatch and preserve uncertainty',async t=>{
 const f=await setup(t,{latencyMs:1100,authorizeOverride:(value,count)=>count===4?{...value,session_epoch:value.session_epoch+1}:value});
 assert.deepEqual(await f.execute(),{status:'indeterminate'});assert.equal(f.sendCalls,0);assert.equal((await snapshot(f)).state,'unknown');
});
