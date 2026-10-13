import {createHash} from 'node:crypto';
import {canonical,fail} from './contract.mjs';
import {resourceView} from './mailbox-store.mjs';

/** Canonical folder nominations only, from the already fenced Runtime row.
 * Raw provider IDs and user label IDs never leave this helper. */
export function integrationKnowledgePresentation(record,presentation){
 const folders=(record.folders??[]).filter(folder=>['inbox','sent','archive','spam','trash','drafts'].includes(folder));
 const result={...presentation,metadata:{...presentation.metadata,capture_folders:JSON.stringify([...new Set(folders)])}};
 const resource=resourceView(record),evidence=integrationKnowledgeEvidence({resource,presentation:result,policy:{include_bulk:true,excluded_senders:[],excluded_folders:[]}});
 const text=String(resource.data.subject??'')+'\n'+(evidence.body??presentation.plain_text);
 const nomination={schema_version:'deft.app_capture_nomination.v1',eligible:evidence.eligible,...(evidence.reason?{reason:evidence.reason}:{}),
  ...(evidence.body_digest?{body_digest:evidence.body_digest,thread_key:evidence.thread_key}:{}),sender:String(resource.data.from_address??resource.data.from??resource.data.sender??'').slice(0,320),
  received_at:typeof(resource.data.received_at??resource.data.date)==='string'?String(resource.data.received_at??resource.data.date).slice(0,64):null,
  is_bulk:/\b(?:unsubscribe|view in browser|limited time offer|sale ends|newsletter)\b/iu.test(text)||resource.data.is_bulk===true,partial:true,attachments_processed:false};
 const encoded=JSON.stringify(nomination);if(Buffer.byteLength(encoded)>2048)fail('EMAIL_INTEGRATION_KNOWLEDGE_DENIED');
 result.metadata.capture_nomination=encoded;return result;
}

/** App nominations are data. Policy, budget, model and destination belong to Host. */
export function integrationKnowledgeEvidence({resource,presentation,policy}){
 if(resource.tombstone||typeof presentation?.plain_text!=='string')fail('EMAIL_INTEGRATION_KNOWLEDGE_DENIED');
 let folders=[];
 if(presentation.metadata?.capture_folders!==undefined){try{folders=JSON.parse(presentation.metadata.capture_folders);if(!Array.isArray(folders)||folders.length>6||folders.some(folder=>!['inbox','sent','archive','spam','trash','drafts'].includes(folder)))return {eligible:false,reason:'invalid_folder_nomination'};}catch{return {eligible:false,reason:'invalid_folder_nomination'};}}
 else folders=String(resource.data.folders??resource.data.folder??'').toLowerCase().split(/[ ,]+/u).filter(Boolean);
 if(!folders.length)folders=['inbox','sent','archive'].filter(folder=>resource.data['in_'+folder]===true);
 if(!folders.length)return {eligible:false,reason:'unknown_folder_membership'};
 if(folders.some(folder=>['spam','junk','trash','deleted','drafts',...policy.excluded_folders.map(value=>value.toLowerCase())].includes(folder)))return {eligible:false,reason:'excluded_folder'};
 const sender=String(resource.data.from_address??resource.data.from??resource.data.sender??'').slice(0,320),subject=String(resource.data.subject??'').slice(0,998);
 if(policy.excluded_senders.some(value=>sender.toLowerCase().includes(value.toLowerCase())))return {eligible:false,reason:'excluded_sender'};
 const kept=[];for(const line of presentation.plain_text.replace(/\r\n?/gu,'\n').split('\n')){
  if(/^\s*(?:On .+wrote:|From:|-----Original Message-----|--\s*$)/iu.test(line))break;
  if(!/^\s*>/u.test(line))kept.push(line);
 }
 const body=kept.join('\n').replace(/\n{3,}/gu,'\n\n').trim(),text=subject+'\n'+body;
 if(body.length>16000)return {eligible:false,reason:'body_too_large'};
 if(body.length<40||/^(?:thanks?|thank you|got it|noted|okay|ok|sounds good)[.!\s]*$/iu.test(body))return {eligible:false,reason:'low_signal'};
 if(/\b(?:one[- ]time (?:password|code)|verification code|password reset|security code|api[_ -]?key|private key|access token|secret key|recovery codes)\b/iu.test(text)
  ||/\b(?:sk-[A-Za-z0-9]{16,}|AKIA[A-Z0-9]{16})\b/u.test(text))return {eligible:false,reason:'sensitive'};
 if(!policy.include_bulk&&(/\b(?:unsubscribe|view in browser|limited time offer|sale ends|newsletter)\b/iu.test(text)||resource.data.is_bulk===true))return {eligible:false,reason:'bulk'};
 // Only authenticated provider thread identity, never subject. Missing thread
 // identity deliberately keeps this one exact message as its own thread.
 const thread=String(resource.data.conversation_id??resource.record_id);
 const hash=value=>'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');
 return {eligible:true,body,sender,received_at:typeof(resource.data.received_at??resource.data.date)==='string'?(resource.data.received_at??resource.data.date):null,
  thread_key:hash(thread),body_digest:hash(body),partial:true,attachments_processed:false};
}
