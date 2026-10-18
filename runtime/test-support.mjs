import {randomUUID, randomBytes} from 'node:crypto';
export const client = {client_id: 'fixture-only-client', client_secret: 'fixture-only-client-secret', redirect_uri: 'https://host.example/apps/connections/callback'};
export function makeScope() {
  return {org_id: randomUUID(), owner_user_id: randomUUID(), installation_id: randomUUID(), app_version_id: randomUUID(), grant_snapshot_id: randomUUID(), package_digest: 'sha256:' + 'a'.repeat(64), grant_snapshot_digest: 'sha256:' + 'b'.repeat(64), lifecycle_epoch: 1, grant_epoch: 1, target_key: 'mailbox', resource_key: 'inbox', resource_binding_id: randomUUID(), runtime_registration_id: randomUUID(), operator_user_id: randomUUID(), runtime_epoch: 1, profile_digest: 'sha256:' + 'c'.repeat(64), consent_expires_at: new Date(Date.now() + 3600000).toISOString()};
}
export const registrationFor = scope => Object.fromEntries(['org_id', 'runtime_registration_id', 'operator_user_id', 'runtime_epoch', 'profile_digest', 'target_key', 'resource_key'].map(key => [key, scope[key]]));
export const beginFor = scope => ({schema_version: 'deft.app_connection_runtime.v1', session_id: randomUUID(), scope, expires_at: new Date(Date.now() + 29000).toISOString(), operation: 'begin', callback_state: randomBytes(32).toString('base64url')});
export const nextFor = (begin, begun, operation, account = null) => ({schema_version: begin.schema_version, session_id: begin.session_id, scope: begin.scope, expires_at: new Date(Date.now() + 29000).toISOString(), operation, runtime_session_ref: begun.runtime_session_ref, ...(operation === 'callback' ? {callback: {outcome: 'authorized', code: 'fixture-only-code'}} : {expected_account_ref: account?.account_ref ?? null})});
export const authority = input => Promise.resolve({...input, allowed: true});
export async function providerFixture(url) {
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({access_token: 'fixture-only-access-secret', refresh_token: 'fixture-only-refresh-secret', token_type: 'Bearer', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/gmail.readonly'});
  if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json({sub: 'fixture-only-subject', email: 'fixture@example.test', email_verified: true, name: 'Fixture'});
  if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/profile') return Response.json({emailAddress: 'fixture@example.test'});
  throw Error('FIXTURE_PROVIDER_URL_UNEXPECTED');
}
export function twoAccountProviderFixture() {
  const tokens = new Map(),labelState=new Map(),counts={modify:0,send:0};
  const fixture=async (url, options) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      const code = new URLSearchParams(options.body).get('code');
      if (!['fixture-first-account', 'fixture-second-account','fixture-first-account-send','fixture-first-account-organize','fixture-first-account-both'].includes(code)) throw Error('FIXTURE_CODE_UNEXPECTED');
      const identity = code.startsWith('fixture-first-account') ? {subject: 'fixture-first-subject', address: 'first@example.test'} : {subject: 'fixture-second-subject', address: 'second@example.test'};
      const access_token = 'fixture-only-access-' + code; tokens.set(access_token, identity);
      return Response.json({access_token, refresh_token: 'fixture-only-refresh-' + code, token_type: 'Bearer', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/gmail.readonly'+(['-send','-both'].some(suffix=>code.endsWith(suffix))?' https://www.googleapis.com/auth/gmail.send':'')+( ['-organize','-both'].some(suffix=>code.endsWith(suffix))?' https://www.googleapis.com/auth/gmail.modify':'')});
    }
    const bearer=options.headers.Authorization?.slice(7),known=['fixture-only-access-fixture-first-account','fixture-only-access-fixture-first-account-send','fixture-only-access-fixture-first-account-organize','fixture-only-access-fixture-first-account-both'].includes(bearer)?{subject:'fixture-first-subject',address:'first@example.test'}:bearer==='fixture-only-access-fixture-second-account'?{subject:'fixture-second-subject',address:'second@example.test'}:null;
    const identity = tokens.get(bearer)??known; if (!identity) throw Error('FIXTURE_TOKEN_UNEXPECTED');
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json({sub: identity.subject, email: identity.address, email_verified: true, name: identity.address});
    if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/profile') return Response.json({emailAddress: identity.address,historyId:'1'});
    const parsed=new URL(url),message=dataFixtureMessage(identity.address);
    if(!labelState.has(identity.address))labelState.set(identity.address,[...message.metadata.labelIds]);message.metadata.labelIds=[...labelState.get(identity.address)];
    if(['/messages/'+message.metadata.id+'/modify','/messages/'+message.metadata.id+'/trash'].some(suffix=>parsed.pathname.endsWith(suffix))){if(!['fixture-only-access-fixture-first-account-organize','fixture-only-access-fixture-first-account-both'].includes(bearer)||options.method!=='POST')throw Error('FIXTURE_MODIFY_NOT_GRANTED');counts.modify++;const payload=parsed.pathname.endsWith('/trash')?{addLabelIds:['TRASH'],removeLabelIds:['INBOX']}:JSON.parse(options.body),labels=new Set(message.metadata.labelIds);for(const id of payload.removeLabelIds??[])labels.delete(id);for(const id of payload.addLabelIds??[])labels.add(id);labelState.set(identity.address,[...labels].sort());return Response.json({id:message.metadata.id,threadId:message.metadata.threadId,labelIds:[...labels].sort()});}
    if(parsed.pathname==='/upload/gmail/v1/users/me/messages/send'){if(!['fixture-only-access-fixture-first-account-send','fixture-only-access-fixture-first-account-both'].includes(bearer))throw Error('FIXTURE_SEND_NOT_GRANTED');counts.send++;return Response.json({id:'synthetic-first-immutable-send',threadId:message.metadata.threadId});}
    if(parsed.pathname.endsWith('/history'))return Response.json({history:[],historyId:'1'});
    if(parsed.pathname.endsWith('/messages'))return Response.json({messages:[{id:message.metadata.id}],resultSizeEstimate:1});
    if(parsed.pathname.endsWith('/messages/'+message.metadata.id))return Response.json(parsed.searchParams.get('format')==='raw'?{id:message.metadata.id,threadId:message.metadata.threadId,raw:message.mime.toString('base64url')}:message.metadata);
    if(parsed.pathname.endsWith('/threads/'+message.metadata.threadId))return Response.json({id:message.metadata.threadId,messages:[message.metadata]});
    throw Error('FIXTURE_PROVIDER_URL_UNEXPECTED');
  };
  Object.defineProperty(fixture,'effectCounts',{get:()=>({...counts})});return fixture;
}
export function dataFixtureMessage(address='first@example.test'){
  const suffix=address.startsWith('second')?'second':'first',png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/wAAAABJRU5ErkJggg==','base64'),attachment=Buffer.from('EXACT_RECEIVED_FILE_'+suffix);
  const mime=Buffer.from('From: sender@example.test\r\nTo: '+address+'\r\nCc: peer@example.test\r\nSubject: Synthetic '+suffix+' source\r\nMessage-ID: <'+suffix+'-source@example.test>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=test\r\n\r\n--test\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Native '+suffix+' body<img src="cid:fixture-image" alt="Inline"><img src="https://public.example.test/image.png" alt="Remote"></p>\r\n--test\r\nContent-Type: image/png\r\nContent-ID: <fixture-image>\r\nContent-Disposition: inline; filename="inline.png"\r\nContent-Transfer-Encoding: base64\r\n\r\n'+png.toString('base64')+'\r\n--test\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename="received.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\n'+attachment.toString('base64')+'\r\n--test--\r\n');
  const metadata={id:'synthetic-'+suffix+'-message',threadId:'synthetic-'+suffix+'-thread',labelIds:['INBOX'],historyId:'1',internalDate:'1700000000000',payload:{headers:[{name:'From',value:'sender@example.test'},{name:'To',value:address},{name:'Cc',value:'peer@example.test'},{name:'Subject',value:'Synthetic '+suffix+' source'},{name:'Message-ID',value:'<'+suffix+'-source@example.test>'}]}};
  return {mime,metadata,attachment,png};
}
