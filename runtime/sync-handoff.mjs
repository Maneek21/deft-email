import {canonical,digest,fail,validateScope as fullScope,opaque,hostUuid} from './contract.mjs';
import {uuid} from './draft-store.mjs';

export const SYNC_HANDOFF_LIMITS=Object.freeze({pages:128,page_bytes:900*1024});
const key=(scope,part)=>'email.data.sync_handoff.'+digest([scope,part]);
const same=(a,b)=>canonical(a)===canonical(b);
const denied=()=>fail('EMAIL_SYNC_HANDOFF_INVALID');
const shape=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const validateScope=scope=>{if(!shape(scope,['account_id','org_id','owner_user_id'])||!opaque(scope.account_id)||!uuid(scope.org_id)||!uuid(scope.owner_user_id))denied();};
const pins=(value,scope)=>{if(!shape(value,['scope','session_id','runtime_session_ref','custody_generation','client_fingerprint'])||!hostUuid(value.session_id)||!opaque(value.runtime_session_ref)||!Number.isSafeInteger(value.custody_generation)||value.custody_generation<1||!/^[a-f0-9]{64}$/u.test(value.client_fingerprint??''))denied();fullScope(value.scope);if(scope&&(value.scope.org_id!==scope.org_id||value.scope.owner_user_id!==scope.owner_user_id))denied();return structuredClone(value);};
/** A bounded immutable native-page ring. The mailbox index's sequence is the
 * commit witness: a prepared page alone never advances provider state. */
export function createSyncHandoff({store}){
 const read=(scope,part)=>store.withLock({key:key(scope,part)},tx=>tx.read());
 const write=async(scope,part,value)=>store.withLock({key:key(scope,part)},async tx=>{const row=await tx.read();if(!await tx.compareAndSwap({expected_revision:row?.revision??null,value}))fail('EMAIL_DATA_CONFLICT');});
 const validateHead=(scope,row)=>{if(!row)return {schema_version:'email.sync_handoff_head.v1',scope,last:0,oldest:1};const head=row.value;if(!shape(head,['schema_version','scope','last','oldest'])||head.schema_version!=='email.sync_handoff_head.v1'||!same(head.scope,scope)||!Number.isSafeInteger(head.last)||head.last<0||!Number.isSafeInteger(head.oldest)||head.oldest<1||head.oldest!==Math.max(1,head.last-SYNC_HANDOFF_LIMITS.pages+1))denied();return head;};
 const slot=sequence=>'slot:'+sequence%SYNC_HANDOFF_LIMITS.pages;
 const load=async(scope,sequence)=>{const row=await read(scope,slot(sequence));if(!row||row.value.sequence!==sequence)return null;const value=row.value;if(!shape(value,['schema_version','scope','sequence','state','producer','input_cursor','page','page_digest'])||value.schema_version!=='email.sync_handoff_page.v1'||!same(value.scope,scope)||!Number.isSafeInteger(value.sequence)||value.sequence<1||!['prepared','committed','aborted'].includes(value.state)||value.input_cursor!==null&&typeof value.input_cursor!=='string'||value.page_digest!=='sha256:'+digest(value.page)||value.page.account_id!==scope.account_id||Buffer.byteLength(JSON.stringify(value.page))>SYNC_HANDOFF_LIMITS.page_bytes)denied();pins(value.producer,scope);return value;};
 async function reconcile(scope,index){
  const head=validateHead(scope,await read(scope,'head'));
  // The latest allocation is the only possible unfinished native commit: all
  // callers hold the account session and mailbox index while allocating.
  if(head.last){const page=await load(scope,head.last);if(!page)denied();if(page.state==='prepared')await write(scope,slot(page.sequence),{...page,state:index.sync_publication_sequence===page.sequence?'committed':'aborted'});}
  return head;
 }
 return Object.freeze({
  async capture(scope,index,page,producer,check,intent='native'){validateScope(scope);pins(producer,scope);await check();const head=await reconcile(scope,index),sequence=head.last+1;
   const partial=intent==='partial_observation';
   if(!['native','partial_observation'].includes(intent)||!Number.isSafeInteger(sequence)||sequence>=Number.MAX_SAFE_INTEGER||page.account_id!==scope.account_id||Buffer.byteLength(JSON.stringify(page))>SYNC_HANDOFF_LIMITS.page_bytes)denied();
   // Exact authorized foreground observations have no native scan state. They
   // can publish observed rows, never absence, deletion or complete coverage.
   if(partial){if(!page.items?.length||page.items.length>25||page.state_updates?.length||page.tombstones?.length||page.complete!==false||page.has_more!==true||page.next_cursor!==null)denied();
    const previous=head.last?await load(scope,head.last):null;
    if(previous?.state==='committed'&&!previous.page.state_updates?.length&&same(previous.producer,producer)&&same({...previous.page,observed_at:null},{...page,observed_at:null}))return head.last;
   }else if(!page.state_updates?.length||typeof page.next_cursor!=='string'||!page.next_cursor.length||page.next_cursor.length>4096||page.next_cursor===index.next_cursor)denied();
   const value={schema_version:'email.sync_handoff_page.v1',scope,sequence,state:'prepared',producer:pins(producer),input_cursor:index.next_cursor??null,page:structuredClone(page),page_digest:'sha256:'+digest(page)};
   await check();await write(scope,slot(sequence),value);await write(scope,'head',{schema_version:'email.sync_handoff_head.v1',scope,last:sequence,oldest:Math.max(1,sequence-SYNC_HANDOFF_LIMITS.pages+1)});await check();return sequence;
  },
  async committed(scope,sequence,check){await check();const page=await load(scope,sequence);if(!page||!['prepared','committed'].includes(page.state))denied();if(page.state==='prepared')await write(scope,slot(sequence),{...page,state:'committed'});await check();},
  async snapshot(scope,index,check){validateScope(scope);await check();const head=await reconcile(scope,index);await check();return structuredClone(head);},
  async next(scope,index,after,producer,check,repairProducers){validateScope(scope);pins(producer,scope);if(repairProducers){if(!Array.isArray(repairProducers)||repairProducers.length!==2||!same(repairProducers[0],producer))denied();repairProducers.forEach(p=>pins(p,scope));}await check();const head=await reconcile(scope,index);if(!Number.isSafeInteger(after)||after<0||after>head.last)denied();if(after<head.oldest-1)fail('EMAIL_SYNC_PUBLICATION_REBASELINE_REQUIRED');
   for(let sequence=after+1;sequence<=head.last;sequence++){await check();const page=await load(scope,sequence);if(!page)fail('EMAIL_SYNC_PUBLICATION_REBASELINE_REQUIRED');if(page.state==='prepared')denied();if(page.state==='committed'){if(!same(page.producer,producer)&&!repairProducers?.some(p=>same(p,page.producer)))fail('EMAIL_SYNC_PUBLICATION_SCOPE_CHANGED');await check();return structuredClone(page);}}
   await check();return null;
  },
 });
}
