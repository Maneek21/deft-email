import assert from 'node:assert/strict';
import test from 'node:test';
import {publicCopyEffect,validateEmailPreparedEffect,assertEmailEffectCopy,publicEffectReceipt} from './prepared-effect.mjs';
const id='11111111-1111-4111-8111-111111111111',hash='sha256:'+'a'.repeat(64);
const copy={account_ref:'account_42',custody_generation:2,action_binding_id:id,content_digest:hash,content_bytes:10,message_id:'<fixed@example.test>',mode:'append_exact',destination:{mailbox:'Sent',uidvalidity:'42'}};
test('Email owns Sent-copy semantics and exactly maps the generic sealed effect',()=>{
 const effect=publicCopyEffect(copy);assert.deepEqual(validateEmailPreparedEffect(effect),effect);assertEmailEffectCopy(effect,copy);
 for(const change of [{message_id:'header\nmalicious'},{mode:'arbitrary'},{destination:{mailbox:'Sent',uidvalidity:'0'}},{mode:'server_managed',destination:{mailbox:'Sent',uidvalidity:'42'}}])assert.throws(()=>publicCopyEffect({...copy,...change}));
 assert.throws(()=>assertEmailEffectCopy(effect,{...copy,account_ref:'foreign'}));
 assert.throws(()=>validateEmailPreparedEffect({...effect,details:{...effect.details,mailbox:'Other'}}));
});
test('generic receipts preserve uncertain outcome, content and custody with no automatic retry',()=>{
 const effect=publicCopyEffect(copy),receipt={operation_id:id,run_id:id,attempt_id:id,account_ref:copy.account_ref,custody_generation:2,content_digest:hash,snapshot_digest:hash,transport_outcome:'accepted',copy_outcome:'unknown'};
 const result=publicEffectReceipt(receipt,effect);assert.equal(result.effect_outcome,'unknown');assert.equal(result.primary_outcome,'accepted');assert.equal(result.automatic_retry,false);assert.equal(result.plan_digest,effect.plan_digest);
 assert.throws(()=>publicEffectReceipt({...receipt,account_ref:'foreign'},effect));assert.throws(()=>publicEffectReceipt({...receipt,transport_outcome:'unknown'},effect));
});
