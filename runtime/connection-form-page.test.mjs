import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import vm from 'node:vm';
import {createConnectionFormHttpHandler} from './connection-form-http.mjs';

// The setup page is one inline script under a strict content policy. These tests
// run that exact script against a minimal stand-in for the browser, so the page's
// behaviour is checked without one. They do not prove rendering in a real browser.
async function servedPage(){
 const server=createServer(createConnectionFormHttpHandler({forms:{},setup_origin:'https://runtime.example.test',runtime_auth_token:'t'.repeat(43)}));await new Promise(done=>server.listen(0,'127.0.0.1',done));
 try{const response=await fetch('http://127.0.0.1:'+server.address().port+'/setup');return {html:await response.text(),policy:response.headers.get('content-security-policy')};}finally{await new Promise(done=>server.close(done));}
}
const NAMES=['imap_host','imap_port','imap_transport','imap_username','imap_password','smtp_host','smtp_port','smtp_transport','smtp_username','smtp_password','primary_address','display_label','smtp_enabled'];
/** Runs the page script. `answers` is consumed one fetch at a time. */
async function openPage(script,answers){
 const listeners={},elements=Object.fromEntries(NAMES.map(name=>{const own={};return [name,{name,value:name.endsWith('_port')?(name.startsWith('imap')?'993':'465'):name.endsWith('_transport')?'implicit_tls':'',checked:false,addEventListener(type,fn){own[type]=fn;},fire(type){return own[type]({target:this});}}];}));
 const form={hidden:false,elements,addEventListener(type,fn){listeners[type]=fn;},querySelectorAll(selector){assert.equal(selector,'input[type=password]');return [elements.imap_password,elements.smtp_password];}},status={textContent:''},calls=[],address=[];
 const context={location:{hash:'#'+'k'.repeat(43)},history:{replaceState(_state,_title,path){address.push(path);}},document:{querySelector:selector=>selector==='form'?form:selector==='[role=status]'?status:assert.fail(selector)},
  fetch:async(path,init)=>{calls.push({path,init,body:JSON.parse(init.body)});const answer=answers.shift();if(!answer)throw Error('no answer scripted');return {ok:answer.status===200,status:answer.status,json:async()=>answer.body};},
  Object,Number,Boolean,Error,JSON};
 vm.runInNewContext(script,context);await new Promise(done=>setImmediate(done));
 const fill=(password='typed-password')=>{Object.assign(elements.imap_host,{value:'imap.example.test'});Object.assign(elements.imap_username,{value:'owner'});Object.assign(elements.imap_password,{value:password});Object.assign(elements.primary_address,{value:'owner@example.test'});Object.assign(elements.display_label,{value:'Owner'});};
 const submit=async()=>{await listeners.submit({preventDefault(){}});await new Promise(done=>setImmediate(done));};
 return {form,status,calls,address,elements,fill,submit};
}
const ok=body=>({status:200,body}),refusal=(code,retry)=>({status:403,body:{code,...(retry?{retry:true}:{})}});
const session={session_id:'00000000-0000-4000-8000-000000000000',csrf:'c'.repeat(43),expires_at:'2030-01-01T00:00:00.000Z'};

test('the content policy admits exactly the one inline script the page serves',async()=>{
 const {html,policy}=await servedPage(),scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/gu)];assert.equal(scripts.length,1);
 assert.equal(policy,"default-src 'none'; script-src 'sha256-"+createHash('sha256').update(scripts[0][1]).digest('base64')+"'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
 // No other executable or styled content could run under that policy, so none may be served.
 assert(!/<script[^>]+src=|<style|<link|\son[a-z]+=|javascript:/iu.test(html));assert(html.includes('app passwords'));
});

test('the page trades its one-use ticket once, removes it from the address bar and shows the form',async()=>{
 const {html}=await servedPage(),page=await openPage(/<script>([\s\S]*?)<\/script>/u.exec(html)[1],[ok(session)]);
 assert.deepEqual(page.address,['/setup']);assert.equal(page.calls.length,1);assert.equal(page.calls[0].path,'/setup/exchange');assert.deepEqual(page.calls[0].body,{ticket:'k'.repeat(43)});
 assert.equal(page.calls[0].init.credentials,'same-origin');assert.equal(page.calls[0].init.redirect,'error');assert.equal(page.form.hidden,false);
 const closed=await openPage(/<script>([\s\S]*?)<\/script>/u.exec(html)[1],[refusal('EMAIL_FORM_TICKET_DENIED')]);assert.equal(closed.form.hidden,true);assert.match(closed.status.textContent,/Setup unavailable/u);
});

test('a refused login keeps the page usable only when the runtime says so, and never keeps a typed password',async()=>{
 const {html}=await servedPage(),script=/<script>([\s\S]*?)<\/script>/u.exec(html)[1];
 const page=await openPage(script,[ok(session),refusal('EMAIL_IMAP_LOGIN_REJECTED',true),ok({state:'connected'})]);page.fill('wrong-password');await page.submit();
 assert.equal(page.calls[1].path,'/setup/submit');assert.deepEqual(page.calls[1].body,{session_id:session.session_id,csrf:session.csrf,value:{imap:{host:'imap.example.test',port:993,transport:'implicit_tls',username:'owner',password:'wrong-password'},smtp:null,primary_address:'owner@example.test',display_label:'Owner'}});
 assert.match(page.status.textContent,/did not accept this username and password\. Nothing was saved\. Correct the details and try again\./u);assert.equal(page.form.hidden,false);assert.equal(page.elements.imap_password.value,'');
 page.fill('right-password');await page.submit();assert.equal(page.calls[2].body.csrf,session.csrf);assert.match(page.status.textContent,/Login authenticated/u);assert.equal(page.form.hidden,true);assert.equal(page.elements.imap_password.value,'');
 // After the page has finished it holds no session to submit with.
 await page.submit();assert.equal(page.calls.length,3);assert.match(page.status.textContent,/Outcome uncertain/u);

 const last=await openPage(script,[ok(session),refusal('EMAIL_IMAP_LOGIN_REJECTED',false)]);last.fill();await last.submit();
 assert.match(last.status.textContent,/Nothing was saved\. Return to Deft, check connection status, then connect again\./u);assert.equal(last.form.hidden,true);assert.equal(last.elements.imap_password.value,'');
 const capped=await openPage(script,[ok(session),refusal('EMAIL_FORM_ATTEMPTS_EXCEEDED',false)]);capped.fill();await capped.submit();assert.match(capped.status.textContent,/Too many failed attempts/u);assert.equal(capped.form.hidden,true);
 // A code the page does not know, or a retry flag on an unknown code, is treated as an uncertain outcome.
 for(const answer of [refusal('EMAIL_FORM_SUBMIT_DENIED',false),refusal('EMAIL_SOMETHING_NEW',true),{status:503,body:null},refusal('constructor',true)]){const unknown=await openPage(script,[ok(session),answer]);unknown.fill();await unknown.submit();assert.match(unknown.status.textContent,/^Outcome uncertain\. Return to Deft and check status; do not submit again\.$/u);assert.equal(unknown.form.hidden,true);}
});

test('choosing a transport sets its fixed port, so the standard choices are always valid input',async()=>{
 const {html}=await servedPage(),page=await openPage(/<script>([\s\S]*?)<\/script>/u.exec(html)[1],[ok(session),ok({state:'connected'})]);
 page.elements.imap_transport.value='starttls_required';page.elements.imap_transport.fire('change');assert.equal(page.elements.imap_port.value,143);
 page.elements.smtp_transport.value='starttls_required';page.elements.smtp_transport.fire('change');assert.equal(page.elements.smtp_port.value,587);
 page.elements.imap_transport.value='implicit_tls';page.elements.imap_transport.fire('change');assert.equal(page.elements.imap_port.value,993);
 page.elements.smtp_transport.value='implicit_tls';page.elements.smtp_transport.fire('change');assert.equal(page.elements.smtp_port.value,465);
 page.elements.imap_transport.value='starttls_required';page.elements.imap_transport.fire('change');page.fill();page.elements.smtp_enabled.checked=true;Object.assign(page.elements.smtp_host,{value:'smtp.example.test'});Object.assign(page.elements.smtp_username,{value:'owner'});Object.assign(page.elements.smtp_password,{value:'typed-password'});
 await page.submit();assert.equal(page.calls[1].body.value.imap.port,143);assert.equal(page.calls[1].body.value.imap.transport,'starttls_required');assert.deepEqual(page.calls[1].body.value.smtp,{host:'smtp.example.test',port:465,transport:'implicit_tls',username:'owner',password:'typed-password'});
 assert.equal(page.elements.smtp_password.value,'');
});
