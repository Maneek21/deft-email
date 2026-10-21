import {canonical,exact,fail,validateRegistration} from './contract.mjs';
import {receiptDigest,REATTACH_V2_VERSION} from './reattach-contract.mjs';

const key='email.runtime.registration_continuity.v1';
const pins=scope=>validateRegistration(Object.fromEntries(['org_id','runtime_registration_id','operator_user_id','runtime_epoch','profile_digest','target_key','resource_key'].map(k=>[k,scope[k]])));
const identity=r=>canonical([r.org_id,r.runtime_registration_id]);
const denied=()=>fail('EMAIL_RUNTIME_REGISTRATION_DENIED');

/** Routing enrollment follows an authenticated, receipted custody transition.
 * It never supplies a grant: every engine still checks current Host authority.
 * Index prepared transitions before acknowledging prepare, so a crash after
 * activation can reconstruct enrollment from the connected journal on restart. */
export async function createRegistrationContinuity({registrations,store}){
 const roots=registrations.map(({connection_protocol,...r})=>({...validateRegistration(r),...(connection_protocol?{connection_protocol}:{})}));
 let accepted=new Map(roots.map(r=>[identity(r),r])),successors=new Set();
 const all=()=>[...accepted.values()];
 const current=()=>all().filter(r=>!successors.has(identity(r)));
 const sourceFor=request=>{
  if(request.schema_version!==REATTACH_V2_VERSION)denied();
  const source=pins(request.source.scope),known=accepted.get(identity(source));
  if(!known||known.connection_protocol!=='v2'||canonical(pins(known))!==canonical(source))denied();
  for(const k of ['org_id','owner_user_id','installation_id','operator_user_id','profile_digest','target_key','resource_key'])
   if(request.source.scope[k]!==request.scope[k])denied();
  return {...pins(request.scope),connection_protocol:'v2'};
 };
 async function readSession(id){return (await store.withLock({key:'email.runtime.session.'+id},tx=>tx.read()))?.value;}
 async function checked(entry){
  exact(entry,['session_id','source_registration','registration']);
  const journal=(await store.withLock({key:'email.runtime.reattach.'+entry.session_id},tx=>tx.read()))?.value;
  if(journal?.state!=='connected')return null;
  const request=journal.pins,target=sourceFor(request),source=await readSession(request.source.session_id),session=await readSession(entry.session_id);
  if(canonical(pins(request.source.scope))!==canonical(entry.source_registration)||canonical(pins(target))!==canonical(entry.registration)
   ||source?.state!=='connected'||canonical(source.scope)!==canonical(request.source.scope)||source.runtime_session_ref!==request.source.runtime_session_ref||source.account?.account_ref!==request.source.account_ref
   ||session?.state!=='connected'||canonical(session.scope)!==canonical(request.scope)||canonical(journal.new_session)!==canonical(session)
   ||!journal.review||journal.receipt_digest!==receiptDigest(request,journal.review,session.runtime_session_ref))denied();
  return target;
 }
 async function refresh(){
  const row=await store.withLock({key},tx=>tx.read()),entries=row?.value?.entries??[];
  if(!Array.isArray(entries)||entries.length>1024)denied();
  accepted=new Map(roots.map(r=>[identity(r),r]));successors=new Set();
  // The append-only index is topological: a source is enrolled before its child.
  for(const entry of entries){const target=await checked(entry);if(target){accepted.set(identity(target),target);successors.add(identity(entry.source_registration));}}
 }
 await refresh();
 return Object.freeze({all,current,refresh,candidate:sourceFor,async record(request,result){
  if(!['eligible','connected'].includes(result.state))return;
  const target=sourceFor(request),entry={session_id:request.session_id,source_registration:pins(request.source.scope),registration:pins(target)};
  await store.withLock({key},async tx=>{
   const row=await tx.read(),entries=row?.value?.entries??[],prior=entries.find(e=>e.session_id===entry.session_id);
   if(prior){if(canonical(prior)!==canonical(entry))denied();return;}
   if(entries.length>=1024)denied();
   if(!await tx.compareAndSwap({expected_revision:row?.revision??null,value:{schema_version:key,entries:[...entries,entry]}}))denied();
  });
  if(result.state==='connected'){const verified=await checked(entry);if(!verified)denied();accepted.set(identity(verified),verified);successors.add(identity(entry.source_registration));}
 }});
}
