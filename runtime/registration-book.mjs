import {exact,fail,validateRegistration} from './contract.mjs';

const KEY='email.imap.form.registrations';
const VERSION='email.imap.form.registrations.v1';
const FIELDS=Object.freeze(['org_id','runtime_registration_id','operator_user_id','runtime_epoch','profile_digest','target_key','resource_key']);
export const REGISTRATION_BOOK_LIMIT=256;
const pinsOf=scope=>validateRegistration(Object.fromEntries(FIELDS.map(field=>[field,scope?.[field]])));
const sameIdentity=(row,pins)=>row.org_id===pins.org_id&&row.runtime_registration_id===pins.runtime_registration_id;
const samePins=(row,pins)=>FIELDS.every(field=>row[field]===pins[field]);

/** Which registrations this credential-form runtime serves.
 *
 * Configured registrations are exact operator pins and never change here.
 *
 * With `admission: "host_authority"` (deployment configuration only) the
 * runtime may additionally serve a registration it was not configured with,
 * once its one configured Host has confirmed that exact registration over the
 * authenticated authority call. Such a registration is saved in the runtime's
 * own encrypted store, so no configuration edit or restart is needed and a
 * restart keeps it. This suits a deployment where the Host and this runtime are
 * one isolated installation: the identifiers a registration is pinned to exist
 * only after its owner has signed up, so no operator could have written them.
 *
 * Bounds on what the Host can make this runtime accept:
 * - the first organisation seen (configured or confirmed) is the only one;
 * - at most REGISTRATION_BOOK_LIMIT confirmed registrations;
 * - a confirmed registration is replaced only by the same or a later epoch.
 * Without the setting nothing is ever added and behaviour is unchanged. */
export async function createRegistrationBook({configured,store,admission,limit=REGISTRATION_BOOK_LIMIT}){
 if(!Array.isArray(configured)||admission!==undefined&&admission!=='host_authority'||!Number.isInteger(limit)||limit<1||limit>REGISTRATION_BOOK_LIMIT)fail('EMAIL_FORM_CONFIG_INVALID');
 const fixed=configured.map(({connection_protocol,...pins})=>validateRegistration(pins)),admits=admission==='host_authority';
 const parse=value=>{if(value===undefined)return [];exact(value,['schema_version','entries']);if(value.schema_version!==VERSION||!Array.isArray(value.entries)||value.entries.length>REGISTRATION_BOOK_LIMIT)fail('EMAIL_RUNTIME_STORE_ROW_INVALID');
  const entries=value.entries.map(validateRegistration);if(new Set(entries.map(row=>row.org_id+':'+row.runtime_registration_id)).size!==entries.length)fail('EMAIL_RUNTIME_STORE_ROW_INVALID');return entries;};
 // Saved registrations are read only when the setting is on, so turning it off
 // returns the runtime to exactly its configured list.
 let confirmed=admits?parse((await store.withLock({key:KEY},tx=>tx.read()))?.value):[];
 function decideWith(entries,pins){
  const pinned=fixed.find(row=>sameIdentity(row,pins));if(pinned)return samePins(pinned,pins)?'known':'denied';
  const held=entries.find(row=>sameIdentity(row,pins));if(held&&samePins(held,pins))return 'known';
  if(!admits)return 'denied';
  const organisation=fixed[0]?.org_id??entries[0]?.org_id;
  if(organisation!==undefined&&organisation!==pins.org_id||fixed.some(row=>row.org_id!==fixed[0].org_id))return 'denied';
  if(held?pins.runtime_epoch<held.runtime_epoch:entries.length>=limit)return 'denied';
  return 'ask_host';
 }
 return Object.freeze({
  /** Every registration currently served, in the shape the data runtimes read. */
  all:()=>[...fixed,...confirmed].map(pins=>({...pins,connection_protocol:'credential_form.v1'})),
  /** 'known' | 'ask_host' | 'denied'. Never performs I/O. */
  decide(scope){let pins;try{pins=pinsOf(scope);}catch{return 'denied';}return decideWith(confirmed,pins);},
  /** Call only after the Host confirmed this exact scope. Re-decides against the
   * saved row under its lock, so two confirmations cannot both pass a bound. */
  async confirm(scope){const pins=pinsOf(scope);
   confirmed=await store.withLock({key:KEY},async tx=>{const row=await tx.read(),entries=parse(row?.value),decision=decideWith(entries,pins);
    if(decision==='known')return entries;if(decision!=='ask_host')fail('EMAIL_FORM_REGISTRATION_DENIED');
    const next=[...entries.filter(entry=>!sameIdentity(entry,pins)),pins];
    if(!await tx.compareAndSwap({expected_revision:row?.revision??null,value:{schema_version:VERSION,entries:next}}))fail('EMAIL_FORM_CONFLICT');return next;});
  },
 });
}
