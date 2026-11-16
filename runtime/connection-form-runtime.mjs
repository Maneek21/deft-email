import {uuid} from './draft-store.mjs';
import {randomBytes,randomUUID} from 'node:crypto';
import {consentDeadline,canonical,digest,fail,exact} from './contract.mjs';
import {FORM_VERSION,FORM_LIMITS,validateFormRequest,formRegistration,formIdentity,sameFormPins,validateCredentialInput,credentialPrincipal,formReceiptDigest} from './connection-form-contract.mjs';
import {PROBE_REJECTIONS} from './imap-connector.mjs';

const sessionKey=id=>'email.imap.form.session.'+id;
const reservationKey=scope=>'email.imap.form.reservation.'+digest(scope);
// A refused or unreachable login check stores nothing, so the owner may correct
// the details. Retries are bounded per setup page and per owner and connection
// target per hour (IMAP and SMTP checks alike) so the form cannot be used to
// guess a mailbox password. The hourly budget is keyed on org, owner and target,
// not on the mailbox typed and not on the Host's authority scope: either of
// those changes freely (another username, a renewed consent, an app upgrade) and
// would reset it.
export const FORM_RETRY=Object.freeze({tries_per_session:3,failures_per_window:5,window_ms:3600000});
const rejected=new Set(PROBE_REJECTIONS),retryable=code=>{throw Object.assign(new Error(code),{code,retry:true});};
const custodyKey=(scope,id)=>'email.imap.custody.'+digest([scope.org_id,scope.owner_user_id,id]);
const scopeDomain=scope=>digest(scope);
const publicAccount=row=>({account_ref:row.account_id,address:row.profile.primary_address,label:row.profile.display_label,capabilities:row.capabilities,identity_assurance:'owner_declared_authenticated'});
const result=(request,state,additional={})=>({schema_version:FORM_VERSION,session_id:request.session_id,state,...additional});
/** Passwords enter only submit(), called by the runtime's own trusted origin.
 * Host/operator requests can never contain credentials. All persistent rows use
 * the existing independently operated encrypted durable store, not host keys. */
export function createConnectionFormRuntime({registrations,registrationBook,store,setup_origin,assertCurrent,connector,endpointPolicy,policy_digest,now=Date.now,onPhase=async()=>{}}){
 const origin=new URL(setup_origin);if(origin.protocol!=='https:'||origin.username||origin.password||origin.port||origin.pathname!=='/'||origin.search||origin.hash||!/^sha256:[a-f0-9]{64}$/u.test(policy_digest)||typeof endpointPolicy!=='function')fail('EMAIL_FORM_CONFIG_INVALID');
 const admitted=registrations.map(formRegistration);if(!admitted.length&&!registrationBook||admitted.length>32||new Set(admitted.map(value=>canonical([value.org_id,value.runtime_registration_id]))).size!==admitted.length)fail('EMAIL_FORM_CONFIG_INVALID');
 async function current(request,operation,signal,deadline=Date.parse(request.expires_at)){
  signal?.throwIfAborted();if(!Number.isFinite(deadline)||deadline<=now()||deadline>consentDeadline(request.scope,'consent_expires_at')||deadline>now()+(operation==='submit'?60000:30000))fail('EMAIL_FORM_AUTHORITY_DENIED');
  const pins=admitted.find(value=>value.org_id===request.scope.org_id&&value.runtime_registration_id===request.scope.runtime_registration_id);
  // A registration outside the configured pins is served only through an
  // explicitly configured registration book, and a new one only after this
  // very call has had the Host confirm it (see registration-book.mjs).
  const decision=pins?(Object.keys(pins).some(key=>pins[key]!==request.scope[key])?'denied':'known'):registrationBook?registrationBook.decide(request.scope):'denied';
  if(decision!=='known'&&!(decision==='ask_host'&&['begin','status'].includes(operation)))fail('EMAIL_FORM_REGISTRATION_DENIED');
  const call={...request,schema_version:'deft.app_connection_form_authority.v1',operation,expires_at:new Date(deadline).toISOString()};const response=await assertCurrent(call,signal);
  exact(response,[...Object.keys(call),'allowed']);if(response.allowed!==true||canonical({...response,allowed:undefined})!==canonical({...call,allowed:undefined})||deadline<=now())fail('EMAIL_FORM_AUTHORITY_DENIED');signal?.throwIfAborted();
  if(decision==='ask_host')await registrationBook.confirm(request.scope);return deadline;
 }
 const readSession=id=>store.withLock({key:sessionKey(id)},tx=>tx.read());
 async function checkedSession(request,signal){await current(request,request.operation,signal);const row=await readSession(request.session_id);if(!row||row.value.policy_digest!==policy_digest||!sameFormPins(row.value.request,request)||request.runtime_session_ref!==null&&row.value.runtime_session_ref!==request.runtime_session_ref)fail('EMAIL_FORM_SESSION_DENIED');return row;}
 function view(request,row){
  if(row.state==='connected'&&row.receipt)return result(request,'connected',{runtime_session_ref:row.runtime_session_ref,input_consumed:true,account:row.account,receipt:row.receipt});
  if(row.state==='disconnected')return result(request,'disconnected',{runtime_session_ref:row.runtime_session_ref,input_consumed:row.input_consumed,account:row.account,receipt:row.receipt});
  if(row.state==='awaiting_input'&&!row.input_consumed&&Date.parse(row.input_expires_at)>now())return result(request,'awaiting_input',{runtime_session_ref:row.runtime_session_ref,input_consumed:false,receipt:null,setup_expires_at:row.input_expires_at});
  return result(request,row.state==='not_connected'?'not_connected':'indeterminate',{runtime_session_ref:row.runtime_session_ref,input_consumed:row.input_consumed,account:null,receipt:null});
 }
 // One budget per owner and connection target, for IMAP and SMTP checks alike. A
 // check is charged before the server is contacted, so concurrent pages cannot
 // overshoot it, and refunded once the login check succeeded.
 const failureKey=scope=>'email.imap.form.failures.'+digest([scope.org_id,scope.owner_user_id,scope.target_key]);
 const chargeAttempt=key=>store.withLock({key},async tx=>{const held=await tx.read(),recent=(held?.value.failures??[]).filter(at=>at>now()-FORM_RETRY.window_ms);if(recent.length>=FORM_RETRY.failures_per_window)fail('EMAIL_FORM_ATTEMPTS_EXCEEDED');const at=now();if(!await tx.compareAndSwap({expected_revision:held?.revision??null,value:{...(held?.value??{}),failures:[...recent,at]}}))fail('EMAIL_FORM_CONFLICT');return at;});
 const refundAttempt=(key,at)=>store.withLock({key},async tx=>{const held=await tx.read(),failures=[...(held?.value.failures??[])],index=failures.indexOf(at);if(index<0)return;failures.splice(index,1);await tx.compareAndSwap({expected_revision:held.revision,value:{...held.value,failures}});});
 /** A replacement attempt reserves the stored account (pending_transition) from
  * begin until it commits. If the attempt can no longer commit and the account's
  * generation is still the one it started from, nothing was replaced: release the
  * reservation so the account works again and may be replaced later. Returns
  * false when the account moved on or is reserved by a different attempt. */
 const releaseReplacement=(scope,account_id,session_id,generation)=>store.withLock({key:custodyKey(scope,account_id)},async tx=>{const account=await tx.read();
  if(!account||!Number.isInteger(generation)||account.value.custody_generation!==generation||account.value.pending_effect||![session_id,null].includes(account.value.pending_transition))return false;
  if(account.value.pending_transition===session_id&&!await tx.compareAndSwap({expected_revision:account.revision,value:{...account.value,pending_transition:null}}))fail('EMAIL_FORM_CONFLICT');return true;});
 async function begin(request,signal){if(Date.parse(request.setup_expires_at)<=now()||Date.parse(request.setup_expires_at)>now()+300000)fail('EMAIL_FORM_INPUT_INVALID');await current(request,'begin',signal);return store.withLock({key:'email.imap.form.domain.'+scopeDomain(request.scope)},async()=>store.withLock({key:sessionKey(request.session_id)},async tx=>{
  const existing=await tx.read();if(existing){if(!sameFormPins(existing.value.request,request))fail('EMAIL_FORM_SESSION_DENIED');return view(request,existing.value);}
  // The domain reservation does not expire after any input was consumed.
  const domainKey=reservationKey(request.scope),prior=await store.withLock({key:domainKey},t=>t.read());
  if(prior){const old=await readSession(prior.value.session_id);if(old&&old.value.state!=='not_connected'&&old.value.state!=='disconnected'&&!(request.source?.session_id===prior.value.session_id&&old.value.state==='connected'))fail('EMAIL_FORM_DOMAIN_RESERVED');}
  let source=null;if(request.source){source=await readSession(request.source.session_id);if(!source||source.value.state!=='connected'||canonical(source.value.request.scope)!==canonical(request.source.scope)||source.value.runtime_session_ref!==request.source.runtime_session_ref||source.value.account.account_ref!==request.source.account_ref||['org_id','owner_user_id','installation_id','operator_user_id','target_key','resource_key'].some(key=>request.source.scope[key]!==request.scope[key]))fail('EMAIL_FORM_SOURCE_DENIED');}
  const account_id=source?.value.account.account_ref??randomUUID(),ticket=randomBytes(32).toString('base64url'),runtime_session_ref=randomBytes(32).toString('base64url'),input_expires_at=request.setup_expires_at;
  const row={schema_version:'email.imap.form_session.v1',request,identity:formIdentity(request),runtime_session_ref,account_id,state:'awaiting_input',input_consumed:false,input_expires_at,ticket_digest:digest(ticket),browser:null,account:null,receipt:null,policy_digest};
  // Reserve the current account before the form is disclosed; an uncertain or
  // pending SMTP/APPEND/Organize journal cannot acquire a second authority.
  // The generation seen here lets status() later prove whether this attempt ever
  // replaced the stored account, and so whether its reservation may be released.
  if(source)row.source_custody_generation=await store.withLock({key:custodyKey(request.scope,account_id)},async accountTx=>{const account=await accountTx.read();if(!account||account.value.state!=='connected'||account.value.pending_transition||account.value.pending_effect)fail('EMAIL_FORM_SOURCE_BUSY');if(!await accountTx.compareAndSwap({expected_revision:account.revision,value:{...account.value,pending_transition:request.session_id}}))fail('EMAIL_FORM_CONFLICT');return account.value.custody_generation;});
  await current(request,'begin',signal);if(!await tx.compareAndSwap({expected_revision:null,value:row}))fail('EMAIL_FORM_CONFLICT');
  await store.withLock({key:domainKey},async t=>{const held=await t.read();if(!await t.compareAndSwap({expected_revision:held?.revision??null,value:{...(held?.value??{}),session_id:request.session_id}}))fail('EMAIL_FORM_CONFLICT');});await current(request,'begin',signal);
  return {...view(request,row),setup_url:origin.origin+'/setup#'+ticket};
 }));}
 async function exchange(ticket,signal){if(typeof ticket!=='string'||!/^[A-Za-z0-9_-]{43}$/u.test(ticket))fail('EMAIL_FORM_TICKET_DENIED');
  // Ticket index is encrypted and cannot enumerate credential/session data.
  const index=await store.withLock({key:'email.imap.form.ticket.'+digest(ticket)},tx=>tx.read());if(!index)fail('EMAIL_FORM_TICKET_DENIED');
  return store.withLock({key:sessionKey(index.value.session_id)},async tx=>{const row=await tx.read(),value=row?.value;if(!value||value.ticket_digest!==digest(ticket)||value.browser||value.input_consumed||Date.parse(value.input_expires_at)<=now())fail('EMAIL_FORM_TICKET_DENIED');
   await current({...value.request,runtime_session_ref:value.runtime_session_ref},'status',signal,Math.min(now()+30000,consentDeadline(value.request.scope,'consent_expires_at')));
   const browser=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');if(!await tx.compareAndSwap({expected_revision:row.revision,value:{...value,browser:{cookie_digest:digest(browser),csrf_digest:digest(csrf)}}}))fail('EMAIL_FORM_CONFLICT');return {browser,csrf,session_id:value.request.session_id,expires_at:value.input_expires_at};});
 }
 async function submit({session_id,browser,csrf,value},signal){const profile=validateCredentialInput(value);let consumed=false;try{return await store.withLock({key:sessionKey(session_id)},async tx=>{const row=await tx.read(),session=row?.value;
  if(!session||session.policy_digest!==policy_digest||session.state!=='awaiting_input'||session.input_consumed||Date.parse(session.input_expires_at)<=now()||session.browser?.cookie_digest!==digest(browser)||session.browser?.csrf_digest!==digest(csrf))fail('EMAIL_FORM_SUBMIT_DENIED');
  const deadline=Math.min(now()+60000,Date.parse(session.input_expires_at),consentDeadline(session.request.scope,'consent_expires_at'),...session.request.action_consents.map(consent=>consentDeadline(consent))),request={...session.request,runtime_session_ref:session.runtime_session_ref};
  const check=()=>current(request,'submit',signal,deadline);await check();const hasSend=session.request.action_consents.some(consent=>consent.action_key==='send_message');if(profile.smtp&&!hasSend)retryable('EMAIL_FORM_SMTP_NOT_GRANTED');
  if(!endpointPolicy(profile))retryable('EMAIL_IMAP_ENDPOINT_DENIED');const principal=credentialPrincipal(request.scope,profile);
  const before=await store.withLock({key:custodyKey(request.scope,session.account_id)},t=>t.read());if(request.source&&(!before||before.value.pending_transition!==session_id||before.value.principal_digest!==principal||before.value.pending_effect))fail('EMAIL_FORM_SOURCE_DENIED');
  // A try the hourly cap refuses can never succeed inside this page's lease, so
  // the lease is closed here; the next status check settles the attempt (and
  // releases a replacement's account) instead of waiting for the lease to lapse.
  const budget=failureKey(request.scope),charged=await chargeAttempt(budget).catch(async error=>{if(error?.code==='EMAIL_FORM_ATTEMPTS_EXCEEDED')await tx.compareAndSwap({expected_revision:row.revision,value:{...session,input_expires_at:new Date(now()).toISOString()}});throw error;});
  if(!await tx.compareAndSwap({expected_revision:row.revision,value:{...session,input_consumed:true,state:'submit_started'}})){await refundAttempt(budget,charged);fail('EMAIL_FORM_CONFLICT');}consumed=true;await onPhase('submit_started');
  try{await connector.probe(profile,{signal,expires_at:deadline,check});await check();}catch(error){
   // Nothing has been written to custody yet. An attempt whose login the server
   // refused reopens this same page; every other failure keeps the unknown mark
   // until status() can prove that nothing was stored. While a replacement is
   // open the stored account stays reserved for it.
   const currentRow=await tx.read(),tries=(currentRow.value.failed_tries??0)+1,known=rejected.has(error?.code);
   const reopen=known&&tries<FORM_RETRY.tries_per_session&&Date.parse(session.input_expires_at)>now();
   await tx.compareAndSwap({expected_revision:currentRow.revision,value:{...currentRow.value,failed_tries:tries,...(reopen?{state:'awaiting_input',input_consumed:false}:{state:'indeterminate'})}});
   throw known?Object.assign(new Error(error.code),{code:error.code,retry:reopen}):error;}
  await refundAttempt(budget,charged);
  const generation=(before?.value.custody_generation??0)+1;if(generation>2147483646)fail('EMAIL_FORM_CONFLICT');const capabilities=['read','search','thread',...(hasSend&&profile.smtp?['send']:[]),...(request.action_consents.some(consent=>consent.action_key==='organize_messages')?['modify']:[])];
  // Do not publish a password-derived digest (offline dictionary oracle). A
  // random credential-instance nonce binds the encrypted custody commit.
  const credential_instance_id=randomBytes(32).toString('hex'),visibleProfile={...profile,imap:{...profile.imap,password:undefined},smtp:profile.smtp?{...profile.smtp,password:undefined}:null};
  const receipt={schema_version:'deft.app_connection_form_receipt.v1',account_ref:session.account_id,custody_generation:generation,principal_digest:'sha256:'+principal,custody_digest:'sha256:'+digest({profile:visibleProfile,credential_instance_id,policy_digest,source:request.source,purposes:request.action_consents,generation}),scope_digest:'sha256:'+digest(request.scope),committed_at:new Date(now()).toISOString()};receipt.digest=formReceiptDigest(receipt);
  const lineage=[...(before?.value.lineage??[]),...(before?[{generation:before.value.custody_generation,receipt:before.value.receipt,session_id:request.source.session_id}]:[])];
  const account={schema_version:'email.imap.custody.v1',account_id:session.account_id,scope:request.scope,state:'connected',profile,credential_instance_id,principal_digest:principal,custody_generation:generation,authority_epoch:generation,connection_revision:generation,capabilities,action_consents:request.action_consents,pending_transition:null,pending_effect:null,receipt,lineage};
  await store.withLock({key:custodyKey(request.scope,session.account_id)},async accountTx=>{const currentRow=await accountTx.read();if((currentRow?.revision??null)!==(before?.revision??null))fail('EMAIL_FORM_CONFLICT');await check();if(!await accountTx.compareAndSwap({expected_revision:currentRow?.revision??null,value:account}))fail('EMAIL_FORM_CONFLICT');});await onPhase('custody_committed');await check();
  const currentRow=await tx.read(),complete={...currentRow.value,state:'connected',account:publicAccount(account),receipt};if(!await tx.compareAndSwap({expected_revision:currentRow.revision,value:complete}))fail('EMAIL_FORM_CONFLICT');await onPhase('session_committed');await check();return view(request,complete);
 });}catch(error){
  // Once the password was used, an unclassified failure never offers the same page again.
  if(consumed&&error&&typeof error==='object'&&error.retry===undefined)error.retry=false;throw error;
 }finally{profile.imap.password='';if(profile.smtp)profile.smtp.password='';if(value?.imap)value.imap.password='';if(value?.smtp)value.smtp.password='';}}
 async function status(request,signal){
  // The Host can hold an attempt this runtime never received: its begin was lost
  // or refused in transit. Once the Host proves that attempt is its own current
  // record, the truthful answer is that nothing is connected. Recording it lets
  // the Host release the attempt instead of holding it as unknown for good, and
  // a begin that arrives late finds this row and stays not connected.
  if(request.runtime_session_ref===null&&!await readSession(request.session_id)){await current(request,'status',signal);
   await store.withLock({key:sessionKey(request.session_id)},async tx=>{if(await tx.read())return;const {operation,runtime_session_ref,...begun}=request;
    // A begin that reserved a stored account and then stopped before recording
    // its attempt left a reservation naming this attempt, which can never proceed.
    if(request.source)await store.withLock({key:custodyKey(request.scope,request.source.account_ref)},async accountTx=>{const account=await accountTx.read();if(account?.value.pending_transition===request.session_id&&!account.value.pending_effect&&!await accountTx.compareAndSwap({expected_revision:account.revision,value:{...account.value,pending_transition:null}}))fail('EMAIL_FORM_CONFLICT');});
    if(!await tx.compareAndSwap({expected_revision:null,value:{schema_version:'email.imap.form_session.v1',request:{...begun,operation:'begin'},identity:formIdentity(request),runtime_session_ref:randomBytes(32).toString('base64url'),account_id:randomUUID(),state:'not_connected',input_consumed:false,input_expires_at:request.setup_expires_at,ticket_digest:digest(randomBytes(32).toString('base64url')),browser:null,account:null,receipt:null,policy_digest}}))fail('EMAIL_FORM_CONFLICT');});}
  let row=await checkedSession(request,signal);
  // Settling an attempt that can no longer commit. All checks run under the
  // attempt's own lock, which a running submit holds until it has finished.
  // - Lapsed without input: not connected.
  // - Unknown outcome of a first-time attempt: not connected only when no account
  //   was stored for it. A stored account stays unknown.
  // - A replacement, lapsed or unknown: not connected only when the stored
  //   account is provably untouched, and its reservation is released first.
  const lapsed=value=>value.state==='awaiting_input'&&!value.input_consumed&&Date.parse(value.input_expires_at)<=now(),unknown=value=>['indeterminate','submit_started'].includes(value.state);
  // Settling a replacement hands the per-target hold back, so it takes the same
  // domain lock begin() holds while it reads that hold and the session it names
  // (domain, then session, then custody, then hold: the order begin() uses);
  // otherwise a begin() that read the old hold could admit a second account.
  const settle=()=>store.withLock({key:sessionKey(request.session_id)},async tx=>{const found=await tx.read(),value=found.value;if(!lapsed(value)&&!unknown(value))return found;
   if(value.request.source){if(!await releaseReplacement(value.request.scope,value.account_id,value.request.session_id,value.source_custody_generation))return found;
    // The per-target hold named this attempt. The account it was replacing is the
    // live one again, so the hold goes back to it; otherwise a fresh first-time
    // attempt would be admitted beside a connected account.
    await store.withLock({key:reservationKey(value.request.scope)},async hold=>{const held=await hold.read();if(held?.value.session_id===value.request.session_id&&!await hold.compareAndSwap({expected_revision:held.revision,value:{...held.value,session_id:value.request.source.session_id}}))fail('EMAIL_FORM_CONFLICT');});}
   else if(unknown(value)&&await store.withLock({key:custodyKey(value.request.scope,value.account_id)},t=>t.read()))return found;
   // A replacement released above provably stored nothing, so its input was never
   // accepted. The Host frees its predecessor only for a not-connected attempt
   // whose input is not consumed; the stored account is working again, so say so.
   await tx.compareAndSwap({expected_revision:found.revision,value:{...value,state:'not_connected',...(value.request.source?{input_consumed:false}:{})}});return tx.read();});
  if(lapsed(row.value)||unknown(row.value))row=row.value.request.source?await store.withLock({key:'email.imap.form.domain.'+scopeDomain(row.value.request.scope)},settle):await settle();
  await current(request,'status',signal);return view(request,row.value);}
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
