import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {AppDataRuntimeRequestSchema} from '@deft/app-kit/core';
import {makeScope} from './test-support.mjs';
import {validateDataRequest} from './data-contract.mjs';
import {validateChangeRequest} from './record-change-contract.mjs';
import {uuid as draftUuid} from './draft-store.mjs';
const v5='11111111-1111-5111-8111-111111111111',hash='sha256:'+'a'.repeat(64);
function request(){return {schema_version:'deft.app_data_runtime.v1',request_id:randomUUID(),scope:makeScope(),connection:{session_id:v5,session_revision:1,runtime_session_ref:'fixture-ref',account_ref:'fixture-account'},authority:{consent_id:randomUUID(),consent_digest:hash,data_policy_digest:hash},operation:'resource_list',input:{store_key:'drafts',resource_key:'inbox',cursor:null,limit:10,query:'in:inbox'},expires_at:new Date(Date.now()+29000).toISOString()};}
test('Host connection UUID versions accepted by the public data schema remain valid at Runtime',()=>{
 const q=request();assert.equal(AppDataRuntimeRequestSchema.safeParse(q).success,true);assert.deepEqual(validateDataRequest(q),q);q.connection.session_id=randomUUID();assert.deepEqual(validateDataRequest(q),q);
 for(const bad of ['invalid','11111111-1111-5111-0111-111111111111','11111111-1111-0111-8111-111111111111']){q.connection.session_id=bad;assert.throws(()=>validateDataRequest(q),{code:'EMAIL_DATA_INPUT_INVALID'});}
});
test('Host UUIDv5 record-change connection keeps source and destination draft references strict',()=>{
 const q=request();q.schema_version='deft.app_data_runtime.v2';delete q.authority;q.operation='record_prepare_change';q.input={store_key:'drafts',record_id:randomUUID(),expected_revision:1,expected_content_digest:hash,operation_key:'template_append',source:{store_key:'templates',record_id:randomUUID(),expected_revision:1,expected_content_digest:hash}};q.record_authorities=['destination','source'].map((role,index)=>({role,store_key:index?'templates':'drafts',consent_id:randomUUID(),consent_digest:hash,data_policy_digest:hash,consent_expires_at:q.scope.consent_expires_at}));assert.deepEqual(validateChangeRequest(q),q);q.connection.session_id='bad';assert.throws(()=>validateChangeRequest(q),{code:'EMAIL_DATA_INPUT_INVALID'});q.connection.session_id=v5;q.input.record_id=v5;assert.throws(()=>validateChangeRequest(q),{code:'EMAIL_DATA_INPUT_INVALID'});
});
test('draft identifiers remain UUIDv4 while Host connection UUIDs accept UUIDv5',()=>{assert.equal(draftUuid(v5),false);assert.equal(draftUuid(randomUUID()),true);});
