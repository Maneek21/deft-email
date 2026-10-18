import {nativeStreamingDigest} from './native-adoption-digest.mjs';
import {createNativeHistoryIndex} from './native-history-index.mjs';
import {canonical,digest,exact,fail} from './contract.mjs';
import {createDraftStore,uuid} from './draft-store.mjs';
import {createMailboxStore} from './mailbox-store.mjs';
import {nativeScope,nativeDraftRecord,writeNativeImportRow} from './native-adoption-records.mjs';
import {nativeIdentity,nativeAdoptionKey,importNativeIdentity} from './native-adoption-identity.mjs';
import {nativeMailboxRecords} from './native-adoption-mailbox.mjs';
import {nativeHistoryRecord,createNativeHistoryStore} from './native-adoption-history.mjs';
import {nativeJson,retainedFamilyRows,NATIVE_FAMILY_TABLES,validateNativeRetained,createNativeRetainedStore} from './native-adoption-retained.mjs';
import {nativeSettingsProjections,nativeRuleProjections} from './native-adoption-settings.mjs';
import {createSettingsStore} from './settings-store.mjs';
import {createRuleStore} from './rule-store.mjs';
import {validateNativeCoreLinks} from './native-adoption-links.mjs';

export const PROTECTED_NATIVE_FAMILIES=Object.freeze(['accounts','drafts','attachments','mailbox','checkpoints','provider_states','sync_receipts','effects','mime','mirrors','templates','signatures','preferences','timers','rules','imap_aliases','folders','knowledge','citations','transfers','calendar','agent_grants','notifications','browser_recovery']);
const supported=new Set(['accounts','drafts','attachments','mailbox','checkpoints','provider_states','sync_receipts','effects','mime']);
// Binary bytes participate in the exact snapshot digest; no plaintext log output.
const jsonValue=nativeJson;
export const nativeSnapshotDigest=nativeStreamingDigest;
export function expectedNativeCoverage(snapshot){
 const families={accounts:[{source_binding:snapshot.source_binding,custody:snapshot.custody}],drafts:snapshot.drafts.map(row=>({draft:row.draft,effect_fence:row.effect_fence})),attachments:snapshot.drafts.flatMap(row=>row.files.map(file=>({draft_id:row.draft.draft_id,...file}))),mailbox:snapshot.mailbox.records,checkpoints:[Object.fromEntries(Object.entries(snapshot.mailbox.index).filter(([key])=>key!=='states'))],provider_states:Object.entries(snapshot.mailbox.index.states).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>({key,...value})),effects:snapshot.history.filter(row=>row.kind!=='native_provenance'),mime:snapshot.history.filter(row=>row.mime!==null).map(row=>({kind:row.kind,id:row.id,revision:row.revision,mime:row.mime})),sync_receipts:snapshot.history.filter(row=>row.kind==='native_provenance')};
 if(snapshot.schema_version==='email.native_adoption_snapshot.v2'){for(const family of Object.keys(NATIVE_FAMILY_TABLES))families[family]=retainedFamilyRows(snapshot.retained,family);families.sync_receipts=snapshot.retained.email_sync_receipts;}
 return Object.fromEntries(PROTECTED_NATIVE_FAMILIES.map(family=>{const rows=families[family]??[];return [family,{count:rows.length,digest:nativeSnapshotDigest(rows)}];}));
}
export function validateNativeSnapshot(snapshot,destination_binding){
 const extended=snapshot.schema_version==='email.native_adoption_snapshot.v2';
 exact(snapshot,['schema_version','adoption_id','scope','source_binding','custody','drafts','mailbox','history','coverage','source_evidence',...(extended?['retained','source_manifest']:[])]);
 if(!['email.native_adoption_snapshot.v1','email.native_adoption_snapshot.v2'].includes(snapshot.schema_version)||!uuid(snapshot.adoption_id)||!Array.isArray(snapshot.drafts)||snapshot.drafts.length>10000||!Array.isArray(snapshot.history)||snapshot.history.length>100000)fail('EMAIL_NATIVE_IMPORT_INVALID');
 const scope=nativeScope(snapshot.scope),snapshot_digest=nativeSnapshotDigest(snapshot),identity=nativeIdentity(scope,snapshot.source_binding,destination_binding,snapshot_digest);
 exact(snapshot.custody,['health','setup_generation','secret']);if(!['connected','reauth_required'].includes(snapshot.custody.health)||!Number.isSafeInteger(snapshot.custody.setup_generation)||snapshot.custody.setup_generation<1||!snapshot.custody.secret||typeof snapshot.custody.secret!=='object'||Array.isArray(snapshot.custody.secret)||Buffer.byteLength(JSON.stringify({credentials:snapshot.custody.secret}))>65536)fail('EMAIL_NATIVE_CUSTODY_UNSUPPORTED');
 const drafts=snapshot.drafts.map(row=>nativeDraftRecord(scope,row));if(new Set(drafts.map(row=>row.record.draft_id)).size!==drafts.length)fail('EMAIL_NATIVE_IMPORT_INVALID');
 const mailbox=nativeMailboxRecords(scope,snapshot.mailbox,identity),history=snapshot.history.map(row=>nativeHistoryRecord(scope,row));if(new Set(history.map(row=>canonical([row.kind,row.id,row.revision]))).size!==history.length)fail('EMAIL_NATIVE_IMPORT_INVALID');
 const effectId=row=>row.value?.operation_id??row.value?.original_operation_id??row.id;
 for(const row of snapshot.drafts){const fence=row.effect_fence;for(let i=0;i<(fence?.operation_ids.length??0);i++)if(!history.some(item=>effectId(item)===fence.operation_ids[i]&&item.state===fence.states[i]))fail('EMAIL_NATIVE_IMPORT_EFFECT_INVALID');for(const item of history.filter(item=>item.kind!=='native_provenance'&&item.value?.draft_id===row.draft.draft_id))if(!fence?.operation_ids.includes(effectId(item)))fail('EMAIL_NATIVE_IMPORT_EFFECT_INVALID');}
 let settings=[],rules=[];if(extended){validateNativeRetained(scope,snapshot.retained,snapshot.source_manifest);validateNativeCoreLinks(snapshot);settings=nativeSettingsProjections(scope,snapshot.retained);rules=nativeRuleProjections(snapshot.retained);}
 exact(snapshot.coverage,PROTECTED_NATIVE_FAMILIES);for(const [family,entry] of Object.entries(snapshot.coverage)){exact(entry,['count','digest']);if(!Number.isSafeInteger(entry.count)||entry.count<0||!/^[a-f0-9]{64}$/.test(entry.digest)||!extended&&!supported.has(family)&&entry.count!==0)fail('EMAIL_NATIVE_FAMILY_UNSUPPORTED');}
 const counts={accounts:1,drafts:drafts.length,attachments:drafts.reduce((n,row)=>n+row.fileRows.length,0),mailbox:mailbox.records.length,checkpoints:1,provider_states:Object.keys(mailbox.index.states).length,effects:history.filter(row=>row.kind!=='native_provenance').length,mime:history.filter(row=>row.mime!==null).length,sync_receipts:history.filter(row=>row.kind==='native_provenance').length};
 if(canonical(snapshot.coverage)!==canonical(expectedNativeCoverage(snapshot)))fail('EMAIL_NATIVE_COVERAGE_MISMATCH');
 exact(snapshot.source_evidence,['database_digest','files_digest','keys_digest','catalog_digest','writer_generation']);if(['database_digest','files_digest','keys_digest','catalog_digest'].some(key=>!/^[a-f0-9]{64}$/.test(snapshot.source_evidence[key]))||!Number.isSafeInteger(snapshot.source_evidence.writer_generation)||snapshot.source_evidence.writer_generation<1)fail('EMAIL_NATIVE_IMPORT_EVIDENCE_INVALID');
 if(extended){for(const family of Object.keys(NATIVE_FAMILY_TABLES))counts[family]=snapshot.coverage[family].count;counts.sync_receipts=snapshot.retained.email_sync_receipts.length;}
 return {scope,identity,snapshot_digest,counts,settings,rules,extended};
}
/** Operator-only staging; no session, consent, Run, scheduler or provider port.
 * check must bind the source writer fence and independent destination admission.
 * Activation is deliberately absent; root must keep this store root unexposed. */
export async function importNativeSnapshot({store,custody,snapshot,destination_binding,expected_snapshot_digest,check,interrupt=async()=>{}}){
 if(typeof check!=='function'||typeof custody?.importNativeAccount!=='function')fail('EMAIL_NATIVE_IMPORT_OPERATOR_REQUIRED');
 snapshot=structuredClone(snapshot);destination_binding=structuredClone(destination_binding);
 const plan=validateNativeSnapshot(snapshot,destination_binding);if(plan.snapshot_digest!==expected_snapshot_digest)fail('EMAIL_NATIVE_IMPORT_SNAPSHOT_CHANGED');await check();
 const {scope,identity,snapshot_digest}=plan,key=nativeAdoptionKey(scope);
 const pins={schema_version:'email.native_adoption_stage.v1',adoption_id:snapshot.adoption_id,scope,snapshot_digest,binding_digest:digest(destination_binding),source_evidence:structuredClone(snapshot.source_evidence),counts:plan.counts,...(plan.extended?{source_manifest:structuredClone(snapshot.source_manifest)}:{})};
 await store.withLock({key},async tx=>{await check();const prior=await tx.read();if(prior){const {state,...previous}=prior.value;if(canonical(previous)!==canonical(pins)||!['staging','staged_verified'].includes(state))fail('EMAIL_NATIVE_IMPORT_CONFLICT');}else if(!await tx.compareAndSwap({expected_revision:null,value:{...pins,state:'staging'}}))fail('EMAIL_NATIVE_IMPORT_CONFLICT');});
 await interrupt('stage_started');const drafts=createDraftStore({store}),mailbox=createMailboxStore({store}),history=createNativeHistoryStore({store});
 await custody.importNativeAccount({source_binding:snapshot.source_binding,binding:destination_binding,...snapshot.custody},check);
 await importNativeIdentity(store,identity,check);
 if(plan.extended){const retained=createNativeRetainedStore({store});await retained.import(scope,snapshot.retained,snapshot.source_manifest,check,interrupt);await createSettingsStore({store}).importNative(scope,plan.settings,check);await createRuleStore({store}).importNative({...scope,installation_id:destination_binding.scope.installation_id},plan.rules,check);await retained.verify(scope,snapshot.retained,snapshot.source_manifest,check);await interrupt('retained_verified');}
 for(const row of snapshot.history)await history.import(scope,row,check);
 await createNativeHistoryIndex({store}).build(scope,snapshot.history,check);
 for(const row of snapshot.drafts){await drafts.importNative(scope,row,check);await interrupt('draft_imported');}
 await mailbox.importNative(scope,snapshot.mailbox,identity,check);await interrupt('mailbox_imported');
 for(const row of snapshot.history){const actual=await history.read(scope,{kind:row.kind,id:row.id,revision:row.revision},check);if(canonical(actual.value)!==canonical(row.value)||actual.state!==row.state||row.mime&&!Buffer.from(actual.mime.bytes).equals(Buffer.from(row.mime.bytes)))fail('EMAIL_NATIVE_IMPORT_VERIFY_FAILED');actual.mime?.bytes.fill(0);}
 for(const row of snapshot.drafts){await drafts.verifyNativeImport(scope,row,check);const value=await drafts.read(scope,row.draft.draft_id,check);if(value.revision!==row.draft.revision||value.content_revision!==row.draft.content_revision||canonical(value.content)!==canonical(row.draft.content))fail('EMAIL_NATIVE_IMPORT_VERIFY_FAILED');for(const file of row.files.filter(item=>item.detached_at===null&&row.draft.status!=='archived')){const read=await drafts.readFile(scope,row.draft.draft_id,file.metadata.file_id,row.draft.revision,check);try{if(!Buffer.from(file.bytes).equals(read.bytes))fail('EMAIL_NATIVE_IMPORT_VERIFY_FAILED');}finally{read.bytes.fill(0);}}}
 await check();await store.withLock({key},async tx=>{const row=await tx.read();const {state,...current}=row.value;if(canonical(current)!==canonical(pins))fail('EMAIL_NATIVE_IMPORT_CONFLICT');if(state!=='staged_verified'&&!await tx.compareAndSwap({expected_revision:row.revision,value:{...pins,state:'staged_verified'}}))fail('EMAIL_NATIVE_IMPORT_CONFLICT');await check();});
 return {...pins,state:'staged_verified',activation:false};
}
