import {consentDeadline,canonical,digest,fail} from './contract.mjs';
import {draftCollectionKey} from './draft-store.mjs';
import {settingsCollectionKey} from './settings-store.mjs';
import {changeInputDigest,changeAuthorizationDigest,changeReference,preparedChangeDigest} from './record-change-contract.mjs';
import {buildRecordChange} from './record-change-native.mjs';
const operationStores={template_append:'templates',template_replace:'templates',signature_apply:'signatures',signature_remove:'signatures',signature_default:'signatures'};
const destinationRef=input=>changeReference({store_key:input.store_key,record_id:input.record_id,expected_revision:input.expected_revision,expected_content_digest:input.expected_content_digest});
export const recordChangeKey=(scope,id)=>'email.data.record_change.'+digest([scope.org_id,scope.owner_user_id,scope.account_id,id]);
/** Locks are sorted opaque app-owned collection IDs, then individual rows.
 * Every settings write takes the source collection. Draft CAS takes its row
 * lock, so ordinary edits cannot race validation even outside this packet. */
export async function withChangeLocks(store,scope,sourceStore,work){const keys=[draftCollectionKey(scope),settingsCollectionKey(scope,sourceStore)].sort();return store.withLock({key:keys[0]},()=>store.withLock({key:keys[1]},work));}
// Online authority is fresh at journal admission, prepared/draft commit,
// completed-journal commit and outer response disclosure. Local reads retain
// deadline, session, custody generation and verified identity checks.
export async function executeRecordChange({request,scope,session,store,drafts,settings,check,localCheck=check,identities,primary_identity=null,now=Date.now,recordView,generation}){
 const input=request.input;if(input.store_key!=='drafts'||operationStores[input.operation_key]!==input.source.store_key)fail('EMAIL_RECORD_CHANGE_INVALID');
 const base={schema_version:'deft.app_data_result.v1',request_id:request.request_id,operation:request.operation,input_digest:changeInputDigest(request),outcome:'completed'},authorization_digest=changeAuthorizationDigest(request);
 const journalKey='email.data.request.'+digest([scope,request.request_id]);
 const readSource=async()=>{const source=await settings.read(scope,input.source.store_key,input.source.record_id,localCheck);if(source.status!=='draft'||source.revision!==input.source.expected_revision||source.content_digest!==input.source.expected_content_digest)fail('EMAIL_SETTINGS_CONFLICT');if(source.store_key==='signatures'&&!identities.some(identity=>identity.address.trim().toLocaleLowerCase('en-US')===source.value.address.trim().toLocaleLowerCase('en-US')))fail('EMAIL_SETTINGS_IDENTITY_DENIED');return source;};
 const readDestination=async()=>{const destination=await drafts.read(scope,input.record_id,localCheck);if(destination.status!=='draft'||destination.revision!==input.expected_revision||'sha256:'+destination.content_digest!==input.expected_content_digest)fail('EMAIL_DRAFT_CONFLICT');return destination;};
 const boundedExpiry=()=>new Date(Math.min(now()+5*60*1000,consentDeadline(request.scope,'consent_expires_at'),...request.record_authorities.map(proof=>consentDeadline(proof,'consent_expires_at')))).toISOString();
 const validatePrepared=prepared=>{
  if(prepared.schema_version!==(input.parameters===undefined?'deft.app_prepared_record_change.v1':'deft.app_prepared_record_change.v2')||input.parameters!==undefined&&canonical(prepared.parameters)!==canonical(input.parameters)||prepared.prepared_digest!==preparedChangeDigest(prepared)||prepared.prepared_id!==input.prepared_id||prepared.prepared_digest!==input.prepared_digest||prepared.operation_key!==input.operation_key||prepared.invocation_mode!==input.invocation_mode||prepared.account_ref!==scope.account_id||prepared.authorization_digest!==authorization_digest||canonical(prepared.destination)!==canonical(destinationRef(input))||canonical(prepared.source)!==canonical(input.source)||Date.parse(prepared.expires_at)<=now())fail('EMAIL_RECORD_CHANGE_PREPARED_DENIED');
 };
 return store.withLock({key:journalKey},async tx=>{
  await check();const previous=await tx.read();
  if(previous){const journal=previous.value;if(journal.schema_version!=='email.app_mutation.v1'||canonical(journal.scope)!==canonical(scope)||canonical(journal.connection)!==canonical(request.connection)||journal.authorization_digest!==authorization_digest||journal.operation!==request.operation||journal.input_digest!==base.input_digest)fail('EMAIL_DATA_CONFLICT');await check();if(journal.state!=='completed')return {...base,outcome:'indeterminate'};if(journal.result.prepared_change&&Date.parse(journal.result.prepared_change.expires_at)<=now())fail('EMAIL_RECORD_CHANGE_PREPARED_DENIED');return structuredClone(journal.result);}
  const journal={schema_version:'email.app_mutation.v1',scope,connection:request.connection,authorization_digest,operation:request.operation,input_digest:base.input_digest,input,state:'started',result:null};
  if(!await tx.compareAndSwap({expected_revision:null,value:journal}))fail('EMAIL_DATA_CONFLICT');
  let result;
  try{result=await withChangeLocks(store,scope,input.source.store_key,async()=>{
   await localCheck();const source=await readSource();
   if(request.operation==='record_prepare_change'){
    const destination=await readDestination(),built=buildRecordChange({operation_key:input.operation_key,invocation_mode:input.invocation_mode,destination,source,identities,primary_identity,parameters:input.parameters});
    const candidate={schema_version:input.parameters===undefined?'deft.app_prepared_record_change.v1':'deft.app_prepared_record_change.v2',...(input.parameters===undefined?{}:{parameters:built.parameters,parameter_fields:built.parameter_fields}),prepared_id:request.request_id,operation_key:input.operation_key,...(input.invocation_mode?{invocation_mode:input.invocation_mode}:{}),account_ref:scope.account_id,destination:destinationRef(input),source:input.source,authorization_digest,value:built.value,preview:built.preview,expires_at:boundedExpiry()};
    candidate.prepared_digest=preparedChangeDigest(candidate);
    const saved={schema_version:'email.app_record_change.v1',scope,connection:request.connection,custody_generation:generation,prepared:candidate};
    await store.withLock({key:recordChangeKey(scope,candidate.prepared_id)},async planTx=>{await check();const row=await planTx.read();if(row)fail('EMAIL_DATA_CONFLICT');await localCheck();if(!await planTx.compareAndSwap({expected_revision:null,value:saved}))fail('EMAIL_DATA_CONFLICT');});
    await localCheck();return {...base,prepared_change:candidate};
   }
   const row=await store.withLock({key:recordChangeKey(scope,input.prepared_id)},planTx=>planTx.read());if(!row||row.value.schema_version!=='email.app_record_change.v1'||canonical(row.value.scope)!==canonical(scope)||canonical(row.value.connection)!==canonical(request.connection)||row.value.custody_generation!==generation)fail('EMAIL_RECORD_CHANGE_PREPARED_DENIED');
   const prepared=row.value.prepared;validatePrepared(prepared);if(input.operation_key==='signature_default')buildRecordChange({operation_key:input.operation_key,invocation_mode:input.invocation_mode,destination:await readDestination(),source,identities,primary_identity,parameters:input.parameters});
   const record=await drafts.applyChange(scope,input.record_id,input.expected_revision,input.expected_content_digest,prepared.value,{request_id:request.request_id,user_id:scope.owner_user_id,check:localCheck,public_input_digest:base.input_digest,prepared_digest:prepared.prepared_digest,revalidate:async()=>{await readSource();await check();validatePrepared(prepared);}});
   await localCheck();return {...base,record:recordView(record)};
  });}catch(error){if(['EMAIL_DRAFT_CONFLICT','EMAIL_SETTINGS_CONFLICT'].includes(error.code))result={...base,outcome:'conflict'};else if(['EMAIL_DRAFT_NOT_FOUND','EMAIL_SETTINGS_NOT_FOUND'].includes(error.code))result={...base,outcome:'not_found'};else throw error;}
  await check();const current=await tx.read();await localCheck();if(!await tx.compareAndSwap({expected_revision:current.revision,value:{...journal,state:'completed',result}}))fail('EMAIL_DATA_CONFLICT');await localCheck();return result;
 });
}
