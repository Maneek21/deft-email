import {EMAIL_PROVIDER_SETUP_NOTE,emailProviderSupport} from './provider-admission.mjs';
// Full saved content is loaded and edited exclusively by the trusted host.
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value);
const digest=value=>typeof value==='string'&&/^sha256:[a-f0-9]{64}$/u.test(value);
const text=(field,label,max_characters,required=false)=>({kind:'text',field,label,max_characters,required});
export const SETTINGS_PROFILES=Object.freeze({
 smtp_preferences:{schema_version:'deft.record_form_profile.v2',max_record_bytes:1024,fields:[{kind:'choice',field:'sent_copy_mode',label:'When sending through SMTP',options:[{value:'server_managed',label:'Let the mail server manage Sent copies'},{value:'append_exact',label:'Let Deft save an exact copy in Sent'}]}]},
 templates:{schema_version:'deft.record_form_profile.v2',max_record_bytes:491520,fields:[text('title','Title',120,true),text('subject','Subject',998)],richtext:{html_field:'body_html',plain_field:'body',label:'Template text',max_html_characters:262144,max_plain_characters:262144,links:'host_validated',inline_images:'none'}},
 preferences:{schema_version:'deft.record_form_profile.v2',max_record_bytes:8192,fields:[{kind:'choice',field:'external_images',label:'External images',options:[{value:'ask',label:'Ask before loading external images'},{value:'always',label:'Always load external images for this account'}]}]},
 signatures:{schema_version:'deft.record_form_profile.v2',max_record_bytes:65536,fields:[{kind:'verified_identity',field:'address',label:'From',editable:false},{kind:'choice',field:'placement',label:'Automatically use for',activation:{field:'automatic',schema_version:'deft.signature_automatic.v1',inactive_value:'none'},options:[{value:'both',label:'New messages and replies'},{value:'new',label:'New messages'},{value:'reply',label:'Replies'},{value:'none',label:'Manual use only'}]}],richtext:{html_field:'html',plain_field:'plain',label:'Signature',max_html_characters:16384,max_plain_characters:2048,links:'host_validated',inline_images:'none'}},
});
export const RECORD_CHANGE_CONTROLS=Object.freeze([
 {operation_key:'template_append',source_store_key:'templates',label:'Append template',parameters:'runtime_prompt'},
 {operation_key:'template_replace',source_store_key:'templates',label:'Replace with template',parameters:'runtime_prompt'},
 {operation_key:'signature_apply',source_store_key:'signatures',label:'Apply signature'},
 {operation_key:'signature_remove',source_store_key:'signatures',label:'Remove managed signature'},
]);
export function settingMeta(store,record){
 if(!Object.hasOwn(SETTINGS_PROFILES,store)||record?.store_key!==undefined&&record.store_key!==store||!uuid(record?.record_id)||!Number.isSafeInteger(record.revision)||record.revision<1||!digest(record.content_digest)||!['draft','archived'].includes(record.status))throw Error('EMAIL_SETTING_REFERENCE_INVALID');
 const summary={...(typeof record.summary?.automatic_enabled==='boolean'?{automatic_enabled:record.summary.automatic_enabled}:{})};for(const field of ['title','subject','address','placement','external_images','sent_copy_mode','sent_copy_reason'])if(typeof record.summary?.[field]==='string')summary[field]=record.summary[field];
 for(const field of ['smtp_supported','append_available'])if(typeof record.summary?.[field]==='boolean')summary[field]=record.summary[field];
 return {store_key:store,record_id:record.record_id,revision:record.revision,content_digest:record.content_digest,status:record.status,summary,state:'saved',dirty:false,valid:record.status==='draft'};
}
export function settingRecordForm(store,record){const meta=settingMeta(store,record);let profile=SETTINGS_PROFILES[store];if(store==='smtp_preferences'&&meta.summary.append_available===false&&meta.summary.sent_copy_mode==='server_managed')profile={...profile,fields:[{...profile.fields[0],options:[profile.fields[0].options[0]]}]};return {kind:'record_form',id:'setting_form_'+store+'_'+meta.record_id.replaceAll('-','').toLowerCase(),label:store==='smtp_preferences'?'SMTP Sent copies':store==='templates'?'Saved template':store==='preferences'?'Reading preferences':'Saved signature',store_key:store,record_id:meta.record_id,expected_revision:meta.revision,content_digest:meta.content_digest,profile,disabled:meta.status!=='draft'||store==='smtp_preferences'&&meta.summary.smtp_supported===false};}
export function settingRecordEvent(previous,event){
 if(event?.node_id!=='setting_form_'+previous.store_key+'_'+String(previous.record_id).replaceAll('-','').toLowerCase()||event.record_id!==previous?.record_id||!Number.isSafeInteger(event.record_revision)||event.record_revision<previous.revision||!digest(event.content_digest)||!['saved','saving','unsaved','blocked'].includes(event.record_state)||typeof event.dirty!=='boolean'||typeof event.valid!=='boolean')throw Error('EMAIL_SETTING_EVENT_INVALID');
 return {...previous,revision:event.record_revision,content_digest:event.content_digest,state:event.record_state,dirty:event.dirty,valid:event.valid};
}
export function verifiedSettingIdentities(result){
 if(result?.outcome!=='completed'||!Array.isArray(result.identities)||result.identities.length>32)throw Error('EMAIL_IDENTITY_UNAVAILABLE');
 const identities=result.identities.map(identity=>{if(typeof identity?.address!=='string'||identity.address.length>320||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(identity.address)||/[\u0000-\u001f\u007f-\u009f]/u.test(identity.address)||typeof identity.label!=='string'||identity.label.length>512)throw Error('EMAIL_IDENTITY_UNAVAILABLE');return {address:identity.address,label:identity.label};});
 if(new Set(identities.map(identity=>identity.address.toLowerCase())).size!==identities.length)throw Error('EMAIL_IDENTITY_UNAVAILABLE');return identities;
}

/** Readable declared support, not current consent or live provider certification. */
export function providerSettingsNodes(){return [{kind:'text',id:'provider_setup_help',text:EMAIL_PROVIDER_SETUP_NOTE,tone:'caption'},...['gmail','microsoft','imap_smtp'].map(provider=>{const support=emailProviderSupport(provider);return {kind:'text',id:'provider_support_'+provider,text:support.label+': '+support.notice,tone:'caption'};})];}
