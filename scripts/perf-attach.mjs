#!/usr/bin/env node
// Attachment latency harness. Fixture mode builds the real runtime byte reader
// and counts provider source fetches exactly; live mode replays the Host
// experience content route and prints only statuses, counts and timings.
// It never prints bodies, filenames, record ids or tokens.
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {readResourceBytes} from '../runtime/resource-bytes.mjs';
import {createSourceSnapshotCache} from '../runtime/source-snapshot-cache.mjs';
import {inspectEmailSourceFiles} from '../runtime/vendor/providers/incoming-source-files.mjs';

const args=process.argv.slice(2);
const option=(name,fallback)=>{const index=args.indexOf(name);return index<0?fallback:args[index+1];};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const round=value=>value===null?null:Math.round(value*100)/100;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const host=option('--host',null),session=option('--session',null),record=option('--record',null);
const fileCount=Math.max(1,Math.min(32,Number(option('--files',8))));
const concurrency=String(option('--concurrency','1,3')).split(',').map(Number).filter(value=>Number.isInteger(value)&&value>0);
const output=option('--output',null),resource=option('--resource','inbox');
const mode=option('--mode',host?'live':'fixture');
const token=process.env.DEFT_ATTACH_TOKEN??'';
const rows=[];

if(!concurrency.length)throw Error('usage: --concurrency 1,3 [--files 8] [--host <url> --session <id> --record <id>] [--output attach.json]');
try{
  if(mode==='live'||mode==='both')await live();
  if(mode==='fixture'||mode==='both')await fixture();
}catch(error){
  console.error(JSON.stringify({event:'attachment_perf_error',error:typeof error?.code==='string'?error.code:'ATTACHMENT_PERF_FAILED'}));
  process.exitCode=1;
}
if(output)await writeFile(output,JSON.stringify({generated_at:new Date().toISOString(),mode,rows},null,2)+'\n');
for(const row of rows)console.log(JSON.stringify(row));

async function live(){
  if(!host||!session||!record||!token)throw Object.assign(Error('usage: --host --session --record and DEFT_ATTACH_TOKEN are required for live mode'),{code:'ATTACHMENT_PERF_USAGE'});
  const endpoint=`${host.replace(/\/$/u,'')}/api/app-experiences/sessions/${encodeURIComponent(session)}/resources/${encodeURIComponent(resource)}/content`;
  const post=async body=>{
    const started=performance.now();
    const response=await fetch(endpoint,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','cache-control':'no-store',accept:'application/json, application/octet-stream'},body:JSON.stringify(body)});
    const bytes=response.ok?new Uint8Array(await response.arrayBuffer()):null;
    return {status:response.status,ms:performance.now()-started,bytes};
  };
  const listing=await post({operation:'list_files',record_id:record});
  if(listing.status!==200||!listing.bytes)throw Object.assign(Error('listing failed'),{code:'ATTACHMENT_PERF_LISTING_DENIED'});
  const files=(JSON.parse(Buffer.from(listing.bytes).toString('utf8')).files??[]).filter(row=>row.disposition==='attachment').slice(0,fileCount);
  for(const concurrent of concurrency){
    const samples=[];const statuses={};
    const queue=[...files];
    const worker=async()=>{for(;;){const file=queue.shift();if(!file)return;const result=await post({operation:'read_file',record_id:record,file_ref:file.file_ref});samples.push(result.ms);statuses[result.status]=(statuses[result.status]??0)+1;result.bytes?.fill(0);}};
    await Promise.all(Array.from({length:Math.min(concurrent,files.length)},worker));
    rows.push(measurement('read_file',null,concurrent,samples,null,statuses));
  }
}

function mimeWithFiles(count){
  const parts=Array.from({length:count},(_,index)=>'--bounded\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="part-'+index+'.bin"\r\nContent-Transfer-Encoding: base64\r\n\r\n'+Buffer.from('exact attachment '+index).toString('base64')+'\r\n').join('');
  return {mime:Buffer.from('From: sender@example.test\r\nTo: owner@example.test\r\nSubject: Attachment latency fixture\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=bounded\r\n\r\n--bounded\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Body</p>\r\n'+parts+'--bounded--\r\n'),parts:Array.from({length:count},(_,index)=>Buffer.from('exact attachment '+index))};
}

async function fixture(){
  const {mime,parts}=mimeWithFiles(fileCount),catalog=await inspectEmailSourceFiles(mime,{profile:'native',presentation:true}),files=catalog.files.filter(row=>row.filename.startsWith('part-'));
  const locators={gmail:{kind:'gmail',message_id:'synthetic-message'},microsoft:{kind:'microsoft',message_id:'synthetic-message',id_type:'immutable'},imap_smtp:{kind:'imap_smtp',mailbox:'INBOX',uidvalidity:'1',uid:1}};
  for(const providerDelayMs of [300,900])for(const provider of ['gmail','microsoft','imap_smtp'])for(const concurrent of concurrency){
    const counts={source:0,conversation:0},cache=createSourceSnapshotCache(),samples=[];
    const bridge={
      async nativeEmailSource(){counts.source++;await delay(providerDelayMs);return {account_id:'account',provider,digest:sha(mime),mime_bytes:Buffer.from(mime)};},
      async nativeEmailConversation(){counts.conversation++;return {account_id:'account',provider:'gmail',anchor_logical_message_id:'logical'};},
    };
    const provider_source={schema_version:'deft.email_provider_source.v1',account_id:'account',provider,logical_message_id:'logical',locator:locators[provider]};
    const key=sha(Buffer.from('attachment-perf-fixture')),queue=[...files];
    const worker=async()=>{for(;;){const file=queue.shift();if(!file)return;const started=performance.now();const result=await readResourceBytes({bridge,provider_source,input:{file_ref:'sha256:'+file.file_ref},operation:'resource_read_file',context:{account_id:'account',signal:new AbortController().signal},check:async()=>{},sourceCache:cache,sourceCacheKey:key});samples.push(performance.now()-started);result.bytes.fill(0);}};
    await Promise.all(Array.from({length:Math.min(concurrent,files.length)},worker));
    const expected=parts.length;
    rows.push({...measurement('read_file',providerDelayMs,concurrent,samples,null,{200:samples.length}),provider,provider_fetches:counts.source,provider_expected_fetches:1,attachments_read:expected});
  }
}

function measurement(operation,providerDelayMs,concurrent,samples,authorityCalls,statuses){
  const sorted=[...samples].sort((a,b)=>a-b),percentile=p=>sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]??null;
  return {operation,provider_delay_ms:providerDelayMs,concurrency:concurrent,p50_ms:round(percentile(0.5)),p95_ms:round(percentile(0.95)),authority_calls:authorityCalls,provider_fetches:null,http_status_counts:statuses};
}
