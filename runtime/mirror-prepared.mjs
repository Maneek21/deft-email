import {randomUUID,createHash} from 'node:crypto';
import {serializeNativeDraft} from './vendor/outgoing-snapshot.mjs';
import {parsedNativeMailboxes} from './vendor/providers/resource-reader.mjs';
import {canonical,digest,fail} from './contract.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const key=(scope,id)=>'email.data.snapshot.'+digest(['mirror',scope.org_id,scope.owner_user_id,id]);
const validate=row=>{if(!row||row.schema_version!=='email.mirror_snapshot.v1'||row.input.snapshot_digest!=='sha256:'+digest(row.identity)||canonical(row.identity.input)!==canonical((({snapshot_digest,...input})=>input)(row.input))||row.identity.mime_digest!==hash(Buffer.from(row.mime_bytes,'base64url')))fail('EMAIL_MIRROR_SNAPSHOT_INVALID');return row;};
/** Private immutable MIME for an existing saved revision. This serializer has
 * no Send reservation and accepts unfinished drafts with empty recipients. */
export function createMirrorPrepared({store,now=Date.now}){
 return Object.freeze({
  async read(scope,id,check){await check();const row=await store.withLock({key:key(scope,id)},tx=>tx.read());await check();const value=validate(row?.value);if(value.scope.org_id!==scope.org_id||value.scope.owner_user_id!==scope.owner_user_id||scope.account_id!==undefined&&value.scope.account_id!==scope.account_id)fail('EMAIL_MIRROR_SNAPSHOT_DENIED');return structuredClone(value);},
  async recovery({scope,session,receipt,row,operation,check}){
   await check();if(!['inspect','delete'].includes(operation)||receipt.account_ref!==scope.account_id||canonical(scope)!==canonical({org_id:session.scope.org_id,owner_user_id:session.scope.owner_user_id,account_id:session.binding.account_id}))fail('EMAIL_MIRROR_SNAPSHOT_DENIED');
   const desired=operation==='delete'?row.accepted_send?.mirror_desired:row.operation?.desired??row.desired,accepted=operation==='delete'?row.accepted_send:null;
   if(!desired||operation==='delete'&&(!accepted||row.operation||canonical(row.previous)!==canonical(accepted.previous)))fail('EMAIL_MIRROR_EFFECT_FENCED');
   const snapshot_id=randomUUID(),input={mirror_receipt_id:receipt.receipt_id,mirror_receipt_revision:receipt.revision,mirror_policy_digest:receipt.policy_digest,record_store_key:receipt.store_key,record_id:desired.record_id,record_revision:desired.revision,content_digest:'sha256:'+desired.content_digest,snapshot_id,mirror_operation:operation,accepted_submission_id:accepted?.run_id??'',accepted_snapshot_id:accepted?.snapshot_id??'',accepted_snapshot_digest:accepted?'sha256:'+accepted.snapshot_digest:''};
   const recovery={target_operation_id:row.operation?.operation_id??null,provider_draft_ref:row.operation?.previous?.provider_draft_ref??row.previous?.provider_draft_ref??row.inspected_previous?.provider_draft_ref??row.provider_result?.provider_draft_ref??null,accepted_send:accepted};
   const identity={scope,connection_scope:session.scope,connection:receipt.connection,input,mime_digest:hash(Buffer.alloc(0)),expires_at:new Date(Math.min(now()+300000,Date.parse(receipt.expires_at))).toISOString(),recovery},value={schema_version:'email.mirror_snapshot.v1',scope,identity,input:{...input,snapshot_digest:'sha256:'+digest(identity)},mime_bytes:'',state:'prepared'};
   await store.withLock({key:key(scope,snapshot_id)},async tx=>{await check();if(await tx.read()||!await tx.compareAndSwap({expected_revision:null,value}))fail('EMAIL_MIRROR_SNAPSHOT_CONFLICT');});await check();return structuredClone(value);
  },
  async prepare({scope,session,receipt,record,drafts,sender,parent=null,check}){
   await check();if(record.status!=='draft'||receipt.account_ref!==scope.account_id||sender.account_id!==scope.account_id||!['gmail','microsoft'].includes(sender.provider)||canonical(scope)!==canonical({org_id:session.scope.org_id,owner_user_id:session.scope.owner_user_id,account_id:session.binding.account_id}))fail('EMAIL_MIRROR_SNAPSHOT_DENIED');
   if(['reply','reply_all'].includes(record.content.mode)&&!parent)fail('EMAIL_MIRROR_SOURCE_UNAVAILABLE');
   const selected=record.content.from_identity?.address??sender.primary_address,from=sender.verified_sender_identities.find(address=>address.toLowerCase()===selected.toLowerCase());if(!from)fail('EMAIL_MIRROR_SENDER_DENIED');
   const snapshot_id=randomUUID(),expires_at=new Date(Math.min(now()+300000,Date.parse(receipt.expires_at))).toISOString(),files=[];
   let mime;
   try{
    for(const metadata of record.content.attachments){const file=await drafts.readFile(scope,record.draft_id,metadata.file_id,record.revision,check);files.push({file_id:metadata.file_id,account_id:scope.account_id,org_id:scope.org_id,owner_id:scope.owner_user_id,parent:{kind:'draft',id:record.draft_id},availability:'ready',filename:metadata.filename,media_type:metadata.media_type,byte_count:file.bytes.length,digest:metadata.sha256,expires_at,bytes:file.bytes});}
    const resolved={scope:{org_id:scope.org_id,owner_id:scope.owner_user_id,installation_id:session.scope.installation_id},account_id:scope.account_id,authority_epoch:sender.authority_epoch,provider:sender.provider,verified_from:sender.verified_sender_identities.map(address=>({address,display_name:address===sender.primary_address?sender.display_label:''})),captured_at:new Date(now()).toISOString(),message_id:`<${snapshot_id}@deft.invalid>`,limits:{max_recipients:200,max_body_bytes:1024*1024,max_files:32,max_file_bytes:25*1024*1024,max_total_file_bytes:25*1024*1024,max_mime_bytes:Math.min(receipt.policy.max_mime_bytes,sender.provider==='microsoft'?3*1024*1024:35*1024*1024),allowed_media_types:[...new Set(files.map(file=>file.media_type).concat('text/plain'))].slice(0,32)},draft:{account_id:scope.account_id,draft_id:record.draft_id,revision:record.revision,mode:record.content.mode,from:{address:from,display_name:from===sender.primary_address?sender.display_label:''},to:parsedNativeMailboxes(record.content.to),cc:parsedNativeMailboxes(record.content.cc),bcc:parsedNativeMailboxes(record.content.bcc),subject:record.content.subject,body_format:record.content.body_html?'safe_html':'plain',body_bytes:Buffer.from(record.content.body),...(record.content.body_html?{body_html_bytes:Buffer.from(record.content.body_html)}:{}),reply_parent:parent,files}};
    mime=await serializeNativeDraft(resolved,{account_id:scope.account_id,draft_id:record.draft_id,expected_revision:record.revision});await check();
    const operation=receipt.operation??'create',input={mirror_receipt_id:receipt.receipt_id,mirror_receipt_revision:receipt.revision,mirror_policy_digest:receipt.policy_digest,record_store_key:receipt.store_key,record_id:record.draft_id,record_revision:record.revision,content_digest:'sha256:'+record.content_digest,snapshot_id,mirror_operation:operation,accepted_submission_id:'',accepted_snapshot_id:'',accepted_snapshot_digest:''};
    const identity={scope,connection_scope:session.scope,connection:receipt.connection,input,mime_digest:mime.mime_digest,expires_at},value={schema_version:'email.mirror_snapshot.v1',scope,identity,input:{...input,snapshot_digest:'sha256:'+digest(identity)},mime_bytes:Buffer.from(mime.mime_bytes).toString('base64url'),state:'prepared'};
    await store.withLock({key:key(scope,snapshot_id)},async tx=>{await check();if(await tx.read()||!await tx.compareAndSwap({expected_revision:null,value}))fail('EMAIL_MIRROR_SNAPSHOT_CONFLICT');});await check();return structuredClone(value);
   }finally{mime?.mime_bytes.fill(0);files.forEach(file=>file.bytes.fill(0));}
  },
 });
}
