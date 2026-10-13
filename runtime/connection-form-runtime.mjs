import {uuid} from './draft-store.mjs';
import {randomBytes,randomUUID} from 'node:crypto';
import {canonical,digest,fail,exact} from './contract.mjs';
import {FORM_VERSION,FORM_LIMITS,validateFormRequest,formRegistration,formIdentity,sameFormPins,validateCredentialInput,credentialPrincipal,formReceiptDigest} from './connection-form-contract.mjs';

const sessionKey=id=>'email.imap.form.session.'+id;
const custodyKey=(scope,id)=>'email.imap.custody.'+digest([scope.org_id,scope.owner_user_id,id]);
const scopeDomain=scope=>digest(scope);
const publicAccount=row=>({account_ref:row.account_id,address:row.profile.primary_address,label:row.profile.display_label,capabilities:row.capabilities,identity_assurance:'owner_declared_authenticated'});
const result=(request,state,additional={})=>({schema_version:FORM_VERSION,session_id:request.session_id,state,...additional});
/** Passwords enter only submit(), called by the runtime's own trusted origin.
 * Host/operator requests can never contain credentials. All persistent rows use
 * the existing independently operated encrypted durable store, not host keys. */
export function createConnectionFormRuntime({registrations,store,setup_origin,assertCurrent,connector,endpointPolicy,policy_digest,now=Date.now,onPhase=async()=>{}}){
 const origin=new URL(setup_origin);if(origin.protocol!=='https:'||origin.username||origin.password||origin.port||origin.pathname!=='/'||origin.search||origin.hash||!/^sha256:[a-f0-9]{64}$/u.test(policy_digest)||typeof endpointPolicy!=='function')fail('EMAIL_FORM_CONFIG_INVALID');
 const admitted=registrations.map(formRegistration);if(!admitted.length||admitted.length>32||new Set(admitted.map(value=>canonical([value.org_id,value.runtime_registration_id]))).size!==admitted.length)fail('EMAIL_FORM_CONFIG_INVALID');
 async function current(request,operation,signal,deadline=Date.parse(request.expires_at)){
  signal?.throwIfAborted();if(!Number.isFinite(deadline)||deadline<=now()||deadline>Date.parse(request.scope.consent_expires_at)||deadline>now()+(operation==='submit'?60000:30000))fail('EMAIL_FORM_AUTHORITY_DENIED');
  const pins=admitted.find(value=>value.org_id===request.scope.org_id&&value.runtime_registration_id===request.scope.runtime_registration_id);if(!pins||Object.keys(pins).some(key=>pins[key]!==request.scope[key]))fail('EMAIL_FORM_REGISTRATION_DENIED');
  const call={...request,schema_version:'deft.app_connection_form_authority.v1',operation,expires_at:new Date(deadline).toISOString()};const response=await assertCurrent(call,signal);
  exact(response,[...Object.keys(call),'allowed']);if(response.allowed!==true||canonical({...response,allowed:undefined})!==canonical({...call,allowed:undefined})||deadline<=now())fail('EMAIL_FORM_AUTHORITY_DENIED');signal?.throwIfAborted();return deadline;
 }
 const readSession=id=>store.withLock({key:sessionKey(id)},tx=>tx.read());
 async function checkedSession(request,signal){await current(request,request.operation,signal);const row=await readSession(request.session_id);if(!row||row.value.policy_digest!==policy_digest||!sameFormPins(row.value.request,request)||request.runtime_session_ref!==null&&row.value.runtime_session_ref!==request.runtime_session_ref)fail('EMAIL_FORM_SESSION_DENIED');return row;}
 function view(request,row){
  if(row.state==='connected'&&row.receipt)return result(request,'connected',{runtime_session_ref:row.runtime_session_ref,input_consumed:true,account:row.account,receipt:row.receipt});
  if(row.state==='disconnected')return result(request,'disconnected',{runtime_session_ref:row.runtime_session_ref,input_consumed:row.input_consumed,account:row.account,receipt:row.receipt});
  if(row.state==='awaiting_input'&&!row.input_consumed&&Date.parse(row.input_expires_at)>now())return result(request,'awaiting_input',{runtime_session_ref:row.runtime_session_ref,input_consumed:false,receipt:null,setup_expires_at:row.input_expires_at});
  return result(request,row.state==='not_connected'?'not_connected':'indeterminate',{runtime_session_ref:row.runtime_session_ref,input_consumed:row.input_consumed,account:null,receipt:null});
 }
 async function begin(request,signal){if(Date.parse(request.setup_expires_at)<=now()||Date.parse(request.setup_expires_at)>now()+300000)fail('EMAIL_FORM_INPUT_INVALID');await current(request,'begin',signal);return store.withLock({key:'email.imap.form.domain.'+scopeDomain(request.scope)},async()=>store.withLock({key:sessionKey(request.session_id)},async tx=>{
  const existing=await tx.read();if(existing){if(!sameFormPins(existing.value.request,request))fail('EMAIL_FORM_SESSION_DENIED');return view(request,existing.value);}
  // The domain reservation does not expire after any input was consumed.
  const domainKey='email.imap.form.reservation.'+scopeDomain(request.scope),prior=await store.withLock({key:domainKey},t=>t.read());
  if(prior){const old=await readSession(prior.value.session_id);if(old&&old.value.state!=='not_connected'&&old.value.state!=='disconnected'&&!(request.source?.session_id===prior.value.session_id&&old.value.state==='connected'))fail('EMAIL_FORM_DOMAIN_RESERVED');}
  let source=null;if(request.source){source=await readSession(request.source.session_id);if(!source||source.value.state!=='connected'||canonical(source.value.request.scope)!==canonical(request.source.scope)||source.value.runtime_session_ref!==request.source.runtime_session_ref||source.value.account.account_ref!==request.source.account_ref||['org_id','owner_user_id','installation_id','operator_user_id','target_key','resource_key'].some(key=>request.source.scope[key]!==request.scope[key]))fail('EMAIL_FORM_SOURCE_DENIED');}
  const account_id=source?.value.account.account_ref??randomUUID(),ticket=randomBytes(32).toString('base64url'),runtime_session_ref=randomBytes(32).toString('base64url'),input_expires_at=request.setup_expires_at;
  const row={schema_version:'email.imap.form_session.v1',request,identity:formIdentity(request),runtime_session_ref,account_id,state:'awaiting_input',input_consumed:false,input_expires_at,ticket_digest:digest(ticket),browser:null,account:null,receipt:null,policy_digest};
  // Reserve the current account before the form is disclosed; an uncertain or
  // pending SMTP/APPEND/Organize journal cannot acquire a second authority.
  if(source)await store.withLock({key:custodyKey(request.scope,account_id)},async accountTx=>{const account=await accountTx.read();if(!account||account.value.state!=='connected'||account.value.pending_transition||account.value.pending_effect)fail('EMAIL_FORM_SOURCE_BUSY');if(!await accountTx.compareAndSwap({expected_revision:account.revision,value:{...account.value,pending_transition:request.session_id}}))fail('EMAIL_FORM_CONFLICT');});
  await current(request,'begin',signal);if(!await tx.compareAndSwap({expected_revision:null,value:row}))fail('EMAIL_FORM_CONFLICT');
  await store.withLock({key:domainKey},async t=>{const held=await t.read();if(!await t.compareAndSwap({expected_revision:held?.revision??null,value:{session_id:request.session_id}}))fail('EMAIL_FORM_CONFLICT');});await current(request,'begin',signal);
  return {...view(request,row),setup_url:origin.origin+'/setup#'+ticket};
 }));}
 async function exchange(ticket,signal){if(typeof ticket!=='string'||!/^[A-Za-z0-9_-]{43}$/u.test(ticket))fail('EMAIL_FORM_TICKET_DENIED');
  // Ticket index is encrypted and cannot enumerate credential/session data.
  const index=await store.withLock({key:'email.imap.form.ticket.'+digest(ticket)},tx=>tx.read());if(!index)fail('EMAIL_FORM_TICKET_DENIED');
  return store.withLock({key:sessionKey(index.value.session_id)},async tx=>{const row=await tx.read(),value=row?.value;if(!value||value.ticket_digest!==digest(ticket)||value.browser||value.input_consumed||Date.parse(value.input_expires_at)<=now())fail('EMAIL_FORM_TICKET_DENIED');
   await current({...value.request,runtime_session_ref:value.runtime_session_ref},'status',signal,Math.min(now()+30000,Date.parse(value.request.scope.consent_expires_at)));
   const browser=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');if(!await tx.compareAndSwap({expected_revision:row.revision,value:{...value,browser:{cookie_digest:digest(browser),csrf_digest:digest(csrf)}}}))fail('EMAIL_FORM_CONFLICT');return {browser,csrf,session_id:value.request.session_id,expires_at:value.input_expires_at};});
 }
 async function submit({session_id,browser,csrf,value},signal){const profile=validateCredentialInput(value);try{return await store.withLock({key:sessionKey(session_id)},async tx=>{const row=await tx.read(),session=row?.value;
  if(!session||session.policy_digest!==policy_digest||session.state!=='awaiting_input'||session.input_consumed||Date.parse(session.input_expires_at)<=now()||session.browser?.cookie_digest!==digest(browser)||session.browser?.csrf_digest!==digest(csrf))fail('EMAIL_FORM_SUBMIT_DENIED');
  const deadline=Math.min(now()+60000,Date.parse(session.input_expires_at),Date.parse(session.request.scope.consent_expires_at),...session.request.action_consents.map(consent=>Date.parse(consent.expires_at))),request={...session.request,runtime_session_ref:session.runtime_session_ref};
  const check=()=>current(request,'submit',signal,deadline);await check();const hasSend=session.request.action_consents.some(consent=>consent.action_key==='send_message');if(profile.smtp&&!hasSend)fail('EMAIL_FORM_SMTP_NOT_GRANTED');
  if(!endpointPolicy(profile))fail('EMAIL_IMAP_ENDPOINT_DENIED');const principal=credentialPrincipal(request.scope,profile);
  const before=await store.withLock({key:custodyKey(request.scope,session.account_id)},t=>t.read());if(request.source&&(!before||before.value.pending_transition!==session_id||before.value.principal_digest!==principal||before.value.pending_effect))fail('EMAIL_FORM_SOURCE_DENIED');
  if(!await tx.compareAndSwap({expected_revision:row.revision,value:{...session,input_consumed:true,state:'submit_started'}}))fail('EMAIL_FORM_CONFLICT');await onPhase('submit_started');
  try{await connector.probe(profile,{signal,expires_at:deadline,check});await check();}catch(error){const currentRow=await tx.read();await tx.compareAndSwap({expected_revision:currentRow.revision,value:{...currentRow.value,state:'indeterminate'}});throw error;}
  const generation=(before?.value.custody_generation??0)+1;if(generation>2147483646)fail('EMAIL_FORM_CONFLICT');const capabilities=['read','search','thread',...(hasSend&&profile.smtp?['send']:[]),...(request.action_consents.some(consent=>consent.action_key==='organize_messages')?['modify']:[])];
  // Do not publish a password-derived digest (offline dictionary oracle). A
  // random credential-instance nonce binds the encrypted custody commit.
  const credential_instance_id=randomBytes(32).toString('hex'),visibleProfile={...profile,imap:{...profile.imap,password:undefined},smtp:profile.smtp?{...profile.smtp,password:undefined}:null};
  const receipt={schema_version:'deft.app_connection_form_receipt.v1',account_ref:session.account_id,custody_generation:generation,principal_digest:'sha256:'+principal,custody_digest:'sha256:'+digest({profile:visibleProfile,credential_instance_id,policy_digest,source:request.source,purposes:request.action_consents,generation}),scope_digest:'sha256:'+digest(request.scope),committed_at:new Date(now()).toISOString()};receipt.digest=formReceiptDigest(receipt);
  const lineage=[...(before?.value.lineage??[]),...(before?[{generation:before.value.custody_generation,receipt:before.value.receipt,session_id:request.source.session_id}]:[])];
  const account={schema_version:'email.imap.custody.v1',account_id:session.account_id,scope:request.scope,state:'connected',profile,credential_instance_id,principal_digest:principal,custody_generation:generation,authority_epoch:generation,connection_revision:generation,capabilities,action_consents:request.action_consents,pending_transition:null,pending_effect:null,receipt,lineage};
  await store.withLock({key:custodyKey(request.scope,session.account_id)},async accountTx=>{const currentRow=await accountTx.read();if((currentRow?.revision??null)!==(before?.revision??null))fail('EMAIL_FORM_CONFLICT');await check();if(!await accountTx.compareAndSwap({expected_revision:currentRow?.revision??null,value:account}))fail('EMAIL_FORM_CONFLICT');});await onPhase('custody_committed');await check();
  const currentRow=await tx.read(),complete={...currentRow.value,state:'connected',account:publicAccount(account),receipt};if(!await tx.compareAndSwap({expected_revision:currentRow.revision,value:complete}))fail('EMAIL_FORM_CONFLICT');await onPhase('session_committed');await check();return view(request,complete);
 });}finally{profile.imap.password='';if(profile.smtp)profile.smtp.password='';if(value?.imap)value.imap.password='';if(value?.smtp)value.smtp.password='';}}
 async function status(request,signal){let row=await checkedSession(request,signal);if(row.value.state==='awaiting_input'&&!row.value.input_consumed&&Date.parse(row.value.input_expires_at)<=now()&&!request.source){row=await store.withLock({key:sessionKey(request.session_id)},async tx=>{const found=await tx.read();if(found.value.state==='awaiting_input'&&!found.value.input_consumed){await tx.compareAndSwap({expected_revision:found.revision,value:{...found.value,state:'not_connected'}});return tx.read();}return found;});}await current(request,'status',signal);return view(request,row.value);}
 async function disconnect(request,signal){await checkedSession(request,signal);return store.withLock({key:sessionKey(request.session_id)},async tx=>{const row=await tx.read();if(row.value.state!=='connected')return view(request,row.value);await store.withLock({key:custodyKey(request.scope,row.value.account_id)},async accountTx=>{const account=await accountTx.read();if(!account||account.value.pending_transition||account.value.pending_effect)fail('EMAIL_FORM_SOURCE_BUSY');await current(request,'disconnect',signal);await accountTx.compareAndSwap({expected_revision:account.revision,value:{...account.value,state:'revoked',custody_generation:account.value.custody_generation+1}});});const next={...row.value,state:'disconnected'};if(!await tx.compareAndSwap({expected_revision:row.revision,value:next}))fail('EMAIL_FORM_CONFLICT');return view(request,next);});}
 async function checkedAccount(session,scope,check,operation_id=null){await check();if(!session||session.policy_digest!==policy_digest||session.state!=='connected'||canonical(session.request.scope)!==canonical(scope))fail('EMAIL_IMAP_ACCESS_DENIED');const row=await store.withLock({key:custodyKey(scope,session.account_id)},tx=>tx.read());if(!row||row.value.state!=='connected'||row.value.pending_transition||row.value.pending_effect&&row.value.pending_effect.operation_id!==operation_id||canonical(row.value.scope)!==canonical(scope)||row.value.receipt.digest!==session.receipt.digest)fail('EMAIL_IMAP_ACCESS_DENIED');await check();return structuredClone(row.value);}
 return Object.freeze({async request(raw,signal){const request=validateFormRequest(raw);if(request.operation==='begin'){const answer=await begin(request,signal);if(answer.setup_url){const ticket=new URL(answer.setup_url).hash.slice(1);await store.withLock({key:'email.imap.form.ticket.'+digest(ticket)},async tx=>{if(!await tx.compareAndSwap({expected_revision:null,value:{session_id:request.session_id}}))fail('EMAIL_FORM_CONFLICT');});}return answer;}return request.operation==='status'?status(request,signal):disconnect(request,signal);},exchange,submit,
  async currentAccount(session_id,scope,check){const session=await readSession(session_id);return checkedAccount(session?.value,scope,check);},
  /** Hold the actual form session through data disclosure. Nested native
   * custody checks reuse this held immutable session rather than deadlocking
   * by reacquiring its encrypted-store lock. */
  async withDataSession(connection,scope,check,work){return store.withLock({key:sessionKey(connection.session_id)},async tx=>{const session=(await tx.read())?.value,account=await checkedAccount(session,scope,check);if(session.runtime_session_ref!==connection.runtime_session_ref||account.account_id!==connection.account_ref)fail('EMAIL_IMAP_ACCESS_DENIED');
   const projection={state:'connected',scope,runtime_session_ref:session.runtime_session_ref,account:session.account,binding:{account_id:account.account_id,provider:'imap_smtp'},client_fingerprint:'credential_form.v1'};
   const result=await work({read:async()=>({value:projection}),currentAccount:()=>checkedAccount(session,scope,check)});await checkedAccount(session,scope,check);return result;});},
  async withInspectionStatus(connection,scope,operation_id,check,proof,work){if(!uuid(operation_id)||typeof proof!=='function')fail('EMAIL_IMAP_ACCESS_DENIED');return store.withLock({key:sessionKey(connection.session_id)},async tx=>{const session=(await tx.read())?.value,read=()=>checkedAccount(session,scope,check,operation_id),account=await read();if(session.runtime_session_ref!==connection.runtime_session_ref||account.account_id!==connection.account_ref||!await proof(account))fail('EMAIL_IMAP_ACCESS_DENIED');const result=await work({currentAccount:read});await read();return result;});},
  /** Dedicated original-journal read inspection; it cannot reserve an effect. */
  async withInspectionSession(connection,scope,operation_id,check,proof,work){if(!uuid(operation_id)||typeof proof!=='function')fail('EMAIL_IMAP_ACCESS_DENIED');return store.withLock({key:sessionKey(connection.session_id)},async tx=>{
   const session=(await tx.read())?.value,read=()=>checkedAccount(session,scope,check,operation_id),account=await read();
   if(session.runtime_session_ref!==connection.runtime_session_ref||account.account_id!==connection.account_ref||account.pending_effect?.operation_id!==operation_id||!await proof(account,'admit'))fail('EMAIL_IMAP_ACCESS_DENIED');
   return work({currentAccount:read,releaseKnown:async()=>{await check();if(!await proof(await read(),'release'))fail('EMAIL_IMAP_ACCESS_DENIED');await store.withLock({key:custodyKey(scope,account.account_id)},async custodyTx=>{const held=await custodyTx.read();if(!held||held.value.custody_generation!==account.custody_generation||held.value.receipt.digest!==account.receipt.digest||held.value.pending_transition||held.value.pending_effect?.operation_id!==operation_id)fail('EMAIL_IMAP_ACCESS_DENIED');if(!await custodyTx.compareAndSwap({expected_revision:held.revision,value:{...held.value,pending_effect:null}}))fail('EMAIL_FORM_CONFLICT');});await check();}});
  });},
  /** Only an exact released operation may inspect its own durable effect fence.
   * No data reader or transition can nominate this operation-id exemption. */
  async withEffectSession(connection,scope,operation_id,check,work){return store.withLock({key:sessionKey(connection.session_id)},async tx=>{
   const session=(await tx.read())?.value,read=()=>checkedAccount(session,scope,check,operation_id),account=await read();
   if(session.runtime_session_ref!==connection.runtime_session_ref||account.account_id!==connection.account_ref)fail('EMAIL_IMAP_ACCESS_DENIED');
   const change=async(reserve)=>store.withLock({key:custodyKey(scope,account.account_id)},async custodyTx=>{
    await check();const held=await custodyTx.read();if(!held||held.value.custody_generation!==account.custody_generation||held.value.receipt.digest!==account.receipt.digest||held.value.pending_transition||held.value.pending_effect&&held.value.pending_effect.operation_id!==operation_id)fail('EMAIL_IMAP_ACCESS_DENIED');
    if(!await custodyTx.compareAndSwap({expected_revision:held.revision,value:{...held.value,pending_effect:reserve?{operation_id,state:'started'}:null}}))fail('EMAIL_FORM_CONFLICT');await check();});
   return work({currentAccount:read,reserve:()=>change(true),releaseKnown:()=>change(false)});
  });},
 });
}
