import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDurableStore} from './durable-store.mjs';
import {createConnectionFormRuntime} from './connection-form-runtime.mjs';
import {makeScope,registrationFor} from './test-support.mjs';
import {digest} from './contract.mjs';
export const profile=()=>({imap:{host:'mail.example.test',port:993,transport:'implicit_tls',username:'owner',password:'FIXTURE_ONLY_IMAP_PASSWORD'},smtp:null,primary_address:'owner@example.test',display_label:'Owner declared address'});
export async function fixture(options={}){
 const root=await mkdtemp(join(tmpdir(),'imap-form-proof-')),encryption_key=randomBytes(32),scope=makeScope(),registrations=[{...registrationFor(scope),connection_protocol:'credential_form.v1'}],calls=[];let probes=0,revoked=false,clock=Date.now();
 const store=await createDurableStore({root,encryption_key,key_id:'fixture',allow_windows_fixture:true});
 const config={registrations,store,setup_origin:'https://runtime.example.test',policy_digest:'sha256:'+digest({imap_hosts:['mail.example.test']}),endpointPolicy:value=>value.imap.host==='mail.example.test'&&(!value.smtp||value.smtp.host==='smtp.example.test'),now:()=>clock,
  assertCurrent:async value=>{calls.push({operation:value.operation,session_id:value.session_id});if(revoked)throw Object.assign(new Error('denied'),{code:'EMAIL_FORM_AUTHORITY_DENIED'});return {...value,allowed:true};},connector:{probe:async value=>{probes++;if(options.probe)await options.probe(value);}},onPhase:options.onPhase};
 const forms=createConnectionFormRuntime(config),request={schema_version:'deft.app_connection_form_runtime.v1',session_id:randomUUID(),scope,operation:'begin',setup_expires_at:new Date(clock+300000).toISOString(),expires_at:new Date(clock+29000).toISOString(),action_consents:[],source:null};
 const connect=async(value=profile(),input=request)=>{const begun=await forms.request(input),browser=await forms.exchange(new URL(begun.setup_url).hash.slice(1)),connected=await forms.submit({...browser,value});return {begun,browser,connected};};
 return {forms,store,config,root,encryption_key,request,scope,calls,connect,get probes(){return probes;},revoke(){revoked=true;},advance(ms){clock+=ms;},fresh(input=request){return {...input,expires_at:new Date(clock+29000).toISOString()};},async close(){await store.close();}};
}
