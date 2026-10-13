import {digest,exact,fail,opaque} from './contract.mjs';
import {uuid} from './draft-store.mjs';

export const RULE_ACTIONS=Object.freeze(['mark_read','mark_unread','star','unstar','archive','trash']);
const controls=/[\u0000-\u001f\u007f-\u009f]/u;
const positive=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483646;
const hash=value=>typeof value==='string'&&/^sha256:[a-f0-9]{64}$/u.test(value);
const text=(value,length,bytes)=>typeof value==='string'&&value.trim().length>0&&value===value.trim()&&value.length<=length&&Buffer.byteLength(value)<=bytes&&!controls.test(value);
function condition(value){
  exact(value,['field','operator','value']);
  if(typeof value.value==='string')value.value=value.value.trim();
  if(!['from','to','cc','subject','folder'].includes(value.field)||!['equals','contains','starts_with'].includes(value.operator)||!text(value.value,256,512))fail('EMAIL_RULE_INVALID');
}
/** Shipped manual-rule grammar. Saving an enabled rule does not grant effects. */
export function validateRuleValue(value){
  exact(value,['enabled','name','match','conditions','exceptions','actions','stop_processing','execution_location']);
  value=structuredClone(value);
  if(typeof value.name==='string')value.name=value.name.trim();
  if(typeof value.enabled!=='boolean'||!text(value.name,80,160)||!['all','any'].includes(value.match)||!Array.isArray(value.conditions)||value.conditions.length<1||value.conditions.length>10||!Array.isArray(value.exceptions)||value.exceptions.length>10||!Array.isArray(value.actions)||value.actions.length<1||value.actions.length>6||new Set(value.actions).size!==value.actions.length||value.actions.some(action=>!RULE_ACTIONS.includes(action))||typeof value.stop_processing!=='boolean'||value.execution_location!=='deft_service'||Buffer.byteLength(JSON.stringify(value))>32768)fail('EMAIL_RULE_INVALID');
  value.conditions.forEach(condition);value.exceptions.forEach(condition);
  return structuredClone(value);
}
const normalize=value=>value.normalize('NFKC').trim().toLowerCase();
function matches(record,condition){
  const values=condition.field==='folder'?record.folders:[record.data[condition.field==='from'?'sender':condition.field==='to'?'recipients':condition.field==='cc'?'cc':'subject']??''];
  const expected=normalize(condition.value);
  return values.some(value=>{const actual=normalize(String(value));return condition.operator==='equals'?actual===expected:condition.operator==='contains'?actual.includes(expected):actual.startsWith(expected);});
}
export function evaluateRule(value,record){
  value=validateRuleValue(value);
  if(!record||!Array.isArray(record.folders)||record.folders.some(value=>typeof value!=='string')||!record.data||typeof record.data!=='object'||Array.isArray(record.data))fail('EMAIL_RULE_INVALID');
  const conditions=value.conditions.map(item=>matches(record,item)),exceptions=value.exceptions.map(item=>matches(record,item));
  const conditions_match=value.match==='all'?conditions.every(Boolean):conditions.some(Boolean),excluded=exceptions.some(Boolean);
  return {enabled:value.enabled,conditions_match,excluded,matched:value.enabled&&conditions_match&&!excluded,conditions,exceptions};
}
/** Current cached page only. This nominates exact references for a separate
 * reviewed Organize operation; it never executes, schedules or grants access. */
export function previewRules({account_id,rules,loadedRows,selected_record_ids=null}){
  if(!opaque(account_id)||!Array.isArray(rules)||rules.length>100||!Array.isArray(loadedRows)||loadedRows.length>50)fail('EMAIL_RULE_INVALID');
  const ids=new Set();for(const row of loadedRows){if(row.account_id!==account_id||!uuid(row.record_id)||!hash(row.content_digest)||ids.has(row.record_id)||row.deleted===true||row.tombstone===true)fail('EMAIL_RULE_SOURCE_DENIED');ids.add(row.record_id);}
  const ruleIds=new Set();for(const rule of rules){if(!uuid(rule.record_id)||ruleIds.has(rule.record_id)||!positive(rule.revision)||rule.status!=='draft'||!hash(rule.content_digest)||rule.content_digest!=='sha256:'+digest(validateRuleValue(rule.value)))fail('EMAIL_RULE_INVALID');ruleIds.add(rule.record_id);}
  if(selected_record_ids!==null&&(!Array.isArray(selected_record_ids)||selected_record_ids.length<1||selected_record_ids.length>25||new Set(selected_record_ids).size!==selected_record_ids.length||selected_record_ids.some(id=>!ids.has(id))))fail('EMAIL_RULE_INVALID');
  const items=loadedRows.map(row=>{
    const matches=[];let stopped=false;
    for(const rule of rules){const result=evaluateRule(rule.value,row);matches.push({rule_id:rule.record_id,rule_revision:rule.revision,rule_content_digest:rule.content_digest,...result,skipped:stopped,actions:!stopped&&result.matched?[...rule.value.actions]:[]});if(!stopped&&result.matched&&rule.value.stop_processing)stopped=true;}
    return {source:{resource_key:'inbox',record_id:row.record_id,content_digest:row.content_digest},matches};
  });
  const candidates=items.filter(item=>item.matches.some(match=>match.actions.length));
  const selected=selected_record_ids===null?candidates:candidates.filter(item=>selected_record_ids.includes(item.source.record_id));
  return {scope:'current_cached_page',execution_location:'deft_service',automatic_execution:false,rule_set_digest:'sha256:'+digest(rules.map(row=>[row.record_id,row.revision,row.content_digest])),items,matched_count:candidates.length,requires_selection:selected.length>25,review_targets:selected.length>25?[]:selected};
}
