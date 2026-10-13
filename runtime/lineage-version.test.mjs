import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './consent-continuation-fixture.mjs';
import {client,authority,registrationFor,twoAccountProviderFixture} from './test-support.mjs';
import {createCredentialRepairRuntime} from './connection-credential-repair-runtime.mjs';
import {createConsentContinuationRuntime} from './connection-consent-continuation-runtime.mjs';
import {createReattachRuntime} from './connection-reattach-runtime.mjs';
import {createUpgradeRuntime} from './connection-upgrade-runtime.mjs';
import {commitCredentialRepairLineage,commitCredentialRepairClosureLineage} from './credential-repair-lineage.mjs';
import {repairReviewDigest,REPAIR_VERSION} from './credential-repair-contract.mjs';
import {continuationReviewDigest,CONTINUATION_VERSION} from './consent-continuation-contract.mjs';
import {reviewDigest,REATTACH_V2_VERSION} from './reattach-contract.mjs';
import {upgradeReviewDigest,UPGRADE_VERSION} from './upgrade-contract.mjs';
import {lineageKey,validateLineage,lineageVersion} from './account-lineage.mjs';
const originalFetch=globalThis.fetch;
test.before(()=>{globalThis.fetch=async()=>{throw Error('FIXTURE_PROVIDER_NETWORK_DENIED');};});
test.after(()=>{globalThis.fetch=originalFetch;});

// All OAuth responses are in-process synthetic fixtures. No provider transport
// is permitted, and none of these connection operations sends a message.
async function chain(t,{closeRepair=false}={}){
 const f=await fixture(t,{readOnly:true}),store=f.store,provider=twoAccountProviderFixture();
 const deps={store,client,encryption_key:Buffer.alloc(32,59),key_id:'reattach-test',assertCurrent:authority,fetch:provider};
 const session=id=>store.withLock({key:'email.runtime.session.'+id},async tx=>(await tx.read()).value);
 let current=await session(f.id);
 const request=(version,target=current.scope)=>({schema_version:version,session_id:randomUUID(),scope:target,source:{scope:current.scope,session_id:current.session_id,session_revision:5,runtime_session_ref:current.runtime_session_ref,account_ref:current.account.account_ref},transport_digest:'sha256:'+'1'.repeat(64),review_expires_at:new Date(Date.now()+300000).toISOString(),expires_at:new Date(Date.now()+29000).toISOString(),operation:'prepare',action_consents:[]});
 const reviewed=async(runtime,raw,digest,keys=['account','custody_generation','custody_digest'])=>{const eligible=await runtime.request(raw),fields=Object.fromEntries(keys.map(k=>[k,eligible[k]]));return {...fields,digest:digest(raw,fields)};};
 const repair=createCredentialRepairRuntime({...deps,registration:registrationFor(current.scope),inspectPublication:async()=> 'sha256:'+'7'.repeat(64),assertHostAcknowledgement:async()=>{},commitRepair:input=>commitCredentialRepairLineage({...input,store}),commitClosure:input=>commitCredentialRepairClosureLineage({...input,store})});
 const raw={...request(REPAIR_VERSION),historical_attempts:[],publication_continuity_digest:null},review=await reviewed(repair,raw,repairReviewDigest,['account','custody_generation','custody_digest','fence']);
 const begun=await repair.request({...raw,operation:'begin',review,callback_state:'c'.repeat(43)});
 if(closeRepair){
  const denied=await repair.request({...raw,operation:'callback',review,runtime_session_ref:begun.runtime_session_ref,callback:{outcome:'denied'}});
  await repair.request({...raw,operation:'status',review,runtime_session_ref:begun.runtime_session_ref,acknowledged_closure:{session_id:raw.session_id,session_revision:5,receipt_digest:denied.closure.receipt_digest}});
  current=await session(current.session_id);
  const row=await store.withLock({key:lineageKey(current.binding)},tx=>tx.read());
  return {lineage:row.value,current};
 }
 const connected=await repair.request({...raw,operation:'callback',review,runtime_session_ref:begun.runtime_session_ref,callback:{outcome:'authorized',code:'fixture-first-account-both'}});
 await repair.request({...raw,operation:'status',review,runtime_session_ref:connected.runtime_session_ref,acknowledged_receipt:{session_id:raw.session_id,session_revision:5,receipt_digest:connected.receipt_digest}});
 current=await session(raw.session_id);
 const continuation=createConsentContinuationRuntime({...deps,registration:registrationFor(current.scope)}),continued=request(CONTINUATION_VERSION,{...current.scope,consent_expires_at:new Date(Date.parse(current.scope.consent_expires_at)+3600000).toISOString()});
 continued.source.action_consents=[];
 await continuation.request({...continued,operation:'activate',review:await reviewed(continuation,continued,continuationReviewDigest)});current=await session(continued.session_id);
 const next={...current.scope,app_version_id:randomUUID(),grant_snapshot_id:randomUUID(),resource_binding_id:randomUUID(),runtime_registration_id:randomUUID(),lifecycle_epoch:current.scope.lifecycle_epoch+1,grant_epoch:current.scope.grant_epoch+1};
 const reattach=createReattachRuntime({...deps,registration:registrationFor(next)}),retained=request(REATTACH_V2_VERSION,next);
 await reattach.request({...retained,operation:'activate',review:await reviewed(reattach,retained,reviewDigest)});current=await session(retained.session_id);
 const upgraded=request(UPGRADE_VERSION,{...current.scope,profile_digest:'sha256:'+'2'.repeat(64),resource_binding_id:randomUUID(),runtime_registration_id:randomUUID()});
 const upgrade=createUpgradeRuntime({...deps,registration:registrationFor(upgraded.scope)}),upgradeReview=await reviewed(upgrade,upgraded,upgradeReviewDigest);
 const awaiting=await upgrade.request({...upgraded,operation:'begin',review:upgradeReview,callback_state:'d'.repeat(43)});
 await upgrade.request({...upgraded,operation:'callback',review:upgradeReview,runtime_session_ref:awaiting.runtime_session_ref,callback:{outcome:'authorized',code:'fixture-first-account'}});current=await session(upgraded.session_id);
 const row=await store.withLock({key:lineageKey(current.binding)},tx=>tx.read());
 return {lineage:row.value,current,store,key:lineageKey(current.binding),revision:row.revision};
}

test('lineage version survives real repair, continuation, retained reattach and OAuth upgrade writers',async t=>{
 const f=await chain(t);
 assert.deepEqual(f.lineage.receipts.map(r=>r.kind),['credential_repair','consent_continuation','retained_reattach_v2','oauth_upgrade']);
 assert.equal(f.lineage.schema_version,'email.runtime.account_lineage.v4');
 validateLineage(f.lineage,f.current);
 const before=structuredClone(f.lineage);
 for(const schema_version of ['email.runtime.account_lineage.v2','email.runtime.account_lineage.v3']){
  const retained={...structuredClone(f.lineage),schema_version},original=structuredClone(retained);
  assert.equal(validateLineage(retained,f.current).schema_version,'email.runtime.account_lineage.v4');
  assert.deepEqual(retained,original);
 }
 assert.deepEqual(f.lineage,before);
 assert.deepEqual(await f.store.withLock({key:f.key},tx=>tx.read()),{revision:f.revision,value:before});
});

test('lineage version recovery still rejects corrupt digests, chain, generation, scope and unknown history',async t=>{
 const f=await chain(t);
 const corrupt=[
  x=>x.schema_version='email.runtime.account_lineage.v99',
  x=>x.schema_version='email.runtime.account_lineage.v1',
  x=>x.receipts[0]=null,
  x=>x.receipts[0].kind='unreviewed_unknown_kind',
  x=>x.receipts[0].receipt_digest='sha256:'+'0'.repeat(64),
  x=>x.receipts[1].source_session_id=randomUUID(),
  x=>x.receipts[0].custody_generation++,
  x=>x.receipts[2].pins.source.scope.owner_user_id=randomUUID(),
  x=>x.receipts.pop(),
  x=>x.closed_repairs=null,
  x=>x.closed_repairs=[null],
  x=>x.closed_repairs=[{kind:'credential_repair_closure'}]
 ];
 for(const mutate of corrupt){const retained={...structuredClone(f.lineage),schema_version:'email.runtime.account_lineage.v2'};mutate(retained);assert.throws(()=>validateLineage(retained,f.current),{code:'EMAIL_DATA_SOURCE_CHANGED'});}
});

test('lineage version requires v4 for closed repairs even without repair receipts',async t=>{
 const f=await chain(t,{closeRepair:true});
 assert.deepEqual(f.lineage.receipts,[]);
 const retained={...structuredClone(f.lineage),schema_version:'email.runtime.account_lineage.v2'},before=structuredClone(retained);
 assert.equal(validateLineage(retained,f.current).schema_version,'email.runtime.account_lineage.v4');
 assert.deepEqual(retained,before);
 const corrupted=structuredClone(retained);corrupted.closed_repairs[0].closure.receipt_digest='sha256:'+'0'.repeat(64);
 assert.throws(()=>validateLineage(corrupted,f.current),{code:'EMAIL_DATA_SOURCE_CHANGED'});
 const envelope={schema_version:'email.runtime.account_lineage.v2',receipts:[],closed_repairs:[{kind:'credential_repair_closure'}]};
 assert.equal(lineageVersion(envelope),'email.runtime.account_lineage.v4');
 // Version inference alone cannot admit incomplete or fabricated closure proof.
 assert.throws(()=>validateLineage(envelope,f.current),{code:'EMAIL_DATA_SOURCE_CHANGED'});
 assert.deepEqual(envelope,{schema_version:'email.runtime.account_lineage.v2',receipts:[],closed_repairs:[{kind:'credential_repair_closure'}]});
});
