import {consentDeadline,canonical,digest,fail,validateRegistration} from './contract.mjs';
import {validateInteractiveJob,validateJobLease,validateJobRef,localJobDigest,jobInteractiveAuthority,createJobDeadline} from './local-job-contract.mjs';
import {resolveLocalJobCalendar} from './local-job-calendar.mjs';
import {createEncryptedEmailCustody} from './vendor/providers/custody-encrypted.mjs';
import {validateOAuthClient,oauthClientFingerprint,grantedOAuthCapabilities} from './vendor/providers/oauth-provider.mjs';
import {createMailboxStore,resourceView} from './mailbox-store.mjs';
import {createDataChecker,validateDataResult} from './data-contract.mjs';
import {mailboxStatusRecord} from './mailbox-status.mjs';
import {assertNoCredentialRepair} from './credential-repair-reservation.mjs';
export const localJobRowKey=(scope,account,id)=>'email.data.local_job.'+digest([scope.org_id,scope.owner_user_id,account,id]);
const indexKey=(scope,account)=>'email.data.local_job_index.'+digest([scope.org_id,scope.owner_user_id,account]);
const catalogKey='email.data.local_job_catalog';
const authorityPins=row=>({scope:row.scope,connection:row.connection,store_key:row.store_key,record_authority:row.record_authority});
const reference=row=>({job_id:row.job_id,revision:row.revision,job_digest:row.job_digest,account_ref:row.connection.account_ref,custody_generation:row.custody_generation,due_at:row.due_at,expires_at:row.expires_at});
const snapshot=row=>({schema_version:'deft.app_local_job_schedule.v1',...authorityPins(row),operation_key:row.operation_key,resource:row.resource,job:reference(row)});
const result=(row,attempt)=>({schema_version:'deft.app_local_job_result.v1',job:reference(row),attempt_id:attempt,state:row.state==='completed'?'completed':'indeterminate',result_digest:row.state==='completed'?row.result_digest:null});
/** Local-only timers. No injected provider fetch and no provider effect path.
 * The held connection/session lock preserves mutation/custody serialization.
 * One encrypted row contains intent, local reminder and exact completion. */
export function createLocalJobRuntime({registrations,getRegistrations,client,provider='gmail',forms,store,encryption_key,key_id,assertInteractive,assertJob,assertVisibility,now=Date.now,onPhase}){
 const formMode=provider==='imap_smtp';if(formMode&&(!forms||client)||!formMode&&forms)fail('EMAIL_LOCAL_JOB_CONFIG_INVALID');
 const pins=registrations.map(({connection_protocol,...rest})=>validateRegistration(rest)),validatedClient=formMode?null:validateOAuthClient(provider,client),fingerprint=formMode?'credential_form.v1':oauthClientFingerprint(provider,validatedClient),custody=formMode?null:createEncryptedEmailCustody({store,encryption_key,key_id,now}),mailbox=createMailboxStore({store,now});
 async function within(context,deadline,work,expectedGeneration=null){
  const registration=(getRegistrations?getRegistrations().map(({connection_protocol,...r})=>validateRegistration(r)):pins).find(row=>row.org_id===context.scope.org_id&&row.runtime_registration_id===context.scope.runtime_registration_id);
  if(!registration||Object.keys(registration).some(key=>registration[key]!==context.scope[key]))fail('EMAIL_RUNTIME_REGISTRATION_DENIED');
  const withSession=work=>formMode?forms.withDataSession(context.connection,context.scope,()=>deadline.check(),work):store.withLock({key:'email.runtime.session.'+context.connection.session_id},work);
  return withSession(async sessionTx=>{
   const session=(await sessionTx.read())?.value;let generation=expectedGeneration,custody_identity=null;
   const checkLocal=()=>{deadline.local();if(consentDeadline(context.scope,'consent_expires_at')<=now()||context.record_authority&&consentDeadline(context.record_authority,'consent_expires_at')<=now())fail('EMAIL_LOCAL_JOB_EXPIRED');if(!session||session.state!=='connected'||canonical(session.scope)!==canonical(context.scope)||session.runtime_session_ref!==context.connection.runtime_session_ref||session.account?.account_ref!==context.connection.account_ref||session.binding?.account_id!==context.connection.account_ref||session.binding.provider!==provider||session.client_fingerprint!==fingerprint)fail('EMAIL_LOCAL_JOB_CONNECTION_DENIED');};
   const checkCustody=async()=>{checkLocal();let state;
    if(formMode){const account=await sessionTx.currentAccount();if(account.receipt.account_ref!==account.account_id||account.receipt.custody_generation!==account.custody_generation||account.receipt.principal_digest!=='sha256:'+account.principal_digest||account.receipt.scope_digest!==localJobDigest(context.scope))fail('EMAIL_LOCAL_JOB_CUSTODY_DENIED');state={binding:{account_id:account.account_id,provider:'imap_smtp'},health:account.state,fingerprint:'credential_form.v1',read:account.capabilities.includes('read'),generation:account.custody_generation,identity:{principal_digest:'sha256:'+account.principal_digest,receipt_digest:account.receipt.digest}};if(!/^sha256:[a-f0-9]{64}$/u.test(state.identity.principal_digest)||!/^sha256:[a-f0-9]{64}$/u.test(state.identity.receipt_digest)||custody_identity&&canonical(custody_identity)!==canonical(state.identity))fail('EMAIL_LOCAL_JOB_CUSTODY_DENIED');custody_identity??=state.identity;}
    else state=await custody.withAccount(session.binding,tx=>{const row=tx.read();return row?{binding:row.binding,health:row.health,fingerprint:row.secret?.client_fingerprint,read:grantedOAuthCapabilities(session.binding,row.secret?.scopes??[]).includes('read'),generation:row.setup_generation}:null;});
    checkLocal();if(!state||state.health!=='connected'||canonical(state.binding)!==canonical(session.binding)||state.fingerprint!==fingerprint||!state.read||!Number.isSafeInteger(state.generation)||state.generation<1||generation!==null&&state.generation!==generation)fail('EMAIL_LOCAL_JOB_CUSTODY_DENIED');generation??=state.generation;
   };
   const check=async()=>{checkLocal();await deadline.check();await checkCustody();checkLocal();};
   await check();const scope={org_id:context.scope.org_id,owner_user_id:context.scope.owner_user_id,account_id:context.connection.account_ref};
   const source=async nomination=>{if(nomination.resource_key!==context.scope.resource_key)fail('EMAIL_LOCAL_JOB_SOURCE_DENIED');const row=await mailbox.get(scope,nomination.record_id,checkLocal);if(row.deleted||resourceView(row).content_digest!==nomination.content_digest)fail('EMAIL_LOCAL_JOB_SOURCE_DENIED');return row;};
   return work({check,checkLocal,source,generation,scope,custody_identity});
  });
 }
 async function request(raw,signal){
  const request=validateInteractiveJob(raw),input=request.input,context={scope:request.scope,connection:request.connection,store_key:input.store_key,record_authority:request.record_authority},guard=createJobDeadline({expires_at:request.expires_at,assertCurrent:assertInteractive,signal,now,request:jobInteractiveAuthority(request)}),input_digest=localJobDigest({operation:request.operation,input});
  try{return await within(context,guard,async({check,source,generation,custody_identity})=>{
   if(!['list','status'].includes(request.operation))await assertNoCredentialRepair({store,scope:request.scope});
   if(request.operation==='list')return store.withLock({key:indexKey(request.scope,request.connection.account_ref)},async indexTx=>{
    const index=await indexTx.read(),rows=[];if(index&&canonical(index.value.principal)!==canonical([request.scope.org_id,request.scope.owner_user_id,request.connection.account_ref]))fail('EMAIL_LOCAL_JOB_SCOPE_DENIED');
    const ids=[...(index?.value.ids??[])].reverse();if(input.cursor!==null&&!ids.includes(input.cursor))fail('EMAIL_LOCAL_JOB_INVALID');let offset=input.cursor===null?0:ids.indexOf(input.cursor)+1;
    for(;offset<ids.length;offset++){const id=ids[offset];await check();const row=(await store.withLock({key:localJobRowKey(request.scope,request.connection.account_ref,id)},tx=>tx.read()))?.value;
     if(!row||row.schema_version!=='email.app_local_job.v1'||canonical(authorityPins(row))!==canonical(context)||row.custody_generation!==generation||formMode&&canonical(row.custody_identity)!==canonical(custody_identity)||!input.operation_keys.includes(row.operation_key))continue;
     let original;try{original=await source(row.resource);}catch(error){if(['EMAIL_LOCAL_JOB_SOURCE_DENIED','EMAIL_DATA_NOT_FOUND'].includes(error.code))continue;throw error;}
     const receipt=row.receipts.at(-1);if(!receipt)continue;
     rows.push({job:reference(row),resource:row.resource,operation_key:row.operation_key,state:row.state==='scheduled'&&Date.parse(row.expires_at)<=now()?'expired':row.state,original_request_id:receipt.request_id,presentation:{label:resourceView(original).label,detail:row.reminder_text}});
     if(rows.length===input.limit){offset++;break;}
    }
    await check();return {schema_version:'deft.app_local_job_interactive_result.v1',request_id:request.request_id,operation:'list',input_digest,state:'completed',rows,next_cursor:offset<ids.length?ids[offset-1]:null};
   });
   const id=input.job_id??input.job.job_id,rowKey=localJobRowKey(request.scope,request.connection.account_ref,id);
   return store.withLock({key:indexKey(request.scope,request.connection.account_ref)},async indexTx=>store.withLock({key:rowKey},async tx=>{
    await check();const prior=await tx.read(),row=prior?.value;if(row&&(row.schema_version!=='email.app_local_job.v1'||canonical(authorityPins(row))!==canonical(context)||row.custody_generation!==generation||formMode&&canonical(row.custody_identity)!==canonical(custody_identity)))fail('EMAIL_LOCAL_JOB_SCOPE_DENIED');
    if(request.operation==='status'){const receipt=row?.receipts.find(value=>value.request_id===input.request_id);await check();return {schema_version:'deft.app_local_job_interactive_result.v1',request_id:request.request_id,operation:request.operation,input_digest,state:receipt?'completed':'not_found',...(receipt?{job:receipt.job,job_state:receipt.state,original_input_digest:receipt.input_digest}:{} )};}
    if(row?.receipts.some(value=>value.request_id===request.request_id))fail('EMAIL_LOCAL_JOB_UUID_CONSUMED');
    let next;
    if(request.operation==='schedule'){
     if((row?.revision??null)!==input.expected_revision||row&&['firing','indeterminate','completed'].includes(row.state))fail('EMAIL_LOCAL_JOB_CONFLICT');
     const schedule=resolveLocalJobCalendar(input.value.schedule,now()),expiry=Date.parse(input.expires_at);if(schedule.instant!==input.due_at||expiry<=Date.parse(input.due_at)||expiry>Math.min(consentDeadline(request.scope,'consent_expires_at'),consentDeadline(request.record_authority,'consent_expires_at')))fail('EMAIL_LOCAL_JOB_TIME_INVALID');
     const original=await source(input.resource);next={schema_version:'email.app_local_job.v1',...context,job_id:id,revision:(row?.revision??0)+1,custody_generation:generation,...(formMode?{custody_identity}:{}),operation_key:input.operation_key,resource:input.resource,logical_message_id:original.logical_message_id,schedule,reminder_text:input.value.reminder_text,due_at:input.due_at,expires_at:input.expires_at,state:'scheduled',attempt_id:null,result_digest:null,local_result:null,receipts:row?.receipts??[],created_at:row?.created_at??new Date(now()).toISOString()};
     next.job_digest=localJobDigest({...next,receipts:[],created_at:null});
     const index=await indexTx.read(),ids=index?.value.ids??[];if(index&&canonical(index.value.principal)!==canonical([request.scope.org_id,request.scope.owner_user_id,request.connection.account_ref]))fail('EMAIL_LOCAL_JOB_SCOPE_DENIED');if(!ids.includes(id)){if(ids.length>=256)fail('EMAIL_LOCAL_JOB_LIMIT');await check();if(!await indexTx.compareAndSwap({expected_revision:index?.revision??null,value:{principal:[request.scope.org_id,request.scope.owner_user_id,request.connection.account_ref],ids:[...ids,id]}}))fail('EMAIL_LOCAL_JOB_CONFLICT');}
     // An orphan catalog/index entry has no host schedule and cannot execute.
     await store.withLock({key:catalogKey},async catalogTx=>{const saved=await catalogTx.read(),contexts=saved?.value.contexts??[],identity=value=>canonical([value.scope.org_id,value.scope.runtime_registration_id]),entry={scope:request.scope,connection:request.connection},existing=contexts.findIndex(value=>identity(value)===identity(entry));if(existing<0){if(contexts.length>=32)fail('EMAIL_LOCAL_JOB_LIMIT');contexts.push(entry);}else contexts[existing]=entry;await check();if(!await catalogTx.compareAndSwap({expected_revision:saved?.revision??null,value:{schema_version:'email.app_local_job_catalog.v1',contexts}}))fail('EMAIL_LOCAL_JOB_CONFLICT');});
    }else{
     if(!row||canonical(reference(row))!==canonical(input.job)||row.state!=='scheduled')fail('EMAIL_LOCAL_JOB_CONFLICT');next={...row,revision:row.revision+1,state:'cancelled',attempt_id:null};next.job_digest=localJobDigest([row.job_digest,next.revision,'cancelled']);
    }
    const job=reference(next);next.receipts=[...(next.receipts??[]),{request_id:request.request_id,input_digest,job,state:next.state}];if(next.receipts.length>64)fail('EMAIL_LOCAL_JOB_LIMIT');
    await check();await onPhase?.('before_schedule_commit');await check();if(!await tx.compareAndSwap({expected_revision:prior?.revision??null,value:next}))fail('EMAIL_LOCAL_JOB_CONFLICT');await onPhase?.('after_schedule_commit');await check();return {schema_version:'deft.app_local_job_interactive_result.v1',request_id:request.request_id,operation:request.operation,input_digest,state:'completed',job,job_state:next.state};
   }));
  });}finally{guard.close();}
 }
 async function execute(raw,signal){const lease=validateJobLease(raw),context=lease.schedule,deadlineRequest={schema_version:'deft.app_local_job_authority.v1',lease,phase:lease.mode==='recover'?'publish':'execute'};let phase=deadlineRequest.phase;
  const guard=createJobDeadline({expires_at:lease.lease_expires_at,signal,now,request:()=>({...deadlineRequest,phase}),assertCurrent:assertJob});
  try{return await within(context,guard,async({check,source,custody_identity})=>store.withLock({key:localJobRowKey(context.scope,context.connection.account_ref,context.job.job_id)},async tx=>{
   await assertNoCredentialRepair({store,scope:context.scope});
   await check();let stored=await tx.read(),row=stored?.value;if(!row||canonical(snapshot(row))!==canonical(context)||formMode&&canonical(row.custody_identity)!==canonical(custody_identity))fail('EMAIL_LOCAL_JOB_SCOPE_DENIED');
   if(row.state==='completed'&&row.attempt_id===lease.attempt_id){phase='publish';await check();return result(row,lease.attempt_id);}
   if(lease.mode==='recover'){if(row.attempt_id!==lease.attempt_id)fail('EMAIL_LOCAL_JOB_CONFLICT');phase='publish';await check();return result(row,lease.attempt_id);}
   if(row.state!=='scheduled'){await check();return result(row,lease.attempt_id);}
   if(Date.parse(row.due_at)>now()||Date.parse(row.expires_at)<=now())fail('EMAIL_LOCAL_JOB_NOT_DUE');await source(row.resource);
   await onPhase?.('before_firing');await check();row={...row,state:'firing',attempt_id:lease.attempt_id};if(!await tx.compareAndSwap({expected_revision:stored.revision,value:row}))fail('EMAIL_LOCAL_JOB_CONFLICT');stored=await tx.read();
   await onPhase?.('after_firing');phase='commit';await check();await source(row.resource);
   const local_result={schema_version:'email.app_local_job_completion.v1',job_id:row.job_id,revision:row.revision,operation_key:row.operation_key,record_id:row.resource.record_id,logical_message_id:row.logical_message_id,due_at:row.due_at,completed_at:new Date(now()).toISOString(),...(row.operation_key==='follow_up'?{reminder_text:row.reminder_text}:{} )};
   await onPhase?.('before_local_commit');await check();await source(row.resource);const completed={...row,state:'completed',local_result,result_digest:localJobDigest(local_result)};if(!await tx.compareAndSwap({expected_revision:stored.revision,value:completed}))fail('EMAIL_LOCAL_JOB_CONFLICT');await onPhase?.('after_local_commit');phase='publish';await check();return result(completed,lease.attempt_id);
  }),context.job.custody_generation);}finally{guard.close();}
 }
 async function visibility({scope,connection,jobs,expires_at},signal){if(!Array.isArray(jobs)||jobs.length>32||new Set(jobs.map(row=>row.job_id)).size!==jobs.length)fail('EMAIL_LOCAL_JOB_INVALID');jobs.forEach(validateJobRef);const envelope={schema_version:'deft.app_local_job_visibility.v1',scope,connection,jobs,expires_at},guard=createJobDeadline({expires_at,assertCurrent:async input=>{const response=await assertVisibility(input,signal);if(!Array.isArray(response.active_job_ids)||new Set(response.active_job_ids).size!==response.active_job_ids.length||response.active_job_ids.some(id=>!jobs.some(row=>row.job_id===id)))fail('EMAIL_LOCAL_JOB_AUTHORITY_DENIED');active=new Set(response.active_job_ids);const {active_job_ids,...rest}=response;return rest;},signal,now,request:envelope});let active=new Set();
  try{return await within({scope,connection},guard,async({check,checkLocal,source,generation,custody_identity})=>{const hidden=[];for(const ref of jobs){checkLocal();if(!active.has(ref.job_id)||ref.account_ref!==connection.account_ref||ref.custody_generation!==generation)continue;const row=(await store.withLock({key:localJobRowKey(scope,connection.account_ref,ref.job_id)},tx=>tx.read()))?.value;if(!row||canonical(reference(row))!==canonical(ref)||canonical(row.scope)!==canonical(scope)||canonical(row.connection)!==canonical(connection)||formMode&&canonical(row.custody_identity)!==canonical(custody_identity)||row.state!=='scheduled'||row.operation_key!=='snooze'||Date.parse(row.due_at)<=now()||Date.parse(row.expires_at)<=now())continue;try{await source(row.resource);}catch(error){if(error.code==='EMAIL_LOCAL_JOB_SOURCE_DENIED'||error.code==='EMAIL_DATA_NOT_FOUND')continue;throw error;}hidden.push({job_id:row.job_id,record_id:row.resource.record_id});}await check();return {hidden_record_ids:hidden.filter(row=>active.has(row.job_id)).map(row=>row.record_id)};});}finally{guard.close();}
 }
 async function contexts(){return structuredClone((await store.withLock({key:catalogKey},tx=>tx.read()))?.value.contexts??[]);}
 async function project(dataRequest,original,assertData,signal){
  if(['record_list','record_read'].includes(dataRequest.operation)&&dataRequest.input.store_key==='mailbox_status'&&original.outcome==='completed'){
   const deadline=createDataChecker({request:dataRequest,assertCurrent:assertData,signal,now}),scope=dataRequest.scope,connection=dataRequest.connection,pins={session_id:connection.session_id,runtime_session_ref:connection.runtime_session_ref,account_ref:connection.account_ref},nativeScope={org_id:scope.org_id,owner_user_id:scope.owner_user_id,account_id:connection.account_ref};
   const hiddenNow=async()=>{
    const index=(await store.withLock({key:indexKey(scope,connection.account_ref)},tx=>tx.read()))?.value;
    if(index&&(canonical(index.principal)!==canonical([scope.org_id,scope.owner_user_id,connection.account_ref])||!Array.isArray(index.ids)||index.ids.length>256))fail('EMAIL_LOCAL_JOB_SCOPE_DENIED');
    const refs=[];for(const id of index?.ids??[]){deadline.checkLocal();const row=(await store.withLock({key:localJobRowKey(scope,connection.account_ref,id)},tx=>tx.read()))?.value;if(row?.state==='scheduled'&&row.operation_key==='snooze'&&canonical(row.scope)===canonical(scope)&&Date.parse(row.due_at)>now()&&Date.parse(row.expires_at)>now())refs.push(reference(row));}
    const hidden=new Set();for(let offset=0;offset<Math.max(1,refs.length);offset+=32){const result=await visibility({scope,connection:pins,jobs:refs.slice(offset,offset+32),expires_at:new Date(deadline.expires_at).toISOString()},deadline.signal);for(const id of result.hidden_record_ids)hidden.add(id);}return [...hidden].sort();
   };
   try{await deadline.check();const hidden=await hiddenNow(),value=await mailbox.unreadSnapshot(nativeScope,hidden,deadline.check,{localCheck:deadline.checkLocal,projected:true});
    if(canonical(hidden)!==canonical(await hiddenNow()))fail('EMAIL_DATA_SOURCE_CHANGED');
    const latest=await mailbox.cacheSnapshot(nativeScope,[],deadline.checkLocal);if(latest.stamp.content_generation!==value.content_generation||latest.stamp.checkpoint_generation!==value.checkpoint_generation||latest.stamp.coverage_generation!==value.coverage_generation)fail('EMAIL_DATA_SOURCE_CHANGED');
    await deadline.check();const record=mailboxStatusRecord(nativeScope,value);let result;if(dataRequest.operation==='record_read')result={...original,record,identities:[]};else{const {value:ignored,files,...meta}=record;result={...original,items:[meta],next_cursor:null};}return validateDataResult(result,dataRequest);
   }finally{deadline.dispose();}
  }
  if(dataRequest.operation!=='resource_list'||dataRequest.input.query!=='in:inbox'||original.outcome!=='completed'||!original.items?.length)return original;
  const index=(await store.withLock({key:indexKey(dataRequest.scope,dataRequest.connection.account_ref)},tx=>tx.read()))?.value,refs=[];const ids=new Set(original.items.map(row=>row.record_id));
  for(const id of index?.ids??[]){const row=(await store.withLock({key:localJobRowKey(dataRequest.scope,dataRequest.connection.account_ref,id)},tx=>tx.read()))?.value;if(row?.state==='scheduled'&&row.operation_key==='snooze'&&ids.has(row.resource.record_id)&&canonical(row.scope)===canonical(dataRequest.scope)&&Date.parse(row.due_at)>now())refs.push(reference(row));}
  if(!refs.length)return original;if(refs.length>32)fail('EMAIL_LOCAL_JOB_VISIBILITY_OVERFLOW');
  const deadline=createDataChecker({request:dataRequest,assertCurrent:assertData,signal,now});try{await deadline.check();const pins={session_id:dataRequest.connection.session_id,runtime_session_ref:dataRequest.connection.runtime_session_ref,account_ref:dataRequest.connection.account_ref},visible=await visibility({scope:dataRequest.scope,connection:pins,jobs:refs,expires_at:dataRequest.expires_at},deadline.signal),hidden=new Set(visible.hidden_record_ids);await deadline.check();return {...original,items:original.items.filter(row=>!hidden.has(row.record_id))};}finally{deadline.dispose();}
 }
 return Object.freeze({request,execute,visibility,contexts,project});
}
