import {randomUUID} from 'node:crypto';
import {dataFixtureMessage} from './test-support.mjs';
export const graphClient={client_id:'synthetic-graph-client',client_secret:'synthetic-graph-client-secret',redirect_uri:'https://host.example/apps/connections/upgrade/callback',tenant:'organizations'};
export function graphMessage(address='first@example.test',index=0){
 const native=dataFixtureMessage(address),pdf=Buffer.from('%PDF-1.7\nSYNTHETIC PDF '+address+'\n%%EOF'),mime=Buffer.from(native.mime.toString().replace('Content-Type: text/plain\r\nContent-Disposition: attachment; filename="received.txt"','Content-Type: application/pdf\r\nContent-Disposition: attachment; filename="received.pdf"').replace(native.attachment.toString('base64'),pdf.toString('base64'))),id='graph-'+address.split('@')[0]+'-'+index;
 return {mime,pdf,png:native.png,metadata:{id,conversationId:'conversation-'+id,parentFolderId:'inbox',from:{emailAddress:{address:'sender@example.test',name:'Synthetic sender'}},toRecipients:[{emailAddress:{address}}],ccRecipients:[],subject:'Synthetic Graph source '+index,receivedDateTime:'2026-10-01T00:00:00Z',isRead:false,flag:{flagStatus:'notFlagged'},hasAttachments:true,internetMessageId:'<'+id+'@example.test>',categories:[],'@odata.etag':'"initial-'+id+'"'}};
}
/** Synthetic strict Graph only. No arbitrary token or unknown URL acceptance. */
export function graphProviderFixture({count=1,rejectAt=0,unknownAt=0,wrongIdentity=false}={}){
 const tokenPrefix='synthetic-graph-access-',states=new Map(),counts={exchange:0,read:0,modify:0,send:0},tokenBodies=[],sent=[];
 const codes=['graph-first-read','graph-second-read','graph-first-organize','graph-first-send','graph-first-both','graph-second-both'];
 const fetch=async(url,options={})=>{
  const parsed=new URL(url),headers=new Headers(options.headers);
  if(parsed.origin==='https://login.microsoftonline.com'&&parsed.pathname==='/organizations/oauth2/v2.0/token'){
   const body=new URLSearchParams(options.body),code=body.get('code');if(!codes.includes(code)||body.get('grant_type')!=='authorization_code'||body.get('client_id')!==graphClient.client_id||body.get('client_secret')!==graphClient.client_secret||!body.get('code_verifier'))throw Error('SYNTHETIC_GRAPH_TOKEN_DENIED');
   counts.exchange++;tokenBodies.push(Object.fromEntries(['code','code_verifier','redirect_uri','scope'].map(key=>[key,body.get(key)])));
   return Response.json({access_token:tokenPrefix+code,refresh_token:'synthetic-graph-refresh-'+code,token_type:'Bearer',expires_in:3600,scope:'offline_access User.Read Mail.Read'+(code.endsWith('organize')||code.endsWith('both')?' Mail.ReadWrite':'')+(code.endsWith('send')||code.endsWith('both')?' Mail.Send':'')});
  }
  const token=headers.get('authorization')?.slice(7),code=token?.startsWith(tokenPrefix)?token.slice(tokenPrefix.length):null;if(!codes.includes(code)||parsed.origin!=='https://graph.microsoft.com'||!parsed.pathname.startsWith('/v1.0/me'))throw Error('SYNTHETIC_GRAPH_BEARER_DENIED');
  const address=wrongIdentity?'wrong@example.test':code.startsWith('graph-first')?'first@example.test':'second@example.test';
  if(parsed.pathname==='/v1.0/me')return Response.json({id:wrongIdentity?'wrong-principal':address,mail:address,userPrincipalName:address,displayName:'Synthetic '+address});
  if(parsed.pathname==='/v1.0/me/sendMail'){
   if(!code.endsWith('send')&&!code.endsWith('both')||options.method!=='POST'||headers.get('content-type')!=='text/plain')throw Error('SYNTHETIC_GRAPH_SEND_DENIED');counts.send++;sent.push(Buffer.from(options.body,'base64'));return new Response(null,{status:202});
  }
  const entries=Array.from({length:count},(_,i)=>graphMessage(address,i));
  const current=entry=>{if(!states.has(entry.metadata.id))states.set(entry.metadata.id,structuredClone(entry.metadata));return states.get(entry.metadata.id);};
  const collection=parsed.pathname==='/v1.0/me/messages'||/^\/v1\.0\/me\/mailFolders\/[^/]+\/messages$/u.test(parsed.pathname);
  if(collection){counts.read++;const folderId=parsed.pathname.match(/^\/v1\.0\/me\/mailFolders\/([^/]+)\/messages$/u)?.[1];return Response.json({value:entries.map(current).filter(row=>!folderId||row.parentFolderId===decodeURIComponent(folderId))});}
  if(parsed.pathname==='/v1.0/me/mailFolders'){counts.read++;return Response.json({value:[{id:'inbox'}]});}
  const folder=parsed.pathname.match(/^\/v1\.0\/me\/mailFolders\/([^/]+)(?:\/(childFolders|messages\/delta))?$/u);
  if(folder){counts.read++;if(folder[2]==='childFolders')return Response.json({value:[]});if(folder[2]==='messages/delta')return Response.json({value:entries.map(current),'@odata.deltaLink':parsed.origin+parsed.pathname+'?$deltatoken=synthetic'});return Response.json({id:folder[1]});}
  const message=parsed.pathname.match(/^\/v1\.0\/me\/messages\/([^/]+)(?:\/(\$value|move))?$/u),entry=entries.find(row=>row.metadata.id===decodeURIComponent(message?.[1]??''));
  if(!entry)throw Error('SYNTHETIC_GRAPH_URL_UNEXPECTED');
  if(message[2]==='$value'){counts.read++;if(headers.get('prefer')!=='IdType="ImmutableId"')throw Error('SYNTHETIC_GRAPH_IMMUTABLE_ID_REQUIRED');return new Response(entry.mime,{headers:{'content-type':'message/rfc822','content-length':String(entry.mime.length)}});}
  const before=current(entry);
  if(options.method==='PATCH'||message[2]==='move'){
   if(!code.endsWith('organize')&&!code.endsWith('both'))throw Error('SYNTHETIC_GRAPH_MODIFY_DENIED');counts.modify++;
   if(counts.modify===unknownAt)throw Error('SYNTHETIC_GRAPH_RESPONSE_LOST');if(counts.modify===rejectAt)return Response.json({error:{code:'SyntheticRejected'}},{status:400});
   if(headers.get('if-match')!==before['@odata.etag'])return Response.json({error:{code:'SyntheticPrecondition'}},{status:412});
   const body=JSON.parse(options.body);if(message[2]==='move'){if(options.method!=='POST'||!['archive','deleteditems'].includes(body.destinationId))throw Error('SYNTHETIC_GRAPH_MOVE_DENIED');before.parentFolderId=body.destinationId;}else{if(options.method!=='PATCH'||Object.keys(body).some(key=>!['isRead','flag'].includes(key)))throw Error('SYNTHETIC_GRAPH_PATCH_DENIED');Object.assign(before,body);}
   before['@odata.etag']='"changed-'+randomUUID()+'"';return Response.json(before,{status:message[2]==='move'?201:200});
  }
  counts.read++;return Response.json(before);
 };
 return Object.assign(fetch,{counts,tokenBodies,sent,states});
}
