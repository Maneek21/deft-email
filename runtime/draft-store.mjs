import {nativeDraftRecord,writeNativeImportRow} from './native-adoption-records.mjs';
import {createHash} from 'node:crypto';
import {parseNativeSafeComposeHtml,nativeComposeInlineFileIds} from './domain/safe-compose-html.mjs';
import {validateNativeComposeRaster} from './domain/native-compose-raster.mjs';
import {canonical, digest, exact, fail} from './contract.mjs';

export const DRAFT_LIMITS = Object.freeze({json_bytes:480*1024,body_characters:256*1024,max_files:32,file_bytes:25*1024*1024,total_file_bytes:25*1024*1024});
export const uuid = value => typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value);
const hex = value => typeof value==='string' && /^[a-f0-9]{64}$/u.test(value);
const revision = value => Number.isSafeInteger(value) && value>=1;
const controls=/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const metadataKeys=['file_id','filename','media_type','size_bytes','sha256'];
export function validateFileMetadata(value) {
  exact(value,metadataKeys);
  if(!uuid(value.file_id)||typeof value.filename!=='string'||value.filename.length<1||value.filename.length>255||/[\/\\\u0000-\u001f\u007f]/u.test(value.filename)
    ||typeof value.media_type!=='string'||!/^[-a-z0-9.+]+\/[-a-z0-9.+]+$/u.test(value.media_type)||!Number.isSafeInteger(value.size_bytes)||value.size_bytes<0||value.size_bytes>DRAFT_LIMITS.file_bytes||!hex(value.sha256))fail('EMAIL_DRAFT_INVALID');
  return structuredClone(value);
}
/** Behavioral port of frozen email-draft-service.ts, with public native HTML
 * validation. Exact user text survives; MIME normalization never stores drafts. */
export function validateDraftContent(raw) {
  const optional=['from_identity','managed_signature','author_note'].filter(field=>Object.hasOwn(raw??{},field));
  exact(raw,['mode','to','cc','bcc','subject','body','body_html','reply_record_id','attachments',...optional]);
  if(!['compose','reply','reply_all','forward'].includes(raw.mode)||['to','cc','bcc'].some(field=>typeof raw[field]!=='string'||raw[field].length>16384||Buffer.byteLength(raw[field])>16384||controls.test(raw[field]))
    ||typeof raw.subject!=='string'||raw.subject.length>998||controls.test(raw.subject)||typeof raw.body!=='string'||raw.body.length>DRAFT_LIMITS.body_characters||/[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(raw.body)
    ||typeof raw.body_html!=='string'||raw.body_html.length>DRAFT_LIMITS.body_characters||typeof raw.reply_record_id!=='string'||raw.reply_record_id!==''&&!/^mail_[a-f0-9]{64}$/u.test(raw.reply_record_id)
    ||!Array.isArray(raw.attachments)||raw.attachments.length>DRAFT_LIMITS.max_files||Buffer.byteLength(JSON.stringify(raw))>DRAFT_LIMITS.json_bytes)fail('EMAIL_DRAFT_INVALID');
  if(Object.hasOwn(raw,'author_note')&&(typeof raw.author_note!=='string'||raw.author_note.length>1000||controls.test(raw.author_note)))fail('EMAIL_DRAFT_INVALID');
  const value=structuredClone(raw);value.attachments=value.attachments.map(validateFileMetadata);
  if(new Set(value.attachments.map(file=>file.file_id)).size!==value.attachments.length||value.attachments.reduce((sum,file)=>sum+file.size_bytes,0)>DRAFT_LIMITS.total_file_bytes)fail('EMAIL_DRAFT_INVALID');
  if(value.from_identity){exact(value.from_identity,['address']);if(typeof value.from_identity.address!=='string'||value.from_identity.address.length>320||!/^\S+@\S+\.\S+$/u.test(value.from_identity.address)||controls.test(value.from_identity.address))fail('EMAIL_DRAFT_INVALID');}
  if(value.body_html){try{if(parseNativeSafeComposeHtml(value.body_html,{maxCharacters:256*1024,maxBytes:480*1024,inlineAttachments:value.attachments}).plainText!==value.body)fail('EMAIL_DRAFT_INVALID');}catch{fail('EMAIL_DRAFT_INVALID');}}
  if(value.managed_signature){
    const region=value.managed_signature;exact(region,['schema_version','identity_key','preference_revision','plain','rich']);exact(region.plain,['start','text']);if(region.rich!==null)exact(region.rich,['start','html']);
    if(region.schema_version!=='deft.email_signature_region.v1'||!hex(region.identity_key)||!revision(region.preference_revision)||region.preference_revision>2147483647||!Number.isSafeInteger(region.plain.start)||region.plain.start<0||region.plain.start>256*1024||typeof region.plain.text!=='string'||!region.plain.text.length||region.plain.text.length>16384||region.rich!==null&&(!Number.isSafeInteger(region.rich.start)||region.rich.start<0||region.rich.start>256*1024||typeof region.rich.html!=='string'||!region.rich.html.length||region.rich.html.length>16384))fail('EMAIL_DRAFT_INVALID');
    let valid=Boolean(value.from_identity&&sha(value.from_identity.address.trim().toLowerCase())===region.identity_key&&value.body.slice(region.plain.start)===region.plain.text);
    if(region.rich===null)valid&&=value.body_html==='';else try{const prefix=parseNativeSafeComposeHtml(value.body_html.slice(0,region.rich.start),{inlineAttachments:value.attachments});parseNativeSafeComposeHtml(region.rich.html,{maxCharacters:16384,maxBytes:65536});valid&&=value.body_html.slice(region.rich.start)===region.rich.html&&prefix.plainText.length===region.plain.start;}catch{valid=false;}
    if(!valid)delete value.managed_signature;
  }
  return value;
}
const scopeFor = scope => {exact(scope,['org_id','owner_user_id','account_id']);if(Object.values(scope).some(value=>typeof value!=='string'||!value.length||value.length>256||controls.test(value)))fail('EMAIL_DRAFT_ACCESS_DENIED');return structuredClone(scope);};
const keyFor=(kind,scope,id='')=>'email.data.'+kind+'.'+digest([scope.org_id,scope.owner_user_id,scope.account_id,id]);
export const draftCollectionKey=scope=>keyFor('draft_collection',scope);
const reference=(id,expected)=>{if(!uuid(id)||!revision(expected))fail('EMAIL_DRAFT_INVALID');};

/** Single writer row CAS is the draft/catalog commit point. File bytes are
 * staged durably first; only a committed active manifest exposes them. Replayed
 * request identities reconcile acknowledgement loss without a second mutation. */
export function createDraftStore({store,now=Date.now}) {
  async function readRow(kind,scope,id){return store.withLock({key:keyFor(kind,scope,id)},tx=>tx.read());}
  async function currentFiles(scope,record,value){
    const inline=value.body_html?nativeComposeInlineFileIds(value.body_html,{inlineAttachments:value.attachments}):[];
    for(const file of value.attachments){const active=record.files[file.file_id];if(!active||active.detached||canonical(active.metadata)!==canonical(file))fail('EMAIL_DRAFT_FILE_DENIED');const row=await readRow('file',scope,record.draft_id+':'+file.file_id);if(!row||row.value?.state!=='staged'||canonical(row.value.metadata)!==canonical(file)||canonical(row.value.scope)!==canonical(scope))fail('EMAIL_DRAFT_FILE_DENIED');if(inline.includes(file.file_id)){const bytes=Buffer.from(row.value.bytes,'base64url');try{if(bytes.length!==file.size_bytes||sha(bytes)!==file.sha256||!validateNativeComposeRaster(bytes,file.media_type,'outgoing'))fail('EMAIL_DRAFT_FILE_INVALID');}finally{bytes.fill(0);}}}
    // Removing bytes is an explicit detach operation; saving cannot hide files.
    if(Object.values(record.files).filter(file=>!file.detached).length!==value.attachments.length)fail('EMAIL_DRAFT_FILE_DENIED');
  }
  async function mutate(scope,id,request_id,input,check,work){
    if(!uuid(id)||!uuid(request_id))fail('EMAIL_DRAFT_INVALID');const input_digest=digest(input);
    return store.withLock({key:keyFor('draft',scope,id)},async tx=>{
      await check();const row=await tx.read();let record=row?.value;
      if(record&&canonical(record.scope)!==canonical(scope))fail('EMAIL_DRAFT_ACCESS_DENIED');
      const replay=record?.receipts?.find(receipt=>receipt.request_id===request_id);
      if(replay){if(replay.input_digest!==input_digest)fail('EMAIL_DRAFT_CONFLICT');await check();return structuredClone(record);}
      if(record?.native_effect_fence)fail('EMAIL_NATIVE_EFFECT_INSPECT_ONLY');const next=await work(record);await check();next.receipts=[...(record?.receipts??[]),{request_id,input_digest,revision:next.revision,content_digest:next.content_digest,...(input.public_input_digest?{public_input_digest:input.public_input_digest}:{})}].slice(-64);
      if(!await tx.compareAndSwap({expected_revision:row?.revision??null,value:next}))fail('EMAIL_DRAFT_CONFLICT');await check();return structuredClone(next);
    });
  }
  const publicRecord=record=>{const {files,receipts,future_receipts,...view}=record;return {...view,file_catalog:Object.values(files).filter(file=>!file.detached).map(file=>({...file.metadata,upload_revision:file.upload_revision}))};};
  return Object.freeze({
    async verifyNativeImport(rawScope,input,check){const scope=scopeFor(rawScope),{record,fileRows}=nativeDraftRecord(scope,input);await check();if(canonical((await readRow('draft',scope,record.draft_id))?.value)!==canonical(record))fail('EMAIL_NATIVE_IMPORT_VERIFY_FAILED');for(const row of fileRows)if(canonical((await readRow('file',scope,row.id))?.value)!==canonical(row.value))fail('EMAIL_NATIVE_IMPORT_VERIFY_FAILED');await check();return digest(record);},
    // Operator-only staging seam. No public data operation exposes this method.
    async importNative(rawScope,input,check){
      const scope=scopeFor(rawScope),{record,fileRows}=nativeDraftRecord(scope,input);
      for(const row of fileRows)await writeNativeImportRow(store,keyFor('file',scope,row.id),row.value,check);
      await currentFiles(scope,record,record.content);
      await writeNativeImportRow(store,keyFor('draft',scope,record.draft_id),record,check);
      await store.withLock({key:keyFor('draft_index',scope)},async tx=>{await check();const prior=await tx.read();if(prior&&canonical(prior.value.scope)!==canonical(scope))fail('EMAIL_DRAFT_ACCESS_DENIED');const ids=prior?.value.ids??[];if(!ids.includes(record.draft_id)){if(ids.length>=10000)fail('EMAIL_DRAFT_LIMIT');if(!await tx.compareAndSwap({expected_revision:prior?.revision??null,value:{scope,ids:[...ids,record.draft_id]}}))fail('EMAIL_DRAFT_CONFLICT');}await check();});
      return publicRecord(structuredClone(record));
    },
    async applyChange(rawScope,id,expected,content_digest,value,{request_id,user_id,check,revalidate,public_input_digest,prepared_digest}){
      const scope=scopeFor(rawScope);reference(id,expected);value=validateDraftContent(value);if(user_id!==scope.owner_user_id||typeof revalidate!=='function'||!/^sha256:[a-f0-9]{64}$/u.test(public_input_digest??'')||!/^sha256:[a-f0-9]{64}$/u.test(prepared_digest??''))fail('EMAIL_DRAFT_ACCESS_DENIED');
      return publicRecord(await mutate(scope,id,request_id,{operation:'record_apply_change',expected,content_digest,value,prepared_digest,public_input_digest},check,async record=>{
        if(!record)fail('EMAIL_DRAFT_NOT_FOUND');if(record.calendar_reply||record.status!=='draft'||record.revision!==expected||'sha256:'+record.content_digest!==content_digest||record.revision>=2147483647)fail('EMAIL_DRAFT_CONFLICT');
        for(const field of ['mode','to','cc','bcc','reply_record_id','attachments'])if(canonical(value[field])!==canonical(record.content[field]))fail('EMAIL_RECORD_CHANGE_INVALID');
        await currentFiles(scope,record,value);await revalidate();
        return {...record,revision:record.revision+1,content_revision:record.content_revision+1,content:value,content_digest:digest(value),last_edited_by_user_id:user_id,updated_at:new Date(now()).toISOString()};
      }));
    },
    // Only retained v2 account reattachment uses this gate. Native account IDs
    // are allocated by OAuth Begin and conserved by validated target lineage.
    // UNKNOWN is immutable submitted history, never an actionable draft.
    async assertNoActiveReattachmentEffects(rawScope,check){const scope=scopeFor(rawScope);await check();const index=await readRow('draft_index',scope);if(index&&(canonical(index.value.scope)!==canonical(scope)||!Array.isArray(index.value.ids)||index.value.ids.length>10000))fail('EMAIL_DRAFT_ACCESS_DENIED');for(const id of index?.value.ids??[]){const row=await readRow('draft',scope,id),record=row?.value;if(record&&(canonical(record.scope)!==canonical(scope)||record.draft_id!==id))fail('EMAIL_DRAFT_ACCESS_DENIED');if(record?.send_effect&&record.send_effect.state!=='accepted'&&!(record.send_effect.state==='unknown'&&uuid(record.send_effect.run_id)&&['submitted','archived'].includes(record.status)))fail('EMAIL_RUNTIME_REATTACH_EFFECT_PENDING');}await check();},
    async assertNoPendingEffects(rawScope,check){const scope=scopeFor(rawScope);await check();const index=await readRow('draft_index',scope);if(index&&canonical(index.value.scope)!==canonical(scope))fail('EMAIL_DRAFT_ACCESS_DENIED');for(const id of index?.value.ids??[]){const row=await readRow('draft',scope,id);if(row&&canonical(row.value.scope)!==canonical(scope))fail('EMAIL_DRAFT_ACCESS_DENIED');if(row?.value.send_effect&&row.value.send_effect.state!=='accepted')fail('EMAIL_RUNTIME_REATTACH_EFFECT_PENDING');}await check();},
    async create(rawScope,id,value,{request_id,user_id,check,origin=null,calendar_reply=null}){
      const scope=scopeFor(rawScope);value=validateDraftContent(value);if(value.attachments.length||user_id!==scope.owner_user_id)fail('EMAIL_DRAFT_ACCESS_DENIED');
      // Index the proposed UUID before row publication. Crash holes are skipped.
      await store.withLock({key:keyFor('draft_index',scope)},async tx=>{await check();const row=await tx.read(),ids=row?.value?.ids??[];if(!ids.includes(id)){if(ids.length>=10000)fail('EMAIL_DRAFT_LIMIT');if(!await tx.compareAndSwap({expected_revision:row?.revision??null,value:{scope,ids:[...ids,id]}}))fail('EMAIL_DRAFT_CONFLICT');}});
      return publicRecord(await mutate(scope,id,request_id,{operation:'create',value,user_id,...(calendar_reply?{calendar_reply}:{})},check,record=>{
        if(record){if(canonical(record.content)!==canonical(value)||canonical(record.calendar_reply??null)!==canonical(calendar_reply)||record.created_by_user_id!==user_id||record.status!=='draft')fail('EMAIL_DRAFT_CONFLICT');return record;}
        const timestamp=new Date(now()).toISOString();return {schema_version:'email.app_draft.v1',scope,draft_id:id,revision:1,content_revision:1,status:'draft',created_by_user_id:user_id,last_edited_by_user_id:user_id,created_at:timestamp,updated_at:timestamp,content:value,content_digest:digest(calendar_reply?{content:value,calendar_reply}:value),origin,...(calendar_reply?{calendar_reply}:{}),files:{},receipts:[]};
      }));
    },
    async read(rawScope,id,check){const scope=scopeFor(rawScope);if(!uuid(id))fail('EMAIL_DRAFT_INVALID');await check();const row=await readRow('draft',scope,id);if(!row||canonical(row.value.scope)!==canonical(scope))fail('EMAIL_DRAFT_NOT_FOUND');await check();return publicRecord(structuredClone(row.value));},
    async readRecentAcceptedMetadata(rawScope,limit,check){const scope=scopeFor(rawScope);if(!Number.isInteger(limit)||limit<1||limit>50)fail('EMAIL_DRAFT_INVALID');await check();const index=await readRow('draft_index',scope);if(index&&canonical(index.value.scope)!==canonical(scope))fail('EMAIL_DRAFT_ACCESS_DENIED');const rows=[];for(const id of (index?.value.ids??[]).slice(-limit).reverse()){const row=await readRow('draft',scope,id);if(!row)continue;if(canonical(row.value.scope)!==canonical(scope))fail('EMAIL_DRAFT_ACCESS_DENIED');rows.push({send_effect:structuredClone(row.value.send_effect??null),accepted_recipient_metadata:structuredClone(row.value.accepted_recipient_metadata??null)});}await check();return rows;},
    async list(rawScope,{cursor=null,limit=50},check){const scope=scopeFor(rawScope);if(!Number.isInteger(limit)||limit<1||limit>100||cursor!==null&&!uuid(cursor))fail('EMAIL_DRAFT_INVALID');await check();const index=await readRow('draft_index',scope),ids=index?.value.ids??[];const offset=cursor===null?0:ids.indexOf(cursor)+1;if(cursor!==null&&offset===0)fail('EMAIL_DRAFT_INVALID');let position=offset;const items=[];for(;position<ids.length&&items.length<limit;position++){const row=await readRow('draft',scope,ids[position]);if(row&&row.value.status!=='archived')items.push(publicRecord(structuredClone(row.value)));}await check();return {items,next_cursor:position<ids.length?ids[position-1]:null};},
    async save(rawScope,id,expected,value,{request_id,user_id,check}){const scope=scopeFor(rawScope);reference(id,expected);value=validateDraftContent(value);if(user_id!==scope.owner_user_id)fail('EMAIL_DRAFT_ACCESS_DENIED');return publicRecord(await mutate(scope,id,request_id,{operation:'save',expected,value,user_id},check,async record=>{if(!record)fail('EMAIL_DRAFT_NOT_FOUND');if(record.calendar_reply||record.status!=='draft'||record.revision!==expected||value.mode!==record.content.mode||value.reply_record_id!==record.content.reply_record_id)fail('EMAIL_DRAFT_CONFLICT');await currentFiles(scope,record,value);return {...record,revision:record.revision+1,content_revision:record.content_revision+1,content:value,content_digest:digest(value),last_edited_by_user_id:user_id,updated_at:new Date(now()).toISOString()};}));},
    async archive(rawScope,id,expected,{request_id,check}){const scope=scopeFor(rawScope);reference(id,expected);return publicRecord(await mutate(scope,id,request_id,{operation:'archive',expected},check,record=>{if(!record)fail('EMAIL_DRAFT_NOT_FOUND');if(record.status==='archived'||record.revision!==expected)fail('EMAIL_DRAFT_CONFLICT');return {...record,status:'archived',revision:record.revision+1,updated_at:new Date(now()).toISOString()};}));},
    async upload(rawScope,id,expected,metadata,bytes,{request_id,check}){
      const scope=scopeFor(rawScope);reference(id,expected);metadata=validateFileMetadata(metadata);if(!(bytes instanceof Uint8Array)||bytes.byteLength!==metadata.size_bytes||sha(bytes)!==metadata.sha256)fail('EMAIL_DRAFT_FILE_INVALID');
      return publicRecord(await mutate(scope,id,request_id,{operation:'upload',expected,metadata},check,async record=>{
        if(!record)fail('EMAIL_DRAFT_NOT_FOUND');if(record.calendar_reply||record.status!=='draft'||record.revision!==expected||record.files[metadata.file_id])fail('EMAIL_DRAFT_CONFLICT');
        if(record.content.attachments.length>=32||record.content.attachments.reduce((sum,file)=>sum+file.size_bytes,0)+metadata.size_bytes>25*1024*1024)fail('EMAIL_DRAFT_LIMIT');
        await store.withLock({key:keyFor('file',scope,id+':'+metadata.file_id)},async tx=>{await check();const row=await tx.read();const value={schema_version:'email.app_draft_file.v1',scope,draft_id:id,metadata,state:'staged',upload_request_id:request_id,bytes:Buffer.from(bytes).toString('base64url')};if(row){if(canonical(row.value)!==canonical(value))fail('EMAIL_DRAFT_CONFLICT');}else if(!await tx.compareAndSwap({expected_revision:null,value}))fail('EMAIL_DRAFT_CONFLICT');});
        const content=validateDraftContent({...record.content,attachments:[...record.content.attachments,metadata]});return {...record,revision:record.revision+1,content_revision:record.content_revision+1,content,content_digest:digest(content),files:{...record.files,[metadata.file_id]:{metadata,detached:false,upload_revision:record.revision+1}},updated_at:new Date(now()).toISOString()};
      }));
    },
    async readFile(rawScope,id,file_id,expected,check,{upload_revision,sha256}={}){const scope=scopeFor(rawScope);reference(id,expected);if(!uuid(file_id))fail('EMAIL_DRAFT_INVALID');return store.withLock({key:keyFor('draft',scope,id)},async tx=>{await check();const record=(await tx.read())?.value,file=record?.files[file_id];if(!record||record.revision!==expected||!file||file.detached||record.status==='archived'||upload_revision!==undefined&&file.upload_revision!==upload_revision||sha256!==undefined&&file.metadata.sha256!==sha256)fail('EMAIL_DRAFT_FILE_DENIED');const row=await readRow('file',scope,id+':'+file_id);if(!row||canonical(row.value.scope)!==canonical(scope)||canonical(row.value.metadata)!==canonical(file.metadata))fail('EMAIL_DRAFT_FILE_DENIED');const bytes=Buffer.from(row.value.bytes,'base64url');if(bytes.length!==file.metadata.size_bytes||sha(bytes)!==file.metadata.sha256)fail('EMAIL_DRAFT_FILE_INVALID');try{await check();return {...file.metadata,upload_revision:file.upload_revision,bytes};}catch(error){bytes.fill(0);throw error;}});},
    async detach(rawScope,id,expected,file_id,{request_id,check}){const scope=scopeFor(rawScope);reference(id,expected);if(!uuid(file_id))fail('EMAIL_DRAFT_INVALID');return publicRecord(await mutate(scope,id,request_id,{operation:'detach',expected,file_id},check,record=>{if(!record||record.calendar_reply||record.status!=='draft'||record.revision!==expected||!record.files[file_id]||record.files[file_id].detached)fail('EMAIL_DRAFT_CONFLICT');if(nativeComposeInlineFileIds(record.content.body_html,{inlineAttachments:record.content.attachments}).includes(file_id))fail('EMAIL_DRAFT_FILE_REFERENCED');const content={...record.content,attachments:record.content.attachments.filter(file=>file.file_id!==file_id)};return {...record,revision:record.revision+1,content_revision:record.content_revision+1,content,content_digest:digest(content),files:{...record.files,[file_id]:{...record.files[file_id],detached:true,detach_revision:record.revision+1}},updated_at:new Date(now()).toISOString()};}));},
    async validateInline(rawScope,id,expected,check){const record=await this.read(rawScope,id,check);if(record.revision!==expected)fail('EMAIL_DRAFT_CONFLICT');for(const file_id of nativeComposeInlineFileIds(record.content.body_html,{inlineAttachments:record.content.attachments})){const file=await this.readFile(rawScope,id,file_id,expected,check);try{if(!validateNativeComposeRaster(file.bytes,file.media_type,'outgoing'))fail('EMAIL_DRAFT_FILE_INVALID');}finally{file.bytes.fill(0);}}return record;},
    async futureLifecycle(rawScope,input,{request_id,phase,check}){
      const scope=scopeFor(rawScope);exact(input,['store_key','record_id','release_id','run_id','original_request_id','snapshot_id','snapshot_digest','expected_revision','expected_content_digest']);reference(input.record_id,input.expected_revision);
      if(input.store_key!=='drafts'||!['commit','restore'].includes(phase)||![request_id,input.release_id,input.run_id,input.original_request_id,input.snapshot_id].every(uuid)||!/^sha256:[a-f0-9]{64}$/u.test(input.snapshot_digest)||!/^sha256:[a-f0-9]{64}$/u.test(input.expected_content_digest))fail('EMAIL_DRAFT_INVALID');
      return store.withLock({key:keyFor('draft',scope,input.record_id)},async tx=>{
        await check();const row=await tx.read(),record=row?.value;if(!record||canonical(record.scope)!==canonical(scope))fail('EMAIL_DRAFT_NOT_FOUND');
        const input_digest=digest({phase,input}),replay=record.future_receipts?.find(item=>item.request_id===request_id);
        if(replay){if(replay.input_digest!==input_digest)fail('EMAIL_DRAFT_CONFLICT');await check();return structuredClone(replay.receipt);}
        const effect={run_id:input.run_id,release_id:input.release_id,snapshot_digest:input.snapshot_digest,state:'queued'};
        const matches=record.revision===input.expected_revision&&'sha256:'+record.content_digest===input.expected_content_digest&&record.revision<2147483647&&(phase==='commit'?record.status==='draft'&&!record.send_effect&&!record.native_effect_fence:record.status==='submitted'&&canonical(record.send_effect)===canonical(effect));
        let next=record;
        if(matches){next={...record,status:phase==='commit'?'submitted':'draft',revision:record.revision+1,updated_at:new Date(now()).toISOString()};if(phase==='commit')next.send_effect=effect;else delete next.send_effect;}
        const receipt={schema_version:'deft.app_prepared_action_lifecycle_receipt.v1',request_id,release_id:input.release_id,run_id:input.run_id,original_request_id:input.original_request_id,snapshot_id:input.snapshot_id,snapshot_digest:input.snapshot_digest,phase,outcome:matches?'completed':'conflict',record:matches?{record_id:input.record_id,revision:next.revision,content_digest:'sha256:'+next.content_digest,status:next.status}:null};
        next={...next,future_receipts:[...(record.future_receipts??[]),{request_id,input_digest,receipt}].slice(-64)};
        await check();if(!await tx.compareAndSwap({expected_revision:row.revision,value:next}))fail('EMAIL_DRAFT_CONFLICT');await check();return structuredClone(receipt);
      });
    },
    async futureLifecycleStatus(rawScope,id,request_id,check){const scope=scopeFor(rawScope);if(!uuid(id)||!uuid(request_id))fail('EMAIL_DRAFT_INVALID');await check();const row=await readRow('draft',scope,id);if(!row||canonical(row.value.scope)!==canonical(scope))fail('EMAIL_DRAFT_NOT_FOUND');const receipt=row.value.future_receipts?.find(item=>item.request_id===request_id)?.receipt??null;await check();return structuredClone(receipt);},
    async reserveQueuedSend(rawScope,id,expected,content_digest,effect,check){const scope=scopeFor(rawScope);reference(id,expected);if(!uuid(effect.run_id)||!uuid(effect.release_id)||!/^sha256:[a-f0-9]{64}$/u.test(effect.snapshot_digest))fail('EMAIL_DRAFT_INVALID');return store.withLock({key:keyFor('draft',scope,id)},async tx=>{await check();const row=await tx.read(),record=row?.value;if(!record||canonical(record.scope)!==canonical(scope)||record.status!=='submitted'||record.revision!==expected||record.content_digest!==content_digest||canonical(record.send_effect)!==canonical({...effect,state:'queued'}))fail('EMAIL_SEND_DRAFT_CHANGED');const next={...record,revision:record.revision+1,send_effect:{...effect,state:'started'},updated_at:new Date(now()).toISOString()};await check();if(!await tx.compareAndSwap({expected_revision:row.revision,value:next}))fail('EMAIL_DRAFT_CONFLICT');await check();return publicRecord(next);});},
    async reserveSend(rawScope,id,expected,content_digest,run_id,check){const scope=scopeFor(rawScope);reference(id,expected);if(!uuid(run_id))fail('EMAIL_DRAFT_INVALID');return store.withLock({key:keyFor('draft',scope,id)},async tx=>{await check();const row=await tx.read(),record=row?.value;if(!record||canonical(record.scope)!==canonical(scope)||record.status!=='draft'||record.native_effect_fence||record.revision!==expected||record.content_digest!==content_digest)fail('EMAIL_SEND_DRAFT_CHANGED');const next={...record,status:'submitted',revision:record.revision+1,send_effect:{run_id,state:'started'},updated_at:new Date(now()).toISOString()};if(!await tx.compareAndSwap({expected_revision:row.revision,value:next}))fail('EMAIL_DRAFT_CONFLICT');await check();return publicRecord(next);});},
    async recordSendOutcome(rawScope,id,run_id,state,accepted_recipient_metadata){const scope=scopeFor(rawScope);if(!['accepted','unknown'].includes(state)||accepted_recipient_metadata&&(state!=='accepted'||accepted_recipient_metadata.schema_version!=='email.accepted_recipient_metadata.v1'||accepted_recipient_metadata.run_id!==run_id))fail('EMAIL_DRAFT_INVALID');return store.withLock({key:keyFor('draft',scope,id)},async tx=>{const row=await tx.read(),record=row?.value;if(!record||record.send_effect?.run_id!==run_id||!['submitted','archived'].includes(record.status))fail('EMAIL_DRAFT_CONFLICT');if(record.send_effect.state==='accepted'||record.send_effect.state===state)return;const next={...record,revision:record.revision+1,send_effect:{run_id,state},...(accepted_recipient_metadata?{accepted_recipient_metadata:structuredClone(accepted_recipient_metadata)}:{}),updated_at:new Date(now()).toISOString()};if(!await tx.compareAndSwap({expected_revision:row.revision,value:next}))fail('EMAIL_DRAFT_CONFLICT');});},
  });
}
