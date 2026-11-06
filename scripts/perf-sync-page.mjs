#!/usr/bin/env node
// One-page foreground refresh harness. Fixture mode builds the real data runtime
// and durable store; live mode only replays captured request bodies and prints
// ids, counts and timings. It never prints bodies, tokens or message content.
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createDurableStore} from '../runtime/durable-store.mjs';
import {createConnectionRuntime} from '../runtime/connection-runtime.mjs';
import {createDataRuntime} from '../runtime/data-runtime.mjs';
import {makeScope,registrationFor,client,beginFor,nextFor,providerFixture,dataFixtureMessage} from '../runtime/test-support.mjs';

const args=process.argv.slice(2);
const option=(name,fallback)=>{const index=args.indexOf(name);return index<0?fallback:args[index+1];};
const flag=name=>args.includes(name);
const authorityMs=Number(option('--authority-ms',900));
const runs=Number(option('--runs',5));
const mode=option('--mode','both');
const live=option('--live',null);

if(live)await runLive();
else await runFixture();
process.exitCode=globalThis.__syncPageExitCode??0;

async function runFixture(){
  if(!Number.isFinite(authorityMs)||authorityMs<0||!Number.isInteger(runs)||runs<1)throw Error('usage: --authority-ms <ms> --runs <n> --mode cold|warm|busy|both');
  const parent=await mkdtemp(join(tmpdir(),'email-perf-sync-page-')),root=join(parent,'private'),encryption_key=Buffer.alloc(32,59),key_id='perf-sync-page';
  const scope=makeScope(),registration=registrationFor(scope);
  const message=dataFixtureMessage('harness@example.test');
  const tokens=new Map([['fixture-harness-first',{subject:'harness-first',address:'harness@example.test'}],['fixture-harness-second',{subject:'harness-second',address:'second@example.test'}]]);
  let providerCalls=0,pageCalls=0,authorityCalls=0,providerTimes=[];const events=[];
  const provider=async(url,options)=>{
    providerCalls++;const parsed=new URL(url),bearer=options.headers.Authorization?.slice(7),identity=tokens.get(bearer)??{subject:'harness-first',address:'harness@example.test'};
    if(url==='https://oauth2.googleapis.com/token'){const code=new URLSearchParams(options.body).get('code')??'fixture-only-code';const selected=tokens.get(code)??(code.includes('second')?tokens.get('fixture-harness-second'):tokens.get('fixture-harness-first'));tokens.set('fixture-access-'+code,selected);return Response.json({access_token:'fixture-access-'+code,refresh_token:'fixture-refresh-'+code,token_type:'Bearer',expires_in:3600,scope:'openid email https://www.googleapis.com/auth/gmail.readonly'});}
    if(parsed.pathname.endsWith('/profile'))return Response.json({emailAddress:identity.address,historyId:'1'});
    if(parsed.hostname==='openidconnect.googleapis.com'&&parsed.pathname.endsWith('/userinfo'))return Response.json({sub:identity.subject,email:identity.address,email_verified:true,name:identity.address});
    if(parsed.pathname.endsWith('/history')){providerTimes.push(performance.now());return Response.json({history:[],historyId:'1'});}
    if(parsed.pathname.endsWith('/messages')){
      providerCalls--;pageCalls++;providerTimes.push(performance.now());
      await delay(2);
      return Response.json({messages:Array.from({length:25},(_,index)=>({id:'harness-'+identity.subject+'-'+index})),resultSizeEstimate:25});
    }
    const match=parsed.pathname.match(/\/messages\/harness-(harness-first|harness-second)-(\d+)$/u);
    if(match){providerCalls--;pageCalls++;providerTimes.push(performance.now());await delay(2);const metadata=structuredClone(message.metadata);metadata.id='harness-'+match[1]+'-'+match[2];metadata.threadId='harness-thread-'+match[1]+'-'+match[2];metadata.payload.headers=metadata.payload.headers.map(header=>header.name==='To'?{...header,value:identity.address}:header);return Response.json(metadata);}
    return providerFixture(url,options);
  };
  const store=await createDurableStore({root,encryption_key,key_id,allow_windows_fixture:process.platform==='win32'});
  const connectionRuntime=createConnectionRuntime({registration,client,store,encryption_key,key_id,assertCurrent:async input=>({...input,allowed:true}),fetch:provider});
  const sessions=[];
  for(const code of ['fixture-harness-first']){
    const begin=beginFor(scope),begun=await connectionRuntime.request(begin),connected=await connectionRuntime.request(nextFor(begin,begun,'callback',null));
    sessions.push({begin,begun,connected});
  }
  const selected=sessions[0];
  const busyAuthorityMs=Math.min(authorityMs,10);let activeAuthorityMs=authorityMs;
  const data=createDataRuntime({registrations:[registration],client,store,encryption_key,key_id,onDiagnostic:event=>events.push(event),assertCurrent:async input=>{authorityCalls++;await delay(activeAuthorityMs);return {...input,allowed:true};},fetch:provider});
  const request=(operation,input)=>({schema_version:'deft.app_data_runtime.v1',request_id:randomUUID(),scope,connection:{session_id:selected.begin.session_id,session_revision:5,runtime_session_ref:selected.begun.runtime_session_ref,account_ref:selected.connected.account.account_ref},authority:{consent_id:randomUUID(),consent_digest:'sha256:'+'d'.repeat(64),data_policy_digest:'sha256:'+'e'.repeat(64)},operation,expires_at:new Date(Date.now()+29000).toISOString(),input});
  const measure=async kind=>{
    const authorityBefore=authorityCalls,pageBefore=pageCalls,eventBefore=events.length,timesBefore=providerTimes.length,started=performance.now();
    let requests=0,rows=[],nextCursor=null,providerObserved=null;
    const refreshed=await data.request(request('resource_refresh',{store_key:'drafts',resource_key:'inbox'}));requests++;
    if(refreshed.freshness?.provider_observed===false){rows=[];nextCursor=null;}
    else if(Array.isArray(refreshed.items)){rows=refreshed.items;nextCursor=refreshed.next_cursor??null;}
    else{const listed=await data.request(request('resource_list',{store_key:'drafts',resource_key:'inbox',cursor:null,limit:25}));requests++;rows=listed.items;nextCursor=listed.next_cursor??null;}
    providerObserved=refreshed.freshness?.provider_observed??null;
    const elapsed=Math.round((performance.now()-started)*100)/100,timing=events.slice(eventBefore).find(event=>event.event==='email_foreground_timing');
    const count=(from)=>providerTimes.slice(from).sort((a,b)=>a-b).reduce((waves,time,index,times)=>waves+(index===0||time-times[index-1]>Math.max(50,authorityMs*0.9)?1:0),0);
    const providerWaves=count(timesBefore),authorityCallbacks=authorityCalls-authorityBefore;
    return {event:'sync_page_measurement',mode:kind,authority_ms:authorityMs,requests,host_fences:authorityCallbacks,runtime_authority_callbacks:providerWaves?providerWaves+(refreshed.freshness?.provider_observed===false?0:1):0,provider_calls:pageCalls-pageBefore,session_queue_ms:timing?.timings?.session_queue?.elapsed_ms??0,provider_http_ms:timing?.timings?.provider_http?.elapsed_ms??0,elapsed_ms:elapsed,authority_completed_under_150_ms:authorityMs<150?authorityCallbacks:0,rows_returned:rows.length,next_cursor:nextCursor,provider_observed:providerObserved};
  };
  const samples={cold:[],warm:[],busy:[]},wanted=value=>mode==='both'||mode===value;
  try{
    for(let run=0;run<runs;run++){
      if(wanted('cold')){const sample=await measure('cold');samples.cold.push(sample);console.log(JSON.stringify({...sample,run:run+1}));}
      if(wanted('warm')){const sample=await measure('warm');samples.warm.push(sample);console.log(JSON.stringify({...sample,run:run+1}));}
      if(wanted('busy')){
        let release,entered;const gate=new Promise(done=>release=done),held=new Promise(done=>entered=done);
        const holder=store.withLock({key:'email.runtime.session.'+selected.begin.session_id},async tx=>{entered();await gate;return tx.read();});
        await held;activeAuthorityMs=busyAuthorityMs;let sample;try{sample=await measure('busy');}finally{activeAuthorityMs=authorityMs;}release();await holder;
        sample={...sample,busy_authority_ms:busyAuthorityMs};
        samples.busy.push(sample);console.log(JSON.stringify({...sample,run:run+1}));
      }
    }
  }finally{await store.close();await rm(parent,{recursive:true,force:true});}
  const percentile=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(sorted.length*p)-1)];};
  const summary={event:'sync_page_summary',authority_ms:authorityMs,runs,fixture_accounts:2,accounts_measured:1,modes:{}};
  let breached=false;
  for(const [kind,list]of Object.entries(samples)){
    if(!list.length)continue;
    const elapsed=list.map(sample=>sample.elapsed_ms);
    summary.modes[kind]={p50:percentile(elapsed,0.5),p95:percentile(elapsed,0.95),max:Math.max(...elapsed),provider_calls_max:Math.max(...list.map(sample=>sample.provider_calls)),runtime_authority_callbacks_max:Math.max(...list.map(sample=>sample.runtime_authority_callbacks)),requests:Math.max(...list.map(sample=>sample.requests)),...(kind==='busy'?{busy_authority_ms:busyAuthorityMs}:{})};
    const budget=kind==='cold'?(authorityMs<=450?6000:10000):kind==='warm'?8000:500;
    if(summary.modes[kind].p95>budget||summary.modes[kind].provider_calls_max>11||summary.modes[kind].runtime_authority_callbacks_max>4)breached=true;
  }
  summary.pass=!breached;
  console.log(JSON.stringify(summary));
  globalThis.__syncPageExitCode=breached?1:0;
}

async function runLive(){
  const cookieFile=option('--cookie-file',null),installation=option('--installation',null),requestFile=option('--request-file',null);
  if(!cookieFile||!installation){console.error(JSON.stringify({event:'sync_page_live_error',error:'cookie and installation are required'}));globalThis.__syncPageExitCode=2;return;}
  if(!requestFile){console.error(JSON.stringify({event:'sync_page_live_error',error:'capture the refresh/list request bodies once from DevTools and pass --request-file; live mode does not construct or print bodies'}));globalThis.__syncPageExitCode=2;return;}
  const cookies=await readFile(cookieFile,'utf8'),captured=JSON.parse(await readFile(requestFile,'utf8'));
  const bodies=Array.isArray(captured)?captured:[captured];
  const measurements=[];
  for(const body of bodies){
    const connection=body.connection?.session_id??'unknown',started=performance.now();
    const response=await fetch(new URL(`/api/app-data/connections/${encodeURIComponent(connection)}/requests`,live),{method:'POST',headers:{'content-type':'application/json',cookie:cookies.trim(),'cache-control':'no-store'},body:JSON.stringify(body)});
    const result=await response.json().catch(()=>({})),elapsed=Math.round((performance.now()-started)*100)/100;
    measurements.push({event:'sync_page_measurement',mode:'live',authority_ms:null,requests:1,host_fences:null,runtime_authority_callbacks:null,provider_calls:null,session_queue_ms:null,provider_http_ms:null,elapsed_ms:elapsed,authority_completed_under_150_ms:null,status:response.status,request_ids:[body.request_id,result.request_id].filter(value=>typeof value==='string'),outcome:typeof result.outcome==='string'?result.outcome:null,rows_returned:Array.isArray(result.items)?result.items.length:null,next_cursor:typeof result.next_cursor==='string'||result.next_cursor===null?result.next_cursor:null,provider_observed:result.freshness?.provider_observed??null});
  }
  for(const sample of measurements)console.log(JSON.stringify(sample));
  console.log(JSON.stringify({event:'sync_page_summary',mode:'live',installation,requests:measurements.length,elapsed_ms:measurements.map(sample=>sample.elapsed_ms),pass:measurements.every(sample=>sample.status===200)}));
  globalThis.__syncPageExitCode=measurements.every(sample=>sample.status===200)?0:1;
}
