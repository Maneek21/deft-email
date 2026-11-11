import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {dataInputDigest,validateDataResult} from './data-contract.mjs';
import {resourceView} from './mailbox-store.mjs';

const request=(operation='resource_refresh',input={store_key:'drafts',resource_key:'inbox'})=>({schema_version:'deft.app_data_runtime.v1',request_id:randomUUID(),operation,input,scope:{},connection:{},authority:{},expires_at:new Date(Date.now()+29000).toISOString()});
const base=r=>({schema_version:'deft.app_data_result.v1',request_id:r.request_id,operation:r.operation,input_digest:dataInputDigest(r),outcome:'completed'});
const freshness={observed_at:'2026-11-02T10:00:00.000Z',complete:false,checkpoint_generation:2,coverage_generation:1,provider_observed:true};
const item=resourceView({record_id:randomUUID(),logical_message_id:'mail_'+'a'.repeat(64),provider_revision:1,provider_source:{},revision:1,data:{subject:'Synthetic refresh row'},deleted:false,checkpoint_generation:2});

test('resource_refresh accepts the committed page with freshness, items and a mailbox cursor',()=>{
  const r=request(),result={...base(r),freshness,items:[item],next_cursor:randomUUID()};
  assert.equal(validateDataResult(result,r),result);
});

test('items are rejected on record_read and on any non-completed refresh outcome',()=>{
  const read=request('record_read',{store_key:'drafts',record_id:randomUUID()});
  assert.throws(()=>validateDataResult({...base(read),items:[item]},read),{code:'EMAIL_DATA_RESULT_INVALID'});
  const refresh=request(),refreshed={...base(refresh),outcome:'conflict',freshness,items:[item],next_cursor:null};
  assert.throws(()=>validateDataResult(refreshed,refresh),{code:'EMAIL_DATA_RESULT_INVALID'});
});

test('a refresh page is bounded to 25 rows and must carry the mailbox cursor shape',()=>{
  const r=request();
  assert.throws(()=>validateDataResult({...base(r),freshness,items:Array.from({length:26},()=>item),next_cursor:null},r),{code:'EMAIL_DATA_RESULT_INVALID'});
  assert.throws(()=>validateDataResult({...base(r),freshness,items:[item],next_cursor:'gmail-native-v1:opaque-provider-token'},r),{code:'EMAIL_DATA_RESULT_INVALID'});
  assert.equal(validateDataResult({...base(r),freshness,items:[item],next_cursor:null},r).next_cursor,null);
});
