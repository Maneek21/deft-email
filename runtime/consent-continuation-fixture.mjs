import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {createDurableStore} from './durable-store.mjs';
import {createRegistrationDispatcher} from './registration-dispatch.mjs';
import {createDataRuntime} from './data-runtime.mjs';
import {createHttpHandler} from './http.mjs';
import {createPreparedActions} from './prepared-actions.mjs';
import {sealPurposeSet,purposeFor} from './purpose-set.mjs';
import {createOwnedSourceResolver,validateLineage,lineageKey} from './account-lineage.mjs';
import {canonical,digest} from './contract.mjs';
import {CONTINUATION_VERSION as REATTACH_VERSION,continuationReviewDigest as reviewDigest} from './consent-continuation-contract.mjs';
import {makeScope,registrationFor,client,authority,beginFor,nextFor,twoAccountProviderFixture} from './test-support.mjs';
const empty={mode:'compose',to:'target@example.test',cc:'',bcc:'',subject:'Unsent',body:'Exact unsent\n',body_html:'',reply_record_id:'',attachments:[]};
const legacyAction=scope=>({action_binding_id:randomUUID(),action_key:'send_message',authority_epoch:scope.runtime_epoch,consent_id:randomUUID(),consent_digest:'sha256:'+'d'.repeat(64),expires_at:scope.consent_expires_at});
const upgraded=scope=>({...scope,app_version_id:randomUUID(),grant_snapshot_id:randomUUID(),resource_binding_id:randomUUID(),runtime_registration_id:randomUUID(),lifecycle_epoch:scope.lifecycle_epoch+1,grant_epoch:scope.grant_epoch+1});
const actions=scope=>['mirror_drafts','organize_messages','send_message'].map(action_key=>{const id=randomUUID();return {action_key,action_binding_id:id,consent_id:id,authority_epoch:scope.runtime_epoch,consent_digest:'sha256:'+'d'.repeat(64),expires_at:scope.consent_expires_at};});
export async function fixture(t,{readOnly=false}={}){
 const root=await mkdtemp(join(tmpdir(),'email-reattach-e3-')),key=Buffer.alloc(32,59),scopes=[makeScope()];let store,runtime,data,calls=0,allowed=true,crash=null;const provider=twoAccountProviderFixture(),fetch=async(...args)=>{calls++;return provider(...args);};
 const open=async()=>{store=await createDurableStore({root,encryption_key:key,key_id:'reattach-test',allow_windows_fixture:process.platform==='win32'});const wrapped={withLock(options,work){return store.withLock(options,tx=>work({...tx,async compareAndSwap(input){const result=await tx.compareAndSwap(input);if(crash?.(options,input)){crash=null;throw Error('synthetic committed-write crash');}return result;}}));}},deps={store:wrapped,client,encryption_key:key,key_id:'reattach-test',fetch,assertCurrent:authority,assertV2Current:authority};runtime=createRegistrationDispatcher({...deps,registrations:scopes.map(scope=>({...registrationFor(scope),connection_protocol:'v2'})),assertReattachCurrent:async request=>({...request,allowed}),assertContinuationCurrent:async request=>({...request,allowed})});data=createDataRuntime({...deps,registrations:scopes.map(scope=>({...registrationFor(scope),connection_protocol:'v2'}))});};await open();
 const begin={...beginFor(scopes[0]),schema_version:'deft.app_connection_runtime.v2',action_consents:readOnly?[]:actions(scopes[0])},begun=await runtime.request(begin),callback={...begin,operation:'callback',runtime_session_ref:begun.runtime_session_ref,callback:{outcome:'authorized',code:'fixture-first-account-both'}};delete callback.callback_state;const connected=await runtime.request(callback);let session_id=begin.session_id,runtime_session_ref=begun.runtime_session_ref,currentScope=scopes[0],account=connected.account;
 const dataRequest=(operation,input)=>({schema_version:'deft.app_data_runtime.v1',request_id:randomUUID(),scope:currentScope,connection:{session_id,session_revision:5,runtime_session_ref,account_ref:account.account_ref},authority:{consent_id:randomUUID(),consent_digest:'sha256:'+'e'.repeat(64),data_policy_digest:'sha256:'+'f'.repeat(64)},operation,expires_at:new Date(Date.now()+29000).toISOString(),input});
 const next=async(send=false)=>{const source=(await store.withLock({key:'email.runtime.session.'+session_id},tx=>tx.read())).value;const target={...currentScope,consent_expires_at:new Date(Date.parse(currentScope.consent_expires_at)+3600000).toISOString()};const request={schema_version:REATTACH_VERSION,session_id:randomUUID(),scope:target,source:{session_id,session_revision:5,scope:currentScope,runtime_session_ref,account_ref:account.account_ref,action_consents:source.action_consents},transport_digest:'sha256:'+'1'.repeat(64),review_expires_at:new Date(Date.now()+60000).toISOString(),expires_at:new Date(Date.now()+29000).toISOString(),operation:'prepare',action_consents:source.action_consents.map(a=>({...a,consent_digest:'sha256:'+'2'.repeat(64),expires_at:target.consent_expires_at}))};return request;};
 const prepare=async request=>{const value=await runtime.request(request);const {schema_version,session_id,state,...eligibility}=value;return {...request,operation:'activate',review:{...eligibility,digest:reviewDigest(request,eligibility)}};};
 const activate=async request=>{const value=await runtime.request(request);currentScope=request.scope;session_id=request.session_id;runtime_session_ref=value.runtime_session_ref;return value;};
 t.after(async()=>{await store.close();await rm(root,{recursive:true,force:true});});return {get store(){return store;},get sourceScope(){return scopes[0];},get runtime(){return runtime;},get data(){return data;},get calls(){return calls;},get scope(){return currentScope;},get id(){return session_id;},get account(){return account;},get ref(){return runtime_session_ref;},dataRequest,next,prepare,activate,deny(){allowed=false;},failWrite(predicate){crash=predicate;},async restart(){await store.close();await open();}};
}

