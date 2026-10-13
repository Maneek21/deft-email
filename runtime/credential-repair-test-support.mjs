import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {digestResourceSyncDescriptorV2} from '@deft/app-kit';
import {EMAIL_METADATA_DESCRIPTOR} from './vendor/metadata-resource.mjs';
import {createDurableStore} from './durable-store.mjs';
import {createConnectionRuntime} from './connection-runtime.mjs';
import {createResourceObservationRunner} from './observation-runner.mjs';
import {createReattachRuntime} from './connection-reattach-runtime.mjs';
import {createMailboxStore} from './mailbox-store.mjs';
import {createDataRuntime} from './data-runtime.mjs';
import {createEncryptedEmailCustody} from './vendor/providers/custody-encrypted.mjs';
import {reviewDigest,REATTACH_VERSION} from './reattach-contract.mjs';
import {makeScope,registrationFor,client,beginFor,nextFor,authority,twoAccountProviderFixture} from './test-support.mjs';
import {digest,canonical} from './contract.mjs';
import {reserveCredentialRepair} from './credential-repair-reservation.mjs';

export async function fixture(t){const parent=await mkdtemp(join(tmpdir(),'email-observation-')),root=join(parent,'private'),encryption_key=Buffer.alloc(32,61),key_id='observation-fixture',scope={...makeScope(),runtime_epoch:10},registration=registrationFor(scope);let store=await createDurableStore({root,encryption_key,key_id,allow_windows_fixture:process.platform==='win32'});t.after(async()=>{await store.close();await rm(parent,{recursive:true,force:true});});let providerCalls=0,allowed=true,resultCalls=0;const provider=twoAccountProviderFixture(),fetch=async(...args)=>{providerCalls++;return provider(...args);};const connection=createConnectionRuntime({registration,client,store,encryption_key,key_id,assertCurrent:authority,fetch}),begin=beginFor(scope),begun=await connection.request(begin),callback=nextFor(begin,begun,'callback');callback.callback.code='fixture-first-account';const connected=await connection.request(callback);
 const descriptor={...structuredClone(EMAIL_METADATA_DESCRIPTOR),key:'inbox'},descriptor_digest=await digestResourceSyncDescriptorV2(descriptor),claim={schema_version:'deft.app_runtime_channel.v3',audience:'app_resource_sync',work_kind:'sync_page',org_id:scope.org_id,app_installation_id:scope.installation_id,app_version_id:scope.app_version_id,grant_snapshot_id:scope.grant_snapshot_id,lifecycle_epoch:scope.lifecycle_epoch,grant_epoch:scope.grant_epoch,runtime_registration_id:scope.runtime_registration_id,resource_binding_id:scope.resource_binding_id,runtime_epoch:scope.runtime_epoch,session_id:randomUUID(),session_epoch:1,run_id:randomUUID(),attempt_id:randomUUID(),attempt_number:1,claim_token:randomUUID(),sequence:1,lease_expires_at:new Date(Date.now()+60000).toISOString(),descriptor_digest};
 const started={schema_version:claim.schema_version,audience:claim.audience,work_kind:claim.work_kind,resource_binding_id:claim.resource_binding_id,run_id:claim.run_id,attempt_id:claim.attempt_id,sequence:1,lease_expires_at:claim.lease_expires_at,descriptor_digest,descriptor,input:{schema_version:'deft.app_sync_request.v2',cursor:null,max_items:25,attachments:descriptor.attachments}};
 const snapshot={schema_version:'deft.app_resource_observation_consent.v1',consent_id:randomUUID(),scope,connection:{session_id:begin.session_id,runtime_session_ref:begun.runtime_session_ref,account_ref:connected.account.account_ref,expected_custody_generation:null,receipt_digest:null},resource_policy_digest:'sha256:'+'d'.repeat(64),interval_seconds:60,expires_at:scope.consent_expires_at};
 const authorize=async value=>{if(!allowed)throw Error('revoked');return {schema_version:'deft.app_resource_observation_authority.v1',audience:'app_resource_sync',session_id:value.session_id,run_id:value.run_id,attempt_id:value.attempt_id,claim_token:value.claim_token,sequence:value.sequence,expires_at:new Date(Date.now()+14900).toISOString(),allowed:true,consent_digest:'sha256:'+digest(snapshot),snapshot:structuredClone(snapshot)};};
 const runtime_client={async claim(){return claim;},async start(){return started;},async heartbeat(){return new Date(Date.now()+60000).toISOString();},async result(){resultCalls++;}};
 let binding=(await store.withLock({key:'email.runtime.session.'+begin.session_id},tx=>tx.read())).value.binding;let sealedGeneration=null;
 const runner=options=>createResourceObservationRunner({runtime_client,observation_client:{authorize},registration,client,store:{withLock(input,work){return store.withLock(input,tx=>work({...tx,async compareAndSwap(input){const result=await tx.compareAndSwap(input);if(result&&input.value?.schema_version==='email.app_observation_run.v1')sealedGeneration=input.value.custody_generation;return result;}}));}},encryption_key,key_id,fetch,...options});
 await createEncryptedEmailCustody({store,encryption_key,key_id}).withAccount(binding,async tx=>{while(tx.read().setup_generation<10)await tx.advanceSetup();}); binding={...binding,authority_epoch:10}; await createEncryptedEmailCustody({store,encryption_key,key_id}).withAccount(binding,async tx=>{const row=tx.read();await tx.write({health:row.health,secret:row.secret});}); await store.withLock({key:'email.runtime.session.'+begin.session_id},async tx=>{const row=await tx.read();await tx.compareAndSwap({expected_revision:row.revision,value:{...row.value,binding}});}); return {claim,started,snapshot,runner,scope,registration,begin,begun,connected,binding,fetch,key_id,encryption_key,get store(){return store;},get sealedGeneration(){return sealedGeneration;},get providerCalls(){return providerCalls;},get resultCalls(){return resultCalls;},revoke(){allowed=false;},allow(){allowed=true;},async restart(){await store.close();store=await createDurableStore({root,encryption_key,key_id,allow_windows_fixture:process.platform==='win32'});},journalKey:'email.data.request.'+digest(['email.observation.v1',registration,claim.run_id])};
}


