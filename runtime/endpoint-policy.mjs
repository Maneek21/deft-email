import {exact,fail} from './contract.mjs';

const host=value=>typeof value==='string'&&value.length<=253&&/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(value);
// Names that can only ever mean a private network. Refusing them before any
// lookup also keeps the form from revealing which internal names exist.
const PRIVATE_SUFFIXES=Object.freeze(['.localhost','.local','.internal','.lan','.home.arpa']);
const nameIsPublic=value=>host(value)&&!PRIVATE_SUFFIXES.some(suffix=>value.endsWith(suffix));

/** Which mail servers an owner may nominate. Deployment configuration only.
 *
 * - `{imap_hosts,smtp_hosts}`: an exact operator list (at most 32 each).
 * - `{mode:"public_addresses"}`: any public mail server. This setting adds no
 *   address check of its own and removes none: every connection the runtime
 *   opens still resolves the whole address set, refuses it if any address is
 *   not public, pins one address and verifies the certificate against the
 *   nominated name (imap-connector.mjs). The policy only stops requiring the
 *   name to be on a list.
 *
 * Anything else, including a mix of both forms, refuses to start. */
export function resolveEndpointPolicy(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('EMAIL_FORM_CONFIG_INVALID');
 if(Object.hasOwn(raw,'mode')){
  try{exact(raw,['mode']);}catch{fail('EMAIL_FORM_CONFIG_INVALID');}
  if(raw.mode!=='public_addresses')fail('EMAIL_FORM_CONFIG_INVALID');
  return Object.freeze({mode:'public_addresses',allows:profile=>nameIsPublic(profile?.imap?.host)&&(!profile.smtp||nameIsPublic(profile.smtp.host))});
 }
 try{exact(raw,['imap_hosts','smtp_hosts']);}catch{fail('EMAIL_FORM_CONFIG_INVALID');}
 for(const field of ['imap_hosts','smtp_hosts']){const values=raw[field];if(!Array.isArray(values)||values.length>32||field==='imap_hosts'&&!values.length||values.some(value=>!host(value))||new Set(values).size!==values.length)fail('EMAIL_FORM_CONFIG_INVALID');}
 const imap=new Set(raw.imap_hosts),smtp=new Set(raw.smtp_hosts);
 return Object.freeze({mode:'listed_hosts',allows:profile=>imap.has(profile?.imap?.host)&&(!profile.smtp||smtp.has(profile.smtp.host))});
}
