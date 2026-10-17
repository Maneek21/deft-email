import {AppRecordChangeParametersSchema} from '@deft/app-kit';
import {parseNativeSafeComposeHtml} from './domain/safe-compose-html.mjs';
import {validateSettingValue} from './settings-store.mjs';
import {fail} from './contract.mjs';
const marker=/\{\{([A-Za-z][A-Za-z0-9_]{0,63})\}\}/gu;
const names=content=>[...new Set([content.subject,content.body,content.body_html].flatMap(text=>[...text.matchAll(marker)].map(match=>match[1])))].sort();
/** Behavioral port of frozen renderNativeTemplate: replacement occurs only in
 * message text, escapes rich text, derives paired plain text and never expands
 * a second marker. Names come solely from the current validated saved source. */
export function renderTemplateParameters(contentRaw,raw){
 const content=validateSettingValue('templates',contentRaw),parsed=AppRecordChangeParametersSchema.safeParse(raw);
 if(!parsed.success)fail('EMAIL_TEMPLATE_PARAMETERS_INVALID');const parameters=parsed.data,fields=names(content);
 if(fields.some(name=>['constructor','prototype','__proto__'].includes(name))||Object.keys(parameters).some(name=>!fields.includes(name)))fail('EMAIL_TEMPLATE_PARAMETERS_INVALID');
 const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 const substitute=(text,html=false)=>text.replace(marker,(literal,name)=>Object.hasOwn(parameters,name)?html?escape(parameters[name]):parameters[name]:literal);
 const body_html=content.body_html?content.body_html.split(/(<[^>]*>)/gu).map(part=>{if(part.startsWith('<')){if(/\{\{[A-Za-z][A-Za-z0-9_]{0,63}\}\}/u.test(part))fail('EMAIL_TEMPLATE_PARAMETERS_INVALID');return part;}return substitute(part,true);}).join(''):'';
 const body=body_html?parseNativeSafeComposeHtml(body_html,{maxCharacters:262144,maxBytes:491520}).plainText:substitute(content.body);
 const value=validateSettingValue('templates',{...content,subject:substitute(content.subject),body,body_html});
 return {value,parameters:structuredClone(parameters),parameter_fields:fields.map(key=>({key,label:key,max_characters:8192})),unresolved:names(value)};
}
