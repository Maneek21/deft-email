import {parsedNativeMailboxes} from './vendor/providers/resource-reader.mjs';
import {validateDraftContent} from './draft-store.mjs';
import {fail} from './contract.mjs';
const clip=(text,limit)=>{let result=text.slice(0,limit);if(/[\ud800-\udbff]$/u.test(result))result=result.slice(0,-1);return result;};
const format=items=>items.map(item=>item.display_name?`"${item.display_name.replace(/["\\]/gu,'\\$&')}" <${item.address}>`:item.address).join(', ');
/** Behavioral port of frozen email-native-reply.ts. Full native source text is
 * budget-fitted through the actual draft validator, with a durable visible
 * notice whenever quoting is incomplete. No provider locator is caller input. */
export function deriveReply(source,logical_message_id,mode){
  if(!['reply','reply_all','forward'].includes(mode))fail('EMAIL_DATA_INPUT_INVALID');
  const metadata=source.presentation.metadata,unavailable=new Set(source.reply_seed_unavailable??[]);let to='',cc='',incomplete=false;
  const read=key=>parsedNativeMailboxes(metadata[key]??'');
  if(mode!=='forward'){
    let addresses;try{addresses=JSON.parse(metadata.verified_sender_identities);if(!Array.isArray(addresses)||!addresses.length||addresses.length>32)throw Error();}catch{fail('EMAIL_SEND_SOURCE_DENIED');}
    const own=new Set(addresses.map(address=>{const parsed=parsedNativeMailboxes(address);if(parsed.length!==1||parsed[0].display_name)fail('EMAIL_SEND_SOURCE_DENIED');return parsed[0].address.toLowerCase();}));
    const primary=parsedNativeMailboxes(metadata.primary_address);if(primary.length!==1||!own.has(primary[0].address.toLowerCase()))fail('EMAIL_SEND_SOURCE_DENIED');
    const from=read('reply_from'),replyTo=read('reply_to'),originalTo=read('reply_to_list'),originalCc=read('reply_cc'),ownSent=from.length&&from.every(item=>own.has(item.address.toLowerCase())),seen=new Set(own);
    if(!from.length||unavailable.has('reply_from')||unavailable.has(ownSent?'reply_to_list':'reply_to')||mode==='reply_all'&&(unavailable.has('reply_to_list')||unavailable.has('reply_cc')))fail('EMAIL_SEND_SOURCE_DENIED');
    const select=items=>items.filter(item=>{const key=item.address.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;}),selectedTo=select(ownSent?originalTo:replyTo.length?replyTo:from),selectedCc=mode==='reply_all'?select(ownSent?originalCc:[...originalTo,...originalCc]):[];
    if(!selectedTo.length||selectedTo.length+selectedCc.length>200)fail('EMAIL_SEND_SOURCE_DENIED');to=format(selectedTo);cc=format(selectedCc);
  }
  const fields={From:'reply_from',To:'reply_to_list',Cc:'reply_cc'},seen=new Set(),headers=source.presentation.headers.filter(item=>['From','To','Cc','Date','Subject'].includes(item.label)).map(item=>{seen.add(item.label);const key=fields[item.label];if(!key)return `${item.label}: ${item.value}`;if(!unavailable.has(key)&&metadata[key]?.trim())try{return `${item.label}: ${format(read(key))}`;}catch{}if(unavailable.has(key)||item.value.length>=2048){incomplete=true;return `${item.label}: [Original address information may be incomplete. Check the original message.]`;}return `${item.label}: ${item.value}`;});
  for(const [label,key] of Object.entries(fields))if(unavailable.has(key)&&!seen.has(label)){incomplete=true;headers.push(`${label}: [Original address information unavailable. Check the original message.]`);}
  const subject=metadata.subject??source.presentation.headers.find(item=>item.label==='Subject')?.value??'',prefixed=new RegExp(mode==='forward'?'^fwd?:':'^re:','iu').test(subject)?subject:(mode==='forward'?'Fwd: ':'Re: ')+subject;
  const base={mode,to,cc,bcc:'',subject:clip(prefixed,998),body:'',body_html:'',reply_record_id:logical_message_id,attachments:[]},text=source.presentation.plain_text;
  const draft=excerpt=>validateDraftContent({...base,body:mode==='forward'?`\n\n---------- Forwarded message ----------\n${headers.join('\n')}\n\n${excerpt}`:`\n\n${headers.join('\n')}\n\n${excerpt.split('\n').map(line=>'> '+line).join('\n')}`});
  draft('');for(let offset=0;offset<text.length;offset+=65536)validateDraftContent({...base,body:text.slice(offset,offset+65536)});
  let content,excerpt=text;try{content=draft(text);}catch{let low=0,high=text.length;while(low<high){const middle=Math.ceil((low+high)/2);try{draft(clip(text,middle));low=middle;}catch{high=middle-1;}}excerpt=clip(text,low);content=draft(excerpt);}
  const notes=['Review the recipients and message before sending.'];if(source.files.some(file=>file.disposition==='attachment'))notes.push('Original attachments are not included. Add any files you want to send.');if(source.presentation.truncated||excerpt!==text)notes.push('Only part of the original message is quoted.');if(prefixed.length>998)notes.push('The subject was shortened to fit the draft limit.');if(incomplete)notes.push('Some original address headers could not be quoted completely. Download the original message to review them.');
  return {content,notice:notes.join(' ')};
}
