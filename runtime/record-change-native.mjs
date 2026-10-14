import {createHash} from 'node:crypto';
import {parseNativeSafeComposeHtml,plainTextToNativeComposeHtml} from './domain/safe-compose-html.mjs';
import {validateDraftContent} from './draft-store.mjs';
import {validateSettingValue} from './settings-store.mjs';
import {fail} from './contract.mjs';
import {renderTemplateParameters} from './template-parameters.mjs';
const normalize=address=>address.trim().toLocaleLowerCase('en-US');
const identityKey=address=>createHash('sha256').update(normalize(address)).digest('hex');
const detach=content=>{const next=structuredClone(content);delete next.managed_signature;return next;};
/** Behavioral port of frozen native template insertion and terminal signature
 * region helpers. No HTTP client, authority inference, or automatic application. */
function intact(content){const region=content.managed_signature;if(!region||!content.from_identity||identityKey(content.from_identity.address)!==region.identity_key||content.body.slice(region.plain.start)!==region.plain.text)return false;if(region.rich===null)return content.body_html==='';try{return content.body_html.slice(region.rich.start)===region.rich.html&&parseNativeSafeComposeHtml(content.body_html,{inlineAttachments:content.attachments}).plainText===content.body&&(region.rich.start===0?'':parseNativeSafeComposeHtml(content.body_html.slice(0,region.rich.start),{inlineAttachments:content.attachments}).plainText).length===region.plain.start;}catch{return false;}}
export function buildRecordChange({operation_key,invocation_mode,destination,source,identities,primary_identity=null,parameters}){
 if(invocation_mode!==undefined&&(invocation_mode!=='initial'||operation_key!=='signature_default')||operation_key==='signature_default'&&invocation_mode!=='initial')fail('EMAIL_RECORD_CHANGE_INVALID');
 const current=validateDraftContent(destination.content),sourceValue=validateSettingValue(source.store_key,source.value);let value,warnings=[],description;
 if(parameters!==undefined&&!['template_append','template_replace'].includes(operation_key))fail('EMAIL_TEMPLATE_PARAMETERS_INVALID');
 let rendered=null;
 if(operation_key==='template_append'||operation_key==='template_replace'){
  if(source.store_key!=='templates')fail('EMAIL_RECORD_CHANGE_INVALID');rendered=parameters===undefined?null:renderTemplateParameters(sourceValue,parameters);let {subject,body,body_html}=rendered?.value??sourceValue;
  const placeholders=[...new Set([subject,body,body_html].flatMap(text=>[...text.matchAll(/\{\{([A-Za-z][A-Za-z0-9_]{0,63})\}\}/gu)].map(match=>match[1])))].sort();
  if(placeholders.length)warnings=['Unresolved placeholders remain literal: '+placeholders.slice(0,7).join(', ')+(placeholders.length>7?' (and '+(placeholders.length-7)+' more)':'')];
  if(operation_key==='template_append'){
   subject=current.subject||subject;
   if(current.body&&body){body=current.body+'\n\n'+body;if(current.body_html||body_html)body_html=(current.body_html||plainTextToNativeComposeHtml(current.body))+'<p></p>'+(body_html||plainTextToNativeComposeHtml(rendered?.value.body??sourceValue.body));}
   else if(current.body){body=current.body;body_html=current.body_html;}
  }
  value=validateDraftContent({...detach(current),subject,body,body_html});description=operation_key==='template_append'?'Append saved template text; existing recipients, sender, files and reply context stay unchanged.':'Replace message subject and body with saved template text; existing recipients, sender, files and reply context stay unchanged.';
 }else if(operation_key==='signature_apply'||operation_key==='signature_remove'||operation_key==='signature_default'){
  if(source.store_key!=='signatures')fail('EMAIL_RECORD_CHANGE_INVALID');const entry=sourceValue,identity=identities.find(row=>normalize(row.address)===normalize(entry.address));if(!identity)fail('EMAIL_SETTINGS_IDENTITY_DENIED');
  if(operation_key==='signature_default'){
   const selected=current.from_identity?.address??primary_identity?.address,kind=['compose','forward'].includes(current.mode)?'new':'reply';
   if(destination.revision!==1||destination.content_revision!==1||destination.status!=='draft'||current.managed_signature||sourceValue.automatic?.enabled!==true||!['both',kind].includes(sourceValue.placement)||!selected||normalize(selected)!==normalize(entry.address)||!identities.some(row=>normalize(row.address)===normalize(selected)))fail('EMAIL_SIGNATURE_DEFAULT_DENIED');
  }
  let base=structuredClone(current);const owned=intact(base),hadMarker=Boolean(base.managed_signature);
  if(operation_key==='signature_remove'&&(!owned||base.managed_signature.identity_key!==identityKey(entry.address)||base.managed_signature.preference_revision!==source.revision))fail('EMAIL_RECORD_CHANGE_MARKER_CHANGED');
  if(owned){const region=base.managed_signature;base.body=base.body.slice(0,region.plain.start);if(region.rich)base.body_html=base.body_html.slice(0,region.rich.start);}
  base=detach(base);
  if(operation_key==='signature_remove'){value=validateDraftContent(base);description='Remove only the exact saved signature terminal region; preserve all other draft text and fields.';}
  else{
   base.from_identity={address:identity.address};if(hadMarker&&!owned)warnings.push('The earlier signature was edited and is kept as message text.');
   if(!entry.plain)value=validateDraftContent(base);
   else{let body_html='',plain,rich=null;if(base.body_html||entry.html){const prefix=base.body_html||plainTextToNativeComposeHtml(base.body),suffix=(prefix?'<p></p>':'')+(entry.html||plainTextToNativeComposeHtml(entry.plain));body_html=prefix+suffix;plain=parseNativeSafeComposeHtml(body_html,{inlineAttachments:base.attachments}).plainText;rich={start:prefix.length,html:suffix};}else plain=base.body+(base.body?'\n\n':'')+entry.plain;
    value=validateDraftContent({...base,body:plain,body_html,managed_signature:{schema_version:'deft.email_signature_region.v1',identity_key:identityKey(identity.address),preference_revision:source.revision,plain:{start:base.body.length,text:plain.slice(base.body.length)},rich}});if(!intact(value))fail('EMAIL_RECORD_CHANGE_INVALID');}
   description=operation_key==='signature_default'?'Apply the enabled default signature to this untouched initial draft; preserve recipients, files and reply context.':'Apply this explicitly selected saved signature and verified sender; preserve recipients, files and reply context. Empty signatures remove only intact prior managed text.';
  }
 }else fail('EMAIL_RECORD_CHANGE_INVALID');
 return {value,...(rendered?{parameters:rendered.parameters,parameter_fields:rendered.parameter_fields}:{}),preview:{title:operation_key.startsWith('template_')?sourceValue.title:'Saved signature: '+sourceValue.address,description,warnings}};
}
