import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer, request as httpRequest} from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {createHttpHandler} from './http.mjs';
import {makeScope} from './test-support.mjs';

test('completed HTTP request body keeps runtime alive; caller socket close aborts outstanding I/O', async t => {
  const token = randomBytes(32).toString('base64url'); let signal, entered, aborted;
  const ready = new Promise(done => {entered = done;}), cancelled = new Promise(done => {aborted = done;});
  const server = createServer(createHttpHandler({runtime_auth_token: token, runtime: {async request(input, currentSignal) {
    signal = currentSignal; entered();
    await new Promise((resolve, reject) => {signal.addEventListener('abort', () => {aborted(); reject(signal.reason);}, {once: true});});
  }}}));
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => server.close(done)));
  const request = httpRequest({hostname: '127.0.0.1', port: server.address().port, path: '/v1/connections', method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + token}}, () => {});
  request.on('error', () => {}); request.end('{}');
  await ready; assert.equal(signal.aborted, false);
  request.destroy(); await cancelled; assert.equal(signal.aborted, true);
});

test('only validated retained reattachment gets the bounded multi-purpose HTTP phase',async t=>{
 for(const mode of ['reattach','ceiling','ordinary'])await t.test(mode==='ordinary'?'ordinary operations keep thirty seconds':mode==='ceiling'?'reattachment retains the two-minute ceiling':'reattachment survives thirty seconds',async t=>{
  const reattach=mode!=='ordinary',requested=mode==='ceiling'?240000:110000;
  t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});
  t.mock.method(AbortSignal,'timeout',milliseconds=>{const c=new AbortController();setTimeout(()=>c.abort(new Error('test deadline')),milliseconds);return c.signal;});
  const source=makeScope(),scope={...source,app_version_id:randomUUID(),grant_snapshot_id:randomUUID(),resource_binding_id:randomUUID(),runtime_registration_id:randomUUID(),lifecycle_epoch:source.lifecycle_epoch+1,grant_epoch:source.grant_epoch+1};
  const input=reattach?{schema_version:'deft.app_connection_reattach_runtime.v2',session_id:randomUUID(),scope,source:{session_id:randomUUID(),session_revision:1,scope:source,runtime_session_ref:'synthetic_source_runtime_reference',account_ref:'synthetic-account'},transport_digest:'sha256:'+'1'.repeat(64),review_expires_at:new Date(Date.now()+300000).toISOString(),expires_at:new Date(Date.now()+requested).toISOString(),operation:'prepare',action_consents:[]}:{};
  const token=randomBytes(32).toString('base64url');let signal,entered,release;
  const ready=new Promise(done=>{entered=done;});
  const server=createServer(createHttpHandler({runtime_auth_token:token,runtime:{async request(body,current){signal=current;entered();return new Promise((resolve,reject)=>{release=resolve;current.addEventListener('abort',()=>reject(current.reason),{once:true});});}}}));
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const client=httpRequest({hostname:'127.0.0.1',port:server.address().port,path:'/v1/connections',method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token}},response=>response.resume());client.on('error',()=>{});
  t.after(async()=>{release?.({ok:true});client.destroy();server.closeAllConnections();await new Promise(done=>server.close(done));});
  client.end(JSON.stringify(input));await ready;t.mock.timers.tick(31000);
  assert.equal(signal.aborted,!reattach);
  if(reattach){t.mock.timers.tick(Math.min(requested,120000)-31000+1);assert.equal(signal.aborted,true,'the request deadline and two-minute ceiling remain binding');}
 });
});

test('authenticated stalled bodies still terminate at thirty seconds before runtime dispatch',async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:Date.now()});
 const token=randomBytes(32).toString('base64url');let calls=0,entered;
 const ready=new Promise(done=>{entered=done;}),handler=createHttpHandler({runtime_auth_token:token,runtime:{request(){calls++;return {};}}});
 const server=createServer((request,response)=>{void handler(request,response);entered();});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const client=httpRequest({hostname:'127.0.0.1',port:server.address().port,path:'/v1/connections',method:'POST',headers:{'content-type':'application/json','content-length':'1000',authorization:'Bearer '+token}},response=>response.resume());
 client.on('error',()=>{});const closed=new Promise(done=>client.once('close',done));
 t.after(async()=>{client.destroy();server.closeAllConnections();await new Promise(done=>server.close(done));});
 client.write('{');await ready;t.mock.timers.tick(31000);await closed;assert.equal(calls,0);
});

test('a validated retained response survives the actual Node idle socket timeout without extending ordinary keep-alive requests',async t=>{
 const token=randomBytes(32).toString('base64url'),source=makeScope();
 const scope={...source,app_version_id:randomUUID(),grant_snapshot_id:randomUUID(),resource_binding_id:randomUUID(),runtime_registration_id:randomUUID(),lifecycle_epoch:source.lifecycle_epoch+1,grant_epoch:source.grant_epoch+1};
 const retained={schema_version:'deft.app_connection_reattach_runtime.v2',session_id:randomUUID(),scope,source:{session_id:randomUUID(),session_revision:1,scope:source,runtime_session_ref:'synthetic_source_runtime_reference',account_ref:'synthetic-account'},transport_digest:'sha256:'+'1'.repeat(64),review_expires_at:new Date(Date.now()+300000).toISOString(),expires_at:new Date(Date.now()+110000).toISOString(),operation:'prepare',action_consents:[]};
 const sockets=[];
 const handler=createHttpHandler({runtime_auth_token:token,runtime:{async request(input,signal){await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,300);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});});return {ok:true};}}});
 const server=createServer((request,response)=>{sockets.push(request.socket);void handler(request,response);});server.timeout=100;
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 const {Agent}=await import('node:http'),agent=new Agent({keepAlive:true,maxSockets:1});
 t.after(async()=>{agent.destroy();server.closeAllConnections();await new Promise(done=>server.close(done));});
 const post=(body,credential=token)=>new Promise((resolve,reject)=>{const request=httpRequest({hostname:'127.0.0.1',port:server.address().port,path:'/v1/connections',method:'POST',agent,headers:{authorization:'Bearer '+credential,'content-type':'application/json'}},response=>{let text='';response.on('data',chunk=>{text+=chunk;});response.on('end',()=>resolve({status:response.statusCode,body:JSON.parse(text)}));});request.on('error',reject);request.end(JSON.stringify(body));});
 assert.deepEqual(await post(retained),{status:200,body:{ok:true}});
 await assert.rejects(post({}),{code:'ECONNRESET'});
 assert.equal(sockets[0],sockets[1],'the subsequent ordinary operation uses the same socket and regains its ordinary timeout');
 assert.equal((await post(retained,randomBytes(32).toString('base64url'))).status,401);
 const malformed={...retained,unexpected:true};assert.equal((await post(malformed)).status,400);
 assert.equal(server.timeout,100,'the global socket budget is unchanged');
});
