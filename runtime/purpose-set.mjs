import {canonical,digest,fail} from './contract.mjs';
export const purposeCapabilities=Object.freeze({send_message:'send',organize_messages:'modify',mirror_drafts:'modify'});
export function capabilitiesFor(actions){
 if(!Array.isArray(actions)||actions.some(action=>!Object.hasOwn(purposeCapabilities,action.action_key)))fail('EMAIL_RUNTIME_ACTION_UNSUPPORTED');
 return [...new Set(['read','search','thread',...actions.map(action=>purposeCapabilities[action.action_key])])];
}
export const credentialAnchor=(account_id,prior=null)=>prior??'email-purpose:'+account_id;
export function sealPurposeSet(binding,actions,custody_generation){
 const value={schema_version:'email.runtime_purpose_set.v1',credential_anchor:binding.action_binding_id,authority_epoch:binding.authority_epoch,custody_generation,action_consents:structuredClone(actions),capabilities:capabilitiesFor(actions)};
 if(canonical(value.capabilities)!==canonical(binding.capabilities)||actions.length&&!binding.action_binding_id)fail('EMAIL_RUNTIME_ACTION_DENIED');
 return {...value,digest:'sha256:'+digest(value)};
}
export function purposeFor(session,action_key,now=Date.now){
 if(!Object.hasOwn(session,'action_consents')){
  const action=session.action_consent;
  if(!action||action.action_key!==action_key||session.binding.action_binding_id!==action.action_binding_id||Date.parse(action.expires_at)<=now())fail('EMAIL_RUNTIME_ACTION_DENIED');return action;
 }
 const set=session.purpose_set;
 if(!set||canonical(set)!==canonical(sealPurposeSet(session.binding,session.action_consents,set.custody_generation)))fail('EMAIL_RUNTIME_ACTION_DENIED');
 const action=session.action_consents.find(value=>value.action_key===action_key);
 if(!action||Date.parse(action.expires_at)<=now()||!session.binding.capabilities.includes(purposeCapabilities[action_key]))fail('EMAIL_RUNTIME_ACTION_DENIED');return action;
}
