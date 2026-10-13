import {fail} from './contract.mjs';

/** Current support is a read-only observation, never permission to append. The
 * reviewed Send still resolves and seals its exact destination independently. */
export async function smtpSentCopySupport({account,connector,check,signal,expires_at,now=Date.now}){
 await check();
 if(!account)return {smtp_supported:false,append_available:false,sent_copy_reason:'provider_managed'};
 if(!account.profile?.smtp||!account.capabilities?.includes('send')||!account.action_consents?.some(row=>row.action_key==='send_message'&&Date.parse(row.expires_at)>now()))return {smtp_supported:true,append_available:false,sent_copy_reason:'send_unavailable'};
 const result=await connector.imap(account.profile.imap,{check,signal,expires_at},async client=>{
  await check();const rows=await client.list();await check();
  if(!Array.isArray(rows)||rows.length>512||Buffer.byteLength(JSON.stringify(rows))>1048576)fail('EMAIL_SMTP_COPY_DESTINATION_DENIED');
  const sent=rows.filter(row=>typeof row.path==='string'&&row.path.length>0&&row.path.length<=2048&&!/[\u0000-\u001f\u007f]/u.test(row.path)&&row.flags instanceof Set&&!row.flags.has('\\Noselect')&&!row.flags.has('\\NonExistent')&&(row.specialUse==='\\Sent'||row.flags.has('\\Sent')));
  if(sent.length!==1)return {smtp_supported:true,append_available:false,sent_copy_reason:'sent_folder_unavailable'};
  let lock;try{await check();lock=await client.getMailboxLock(sent[0].path,{readOnly:true});await check();
   if(client.mailbox?.path!==sent[0].path||!/^[1-9]\d{0,29}$/u.test(String(client.mailbox?.uidValidity)))fail('EMAIL_SMTP_COPY_DESTINATION_DENIED');
   return {smtp_supported:true,append_available:true,sent_copy_reason:'available'};
  }finally{lock?.release();}
 });await check();return result;
}

export async function savedSmtpSentCopyMode({settings,scope,check,fallback='server_managed'}){
 if(!['server_managed','append_exact'].includes(fallback))fail('EMAIL_SMTP_PLAN_INVALID');
 const page=await settings.list(scope,'smtp_preferences',{cursor:null,limit:2},check);
 if(page.next_cursor!==null||page.items.length>1)fail('EMAIL_SETTINGS_CONFLICT');
 if(!page.items.length)return fallback;
 const record=await settings.read(scope,'smtp_preferences',page.items[0].record_id,check);
 if(record.status!=='draft')fail('EMAIL_SETTINGS_CONFLICT');
 return record.value.sent_copy_mode;
}
