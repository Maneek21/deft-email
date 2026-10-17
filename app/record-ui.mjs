import {RECORD_CHANGE_CONTROLS} from './settings-ui.mjs';
/** App-owned view data only. The trusted host loads complete records and source
 * bytes through public ports; this module never receives document/file bytes. */
export const EMAIL_RECORD_FORM_PROFILE=Object.freeze({schema_version:'deft.record_form_profile.v3',max_record_bytes:480*1024,
 fields:[{kind:'verified_identity',field:'from_identity',identity_field:'address',label:'From',editable:false},
  {kind:'text',field:'to',label:'To',max_characters:16384,required:false,format:'mailbox_list',presentation:'pills'},
  {kind:'text',field:'cc',label:'Cc',max_characters:16384,required:false,optional:true,format:'mailbox_list',presentation:'pills'},
  {kind:'text',field:'bcc',label:'Bcc',max_characters:16384,required:false,optional:true,format:'mailbox_list',presentation:'pills'},
  {kind:'text',field:'subject',label:'Subject',max_characters:998,required:false}],
 labels:{save:'Save draft',review:'Review & send',submitted:'Message submitted',readonly:'Draft is read-only',scheduled:'Manage scheduled Send',initial_change_unavailable:'Default signature unavailable'},
 review:{title:'Review message',confirm_label:'Send message',description:'Check the exact saved sender, recipients, message and files before sending.',supplemental_effect:{label:'Sent copy',fields:[{field:'mode',label:'Copy policy'},{field:'mailbox',label:'Destination'},{field:'message_id',label:'Message ID'},{field:'uidvalidity',label:'Sent folder version'}]}},
 richtext:{html_field:'body_html',plain_field:'body',label:'Message',max_characters:262144,links:'host_validated',inline_images:'host_files'},
 files:{field:'attachments',archive_name_field:'subject',max_files:32,max_file_bytes:25*1024*1024,max_total_bytes:25*1024*1024}});
export const EMAIL_DRAFT_NOTE_PROFILE=Object.freeze({...EMAIL_RECORD_FORM_PROFILE,fields:[...EMAIL_RECORD_FORM_PROFILE.fields,{kind:'text',field:'author_note',label:'Private draft note (not sent)',max_characters:1000,required:false,optional:true}]});
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value);
const digest=value=>typeof value==='string'&&/^sha256:[a-f0-9]{64}$/u.test(value);
export function emailRecordForm(record,{disabled=false,allowAction=true}={}){
 if(!uuid(record?.record_id)||!Number.isSafeInteger(record.revision)||record.revision<(record.seed?0:1)||!digest(record.content_digest))throw Error('EMAIL_DRAFT_REFERENCE_INVALID');
 if(record.source_refs!==undefined&&(!Array.isArray(record.source_refs)||record.source_refs.length>1||record.source_refs.some(ref=>!ref||typeof ref!=='object'||Array.isArray(ref)||Object.keys(ref).sort().join(',')!=='content_digest,record_id,resource_key'||ref.resource_key!=='inbox'||!uuid(ref.record_id)||!digest(ref.content_digest))))throw Error('EMAIL_DRAFT_SOURCE_INVALID');
 return {kind:'record_form',id:'draft_form',label:'Message draft',store_key:'drafts',record_id:record.record_id,
  expected_revision:record.revision,content_digest:record.content_digest,...(record.seed?{seed:record.seed}:{}),profile:Object.hasOwn(record.seed?.value??{},'author_note')||record.summary?.author_note_supported===true?EMAIL_DRAFT_NOTE_PROFILE:EMAIL_RECORD_FORM_PROFILE,...(record.source_refs===undefined?{}:{source_refs:record.source_refs.map(ref=>({...ref}))}),...(allowAction?{action_key:'send_message',record_changes:RECORD_CHANGE_CONTROLS.map(control=>({...control}))}:record.status==='submitted'&&uuid(record.summary?.future_submission_id)?{action_key:'send_message'}:{}),disabled};
}
export function emailRecordDocument(record,{id='mail_body',printControl='print_message'}={}){
 if(!uuid(record?.record_id)||!digest(record.content_digest))throw Error('EMAIL_SOURCE_REFERENCE_INVALID');
 return {kind:'record_document',id,profile_version:'deft.record_document.v1',store_key:'drafts',resource_key:'inbox',
  record_id:record.record_id,content_digest:record.content_digest,printable:true,print_control_id:printControl};
}
export function emptyEmailRecord(mode='compose',parent=null){
 if(!['compose','reply','reply_all','forward'].includes(mode)||mode!=='compose'&&!uuid(parent?.record_id))throw Error('EMAIL_COMPOSE_INTENT_INVALID');
 return {mode,to:'',cc:'',bcc:'',subject:'',body:'',body_html:'',reply_record_id:'',attachments:[],author_note:''};
}
export function emailRecordEvent(previous,event){
 if(event?.record_seed===true){if(!previous?.seed||previous.revision!==0||event.node_id!=='draft_form'||event.expected_seed_record_id!==previous.record_id||event.record_revision!==0||!uuid(event.record_id)||event.content_digest!=='sha256:'+'0'.repeat(64)||event.dirty!==false||event.record_state!=='saved')throw Error('EMAIL_SEED_IDENTITY_INVALID');return {...previous,record_id:event.record_id};}
 if(event?.node_id!=='draft_form'||event.record_id!==previous?.record_id||!Number.isSafeInteger(event.record_revision)
  ||event.record_revision<previous.revision||!digest(event.content_digest)||!['saved','saving','unsaved','blocked','submitted'].includes(event.record_state)
  ||typeof event.dirty!=='boolean'||typeof event.valid!=='boolean')throw Error('EMAIL_DRAFT_EVENT_INVALID');
 return {...previous,...(event.record_revision>0?{seed:undefined,...(Object.hasOwn(previous.seed?.value??{},'author_note')?{summary:{...previous.summary,author_note_supported:true}}:{})}:{}),revision:event.record_revision,content_digest:event.content_digest,state:event.record_state,dirty:event.dirty,valid:event.valid};
}
