import {canonical,digest,fail,validateScope} from './contract.mjs';
const same=(a,b)=>canonical(a)===canonical(b),denied=()=>fail('EMAIL_REPAIR_CONTINUITY_DENIED');
const aliasKey=(scope,consumer)=>'email.runtime.repair_publication_alias.'+digest([scope,consumer]);
const shape=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys.slice().sort().join(',');
export const repairPublicationDigest=value=>'sha256:'+digest({...value,schema_version:'email.runtime.credential_repair_publication_receipt.v1'});
function validate(value){
 const {receipt_digest,...pins}=value??{};
 const keys=['schema_version','scope','account_ref','source_session_id','session_id','runtime_session_ref','repair_receipt_digest','prior_consumer','current_consumer','prior_producer','current_producer','receipt_digest'];
 if(!shape(value,keys)&&!shape(value,[...keys,'binding','publication_continuity_digest'])&&!shape(value,[...keys,'binding','publication_continuity_digest','repair_session_id','receipt_kind']))denied();
 if(pins.schema_version!=='email.runtime.credential_repair_publication_receipt.v1'||receipt_digest!==repairPublicationDigest(pins))denied();
 const {scope,prior_consumer:old,current_consumer:next,prior_producer:before,current_producer:after}=pins;
 if(!shape(scope,['org_id','owner_user_id','account_id'])||![before,after].every(p=>shape(p,['scope','session_id','runtime_session_ref','custody_generation','client_fingerprint'])))denied();
 const receiptChain=pins.binding&&/^sha256:[a-f0-9]{64}$/.test(pins.publication_continuity_digest??'');
 if(!scope||!before||!after||!old||!next||(!receiptChain&&after.custody_generation!==before.custody_generation+1)||receiptChain&&after.custody_generation<=before.custody_generation||scope.account_id!==pins.account_ref||!same(before.scope,after.scope)||before.client_fingerprint!==after.client_fingerprint||before.session_id!==pins.source_session_id||after.session_id!==pins.session_id||after.runtime_session_ref!==pins.runtime_session_ref||!/^sha256:[a-f0-9]{64}$/.test(pins.repair_receipt_digest??''))denied();
 try{validateScope(before.scope);validateScope(after.scope);}catch{denied();}
 if(before.scope.org_id!==scope.org_id||before.scope.owner_user_id!==scope.owner_user_id||before.session_id===after.session_id&&pins.receipt_kind!=='closure'||!Number.isSafeInteger(before.custody_generation)||before.custody_generation<1)denied();
 const normalize=c=>{const out=structuredClone(c);delete out.custody_generation;delete out.consent_digest;if(out.snapshot){delete out.snapshot.connection;}return out;};
 if(!same(normalize(old),normalize(next))||old.custody_generation!==before.custody_generation||next.custody_generation!==after.custody_generation)denied();
 if(old.snapshot||next.snapshot){
  const consumerKeys=['snapshot','consent_digest','descriptor_digest','custody_generation','client_fingerprint','max_items'],snapshotKeys=['schema_version','consent_id','scope','connection','resource_policy_digest','interval_seconds','expires_at'];
  if(![old,next].every(c=>shape(c,consumerKeys)&&shape(c.snapshot,snapshotKeys)&&/^sha256:[a-f0-9]{64}$/.test(c.descriptor_digest??'')&&Number.isSafeInteger(c.max_items)&&c.max_items>0&&c.client_fingerprint===before.client_fingerprint))denied();
  const left=old.snapshot?.connection,right=next.snapshot?.connection;
  const connectionKeys=['session_id','runtime_session_ref','account_ref','expected_custody_generation','receipt_digest'];
  if(!shape(left,connectionKeys)||!shape(right,connectionKeys)||!same(old.snapshot.scope,before.scope)||!same(next.snapshot.scope,after.scope))denied();
  if(!left||!right||left.expected_custody_generation!==null&&left.expected_custody_generation!==before.custody_generation||left.session_id!==before.session_id||right.session_id!==after.session_id||left.runtime_session_ref!==before.runtime_session_ref||right.runtime_session_ref!==after.runtime_session_ref||left.account_ref!==scope.account_id||right.account_ref!==scope.account_id||right.expected_custody_generation!==after.custody_generation||right.receipt_digest!==pins.repair_receipt_digest||old.consent_digest!=='sha256:'+digest(old.snapshot)||next.consent_digest!=='sha256:'+digest(next.snapshot))denied();
 }else if(![old,next].every(c=>shape(c,['full','consent_digest','custody_generation'])&&same(c.full,before.scope)))denied();
 return value;
}
/** Narrow prototype: only trusted local repair commit supplies a verified
 * receipt. Consumer nomination alone can never create an alias. */
export function createRepairPublicationContinuity({store,assertRepairReceipt}){
 if(typeof assertRepairReceipt!=='function')denied();
 return Object.freeze({
 async commit(value,check){validate(value);await check();await assertRepairReceipt(value);await check();const publicationKey='email.data.sync_publication.'+digest([value.scope,digest(value.prior_consumer)]);return store.withLock({key:publicationKey},async publicationTx=>{const publication=(await publicationTx.read())?.value;if(!publication||!same(publication.scope,value.scope)||!same(publication.consumer,value.prior_consumer)||!same(publication.producer,value.prior_producer)||publication.result_digest!=='sha256:'+digest(publication.result))denied();return store.withLock({key:aliasKey(value.scope,value.current_consumer)},async tx=>{const row=await tx.read();if(row&&!same(row.value,value))denied();if(!row&&!await tx.compareAndSwap({expected_revision:null,value}))denied();await check();});});},
 async resolve({scope,consumer,producer,check}){await check();const row=await store.withLock({key:aliasKey(scope,consumer)},tx=>tx.read());if(!row)return {consumer,producer,prior_producers:[]};const value=validate(row.value);if(!same(value.scope,scope)||!same(value.current_consumer,consumer)||!same(value.current_producer,producer))denied();await assertRepairReceipt(value);await check();return {consumer:value.prior_consumer,producer:value.prior_producer,prior_producers:[value.prior_producer],current_producer:value.current_producer};}
 });
}
