/** Requested profile names only. Exact protocol, origins, operator registrations,
 * credentials and action consents are separately admitted by the generic host. */
export const EMAIL_PROVIDER_CONNECTIONS=Object.freeze([
 Object.freeze({key:'imap_mailbox',resource_key:'inbox',action_keys:Object.freeze(['organize_messages','send_message']),max_consent_seconds:90*86400,provider_profile_key:'imap_smtp',runtime_requirement_key:'sync_provider'}),
 Object.freeze({key:'microsoft_mailbox',resource_key:'inbox',action_keys:Object.freeze(['mirror_drafts','organize_messages','send_message']),max_consent_seconds:90*86400,provider_profile_key:'microsoft_readwrite',runtime_requirement_key:'sync_provider'}),
 Object.freeze({key:'personal_mailbox',resource_key:'inbox',action_keys:Object.freeze(['mirror_drafts','organize_messages','send_message']),max_consent_seconds:90*86400,provider_profile_key:'gmail_readwrite',runtime_requirement_key:'sync_provider'}),
]);
const supported=Object.freeze({
 gmail:Object.freeze({label:'Gmail / Google Workspace',organize:true,archiveQuery:true,notice:'Read, drafts and reviewed Send and Organize use your current account grants.'}),
 microsoft:Object.freeze({label:'Microsoft Outlook',organize:true,archiveQuery:true,notice:'Reviewed Send supports up to 25 MiB of attachments and 35 MiB of MIME. Preparation may create temporary provider drafts. Provider acceptance does not confirm a Sent copy.'}),
 imap_smtp:Object.freeze({label:'IMAP / SMTP',organize:true,archiveQuery:false,notice:'Read and star changes require conditional flags. Archive and Trash require MOVE and matching server folders. Archive search is unavailable. Background refresh uses your reviewed schedule. SMTP Send and Sent-copy behavior follow the reviewed server configuration.'}),
});
export function emailProviderSupport(provider){return typeof provider==='string'&&Object.hasOwn(supported,provider)?supported[provider]:null;}
/** Current public resource metadata nominates presentation limits, never grants
 * an effect or selects a provider/credential endpoint. Mixed providers deny. */
export function emailRowsProvider(rows){
 if(!Array.isArray(rows)||!rows.length)return null;const providers=new Set(rows.map(row=>row?.data?.provider));
 return providers.size===1&&emailProviderSupport([...providers][0])?[...providers][0]:null;
}
export function emailOrganizeAvailable(rows){const provider=emailRowsProvider(rows);return provider!==null&&emailProviderSupport(provider).organize;}
export const EMAIL_PROVIDER_SETUP_NOTE='Connect Gmail or Microsoft through the reviewed OAuth account connection. IMAP / SMTP uses Server accounts and a secure operator-owned setup form. Connection choices appear after your workspace admits the matching profile; passwords never enter this app.';
