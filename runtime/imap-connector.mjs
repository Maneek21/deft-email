import {lookup as systemLookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {publicImageAddress} from './vendor/providers/remote-image-proxy.mjs';
import {fail} from './contract.mjs';
import {FORM_LIMITS} from './connection-form-contract.mjs';

export function bounded(promise,signal,ms,cleanup=()=>{}){
 signal?.throwIfAborted();return new Promise((resolve,reject)=>{let done=false;const finish=(fn,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);fn(value);};
 const abort=()=>{try{cleanup();}finally{finish(reject,Object.assign(new Error('EMAIL_IMAP_DEADLINE'),{code:'EMAIL_IMAP_DEADLINE'}));}};
 const timer=setTimeout(abort,Math.max(1,ms));signal?.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(value=>finish(resolve,value),error=>finish(reject,error));});
}
/** Resolve the complete set, reject mixed/private addresses, then freeze TLS DNS
 * while still using the declared hostname for certificate/SNI validation. */
async function pinnedEndpoint(host,signal,lookup=systemLookup){
 if(isIP(host)||host.endsWith('.localhost')||host==='localhost')fail('EMAIL_IMAP_ENDPOINT_DENIED');
 const addresses=await bounded(lookup(host,{all:true,verbatim:true}),signal,FORM_LIMITS.dns_ms);
 if(!Array.isArray(addresses)||!addresses.length||addresses.length>32||addresses.some(row=>!publicImageAddress(row.address)||row.family!==isIP(row.address)))fail('EMAIL_IMAP_ENDPOINT_DENIED');
 const address=addresses[0];return {address:address.address,lookup:(_name,options,callback)=>{if(options.family&&options.family!==address.family)return callback(Object.assign(new Error('Family unavailable'),{code:'EAI_ADDRFAMILY'}));options.all?callback(null,[address]):callback(null,address.address,address.family);}};
}
export async function pinnedLookup(host,signal,lookup=systemLookup){return(await pinnedEndpoint(host,signal,lookup)).lookup;}
// Parser ceilings include native35MiB source bytes plus bounded response framing.
// The frozen reader independently enforces exact source/file limits before disclosure.
const baseOptions=Object.freeze({connectionTimeout:20000,greetingTimeout:10000,socketTimeout:30000,logger:false,logRaw:false,emitLogs:false,disableAutoIdle:true,maxLineLength:1048576,maxLiteralSize:35*1024*1024,maxResponseSize:36*1024*1024,maxMessageSize:35*1024*1024});
export function createImapConnector({ImapFlow,createTransport,lookup=systemLookup,now=Date.now}){
 if(typeof ImapFlow!=='function')fail('EMAIL_IMAP_CONFIG_INVALID');
 // Pinned ImapFlow2.0.7 documents PREAUTH as authenticated=true without a
 // credential identity. Refuse it before the library can publish that state.
 class CredentialImapFlow extends ImapFlow{async initialPREAUTH(){this.close();fail('EMAIL_IMAP_PRINCIPAL_UNPROVEN');}}
 const options=async(profile,signal,check)=>{await check();const pinned=await pinnedEndpoint(profile.host,signal,lookup);await check();return {host:profile.host,connection_address:pinned.address,port:profile.port,servername:profile.host,secure:profile.transport==='implicit_tls',...(profile.transport==='starttls_required'?{doSTARTTLS:true}:{}),auth:{user:profile.username,pass:profile.password},tls:{servername:profile.host,minVersion:'TLSv1.2',rejectUnauthorized:true,lookup:pinned.lookup}};};
 async function imap(profile,{signal,expires_at,check},work){let client;const close=()=>{try{client?.close();}catch{}};try{
 const {connection_address,...setup}=await options(profile,signal,check);client=new CredentialImapFlow({...baseOptions,...setup});signal?.addEventListener('abort',close,{once:true});await check();
 await bounded(client.connect(),signal,Math.min(20000,expires_at-now()),close);await check();
 if(!client.authenticated||client.secureConnection!==true||client.tls?.authorized!==true||client.authenticated===true&&client.authCapabilities?.has('PREAUTH'))fail('EMAIL_IMAP_TLS_REQUIRED');
 const result=await bounded(work(client),signal,expires_at-now(),close);await check();return result;
 }finally{signal?.removeEventListener('abort',close);if(client){try{if(client.authenticated)await bounded(client.logout(),undefined,1000,close);}catch{}close();if(client.options?.auth)client.options.auth.pass=undefined;}}}
 async function smtp(profile,{signal,expires_at,check},work){if(typeof createTransport!=='function')fail('EMAIL_SMTP_CONFIG_INVALID');let transport;const close=()=>{try{transport?.close();}catch{}};try{const setup=await options(profile,signal,check);const {doSTARTTLS,connection_address,...rest}=setup;transport=createTransport({...rest,host:connection_address,pool:false,requireTLS:profile.transport==='starttls_required',ignoreTLS:false,logger:false,debug:false,connectionTimeout:20000,greetingTimeout:10000,socketTimeout:30000});signal?.addEventListener('abort',close,{once:true});await check();const value=await bounded(work(transport),signal,expires_at-now(),close);await check();return value;}finally{signal?.removeEventListener('abort',close);close();if(transport?.options?.auth)transport.options.auth.pass=undefined;}}
 return Object.freeze({imap,smtp,async probe(profile,context){await imap(profile.imap,context,async()=>{});if(profile.smtp)await smtp(profile.smtp,context,transport=>transport.verify());}});
}
