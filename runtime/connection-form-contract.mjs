import {exact,fail,canonical,digest,validateScope,validateRegistration,isoTime,opaque} from './contract.mjs';
export const FORM_VERSION='deft.app_connection_form_runtime.v1';
export const FORM_LIMITS=Object.freeze({json_bytes:65536,setup_ms:60000,input_lease_ms:300000,dns_ms:5000,connect_ms:20000});
export const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value);
export function validateFormRequest(raw){
 exact(raw,['schema_version','session_id','scope','operation','expires_at','setup_expires_at','action_consents','source',...(raw?.operation==='begin'?[]:['runtime_session_ref'])]);
 if(raw.schema_version!==FORM_VERSION||!uuid(raw.session_id)||!['begin','status','disconnect'].includes(raw.operation)||(!isoTime(raw.expires_at)||!isoTime(raw.setup_expires_at)))fail('EMAIL_FORM_INPUT_INVALID');
 validateScope(raw.scope);if(Date.parse(raw.expires_at)>Date.parse(raw.scope.consent_expires_at)||Date.parse(raw.setup_expires_at)>Date.parse(raw.scope.consent_expires_at))fail('EMAIL_FORM_INPUT_INVALID');
 if(raw.operation!=='begin'&&!(raw.operation==='status'&&raw.runtime_session_ref===null)&&!opaque(raw.runtime_session_ref))fail('EMAIL_FORM_INPUT_INVALID');
 if(!Array.isArray(raw.action_consents)||raw.action_consents.length>2)fail('EMAIL_FORM_INPUT_INVALID');
 let previous='';const bindings=new Set();for(const consent of raw.action_consents){exact(consent,['action_binding_id','action_key','authority_epoch','consent_id','consent_digest','expires_at']);
  if(!uuid(consent.action_binding_id)||!uuid(consent.consent_id)||consent.consent_id!==consent.action_binding_id||bindings.has(consent.action_binding_id)||!['organize_messages','send_message'].includes(consent.action_key)||consent.action_key<=previous||!Number.isInteger(consent.authority_epoch)||consent.authority_epoch<0||!/^sha256:[a-f0-9]{64}$/u.test(consent.consent_digest)||!isoTime(consent.expires_at)||Date.parse(consent.expires_at)>Date.parse(raw.scope.consent_expires_at))fail('EMAIL_FORM_INPUT_INVALID');previous=consent.action_key;bindings.add(consent.action_binding_id);}
 if(raw.source!==null){exact(raw.source,['session_id','session_revision','scope','runtime_session_ref','account_ref']);validateScope(raw.source.scope);if(!uuid(raw.source.session_id)||!Number.isInteger(raw.source.session_revision)||raw.source.session_revision<1||!opaque(raw.source.runtime_session_ref)||!opaque(raw.source.account_ref)||raw.source.session_id===raw.session_id)fail('EMAIL_FORM_INPUT_INVALID');}
 return structuredClone(raw);
}
export function formRegistration(raw){exact(raw,['connection_protocol','org_id','runtime_registration_id','operator_user_id','runtime_epoch','profile_digest','target_key','resource_key']);if(raw.connection_protocol!=='credential_form.v1')fail('EMAIL_FORM_CONFIG_INVALID');const {connection_protocol,...pins}=raw;return validateRegistration(pins);}
export const formIdentity=request=>digest({session_id:request.session_id,scope:request.scope,action_consents:request.action_consents,source:request.source,setup_expires_at:request.setup_expires_at});
export const formReceiptDigest=receipt=>'sha256:'+digest(Object.fromEntries(Object.entries(receipt).filter(([key])=>key!=='digest')));
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/u.test(value);
export function validateCredentialInput(raw){
 exact(raw,['imap','smtp','primary_address','display_label']);const server=(value,kind)=>{exact(value,['host','port','transport','username','password']);
 if(!text(value.host,253)||value.host!==value.host.toLowerCase()||!/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(value.host)||!text(value.username,512)||!text(value.password,8192)||!['implicit_tls','starttls_required'].includes(value.transport)||value.port!==(kind==='imap'?(value.transport==='implicit_tls'?993:143):(value.transport==='implicit_tls'?465:587)))fail('EMAIL_FORM_INPUT_INVALID');return structuredClone(value);};
 if(!text(raw.primary_address,320)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(raw.primary_address)||!text(raw.display_label,200)||Buffer.byteLength(JSON.stringify(raw))>FORM_LIMITS.json_bytes)fail('EMAIL_FORM_INPUT_INVALID');
 return {imap:server(raw.imap,'imap'),smtp:raw.smtp===null?null:server(raw.smtp,'smtp'),primary_address:raw.primary_address,display_label:raw.display_label};
}
export const credentialPrincipal=(scope,profile)=>digest({schema_version:'email.imap_principal.v1',org_id:scope.org_id,owner_user_id:scope.owner_user_id,host:profile.imap.host,port:profile.imap.port,transport:profile.imap.transport,username:profile.imap.username});
export const sameFormPins=(a,b)=>canonical({scope:a.scope,source:a.source,action_consents:a.action_consents,setup_expires_at:a.setup_expires_at})===canonical({scope:b.scope,source:b.source,action_consents:b.action_consents,setup_expires_at:b.setup_expires_at});
