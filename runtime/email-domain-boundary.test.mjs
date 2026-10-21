import assert from 'node:assert/strict';
import test from 'node:test';
import {AppDataResultSchema} from '@deft/app-kit/core';
import {validateDataResult,dataInputDigest} from './data-contract.mjs';
const id='11111111-1111-4111-8111-111111111111';
test('generic principal admission never substitutes for Email mailbox validation',()=>{
 const request={request_id:id,operation:'connection_metadata',input:{store_key:'drafts'}},result={schema_version:'deft.app_data_result.v1',request_id:id,operation:request.operation,input_digest:dataInputDigest(request),outcome:'completed',identities:[{address:'warehouse:west',label:'Warehouse'}]};
 assert.ok(AppDataResultSchema.safeParse(result).success);assert.throws(()=>validateDataResult(result,request),{code:'EMAIL_DATA_RESULT_INVALID'});
 assert.ok(validateDataResult({...result,identities:[{address:'sender@example.test',label:'Sender'}]},request));
});
