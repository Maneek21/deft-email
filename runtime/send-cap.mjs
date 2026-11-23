import {fail} from './contract.mjs';

/** Per-workspace cap on sent email (launch check 6.6).
 *
 * Settings, read from the helper's environment when it starts:
 * - EMAIL_RUNTIME_SEND_LIMIT_HOURLY: sends allowed in any rolling hour.
 * - EMAIL_RUNTIME_SEND_LIMIT_DAILY: sends allowed in any rolling 24 hours.
 * Each is a whole number from 1 to 10000. Any other value, the empty string
 * included, refuses to start. Absent: 200 and 2,000 when the helper is hosted
 * (form mode with `registration_admission: "host_authority"`, which only the
 * hosted control plane writes), and no cap at all for a self-hosted helper.
 *
 * Counting: a Send takes its slot, keyed by its Run id (the provider
 * idempotency key), in the same locked step that checks the cap, just before
 * the provider is called. The slot is given back only when the Send is known
 * not to have reached the provider (it failed before the provider call, or the
 * provider definitely refused it). So an accepted, partly accepted or uncertain
 * Send always counts, a crash can never lose a count, a retry of the same Run
 * never counts twice, and concurrent Sends cannot overshoot. Counts live in the
 * helper's own encrypted store, so a restart keeps them. A refused Run is
 * remembered and replays its refusal; it never sends later. */
export const SEND_LIMIT_HOURLY_SETTING='EMAIL_RUNTIME_SEND_LIMIT_HOURLY';
export const SEND_LIMIT_DAILY_SETTING='EMAIL_RUNTIME_SEND_LIMIT_DAILY';
export const HOSTED_SEND_LIMITS=Object.freeze({hourly:200,daily:2000});
export const SEND_LIMIT_CODE='EMAIL_SEND_LIMIT_REACHED';
export const SEND_LIMIT_OUTCOME='send_limit_reached';
const HOUR=3600000,DAY=24*HOUR,MAXIMUM=10000,REFUSALS_KEPT=4000;
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value);

export function resolveSendLimits({env=process.env,hosted=false}={}){
  const read=name=>{const raw=env?.[name];if(raw===undefined)return null;if(typeof raw!=='string'||!/^[1-9][0-9]{0,4}$/u.test(raw)||Number(raw)>MAXIMUM)fail('EMAIL_RUNTIME_CONFIG_INVALID');return Number(raw);};
  const hourly=read(SEND_LIMIT_HOURLY_SETTING),daily=read(SEND_LIMIT_DAILY_SETTING);
  return Object.freeze({hourly:hourly??(hosted?HOSTED_SEND_LIMITS.hourly:null),daily:daily??(hosted?HOSTED_SEND_LIMITS.daily:null)});
}
const validLimits=limits=>limits===undefined||limits===null||typeof limits==='object'&&['hourly','daily'].every(key=>limits[key]===null||limits[key]===undefined||Number.isSafeInteger(limits[key])&&limits[key]>=1&&limits[key]<=MAXIMUM);

/** The Run result for a refused Send: final, nothing attempted at the provider.
 * It fits the App's reviewed Send output schema, so no App upgrade is needed. */
export const sendLimitResult=run_id=>({status:'returned',provider_succeeded:false,output:{operation_id:run_id,primary_outcome:SEND_LIMIT_OUTCOME,effect_outcome:'not_attempted',inspection_available:false}});

export function createSendCap({store,limits,now=Date.now,onLimit=event=>console.info(JSON.stringify(event))}){
  if(!validLimits(limits))fail('EMAIL_RUNTIME_CONFIG_INVALID');
  const hourly=limits?.hourly??null,daily=limits?.daily??null,enabled=hourly!==null||daily!==null;
  // Only the longest active window is kept, so the row stays bounded: at most
  // the larger limit (10000) slots plus REFUSALS_KEPT compact refusals, < 1 MiB.
  const kept=daily!==null?DAY:HOUR;
  const keyFor=org_id=>{if(!uuid(org_id))fail('EMAIL_SEND_LIMIT_INVALID');return 'email.runtime.send_cap.'+org_id.toLowerCase();};
  const current=(value,org,at)=>{
    // v1 (a pre-release build of this change) held only counted sends: they are kept as slots.
    if(value&&(!['email.send_cap.v1','email.send_cap.v2'].includes(value.schema_version)||value.org_id!==org||!Array.isArray(value.sends)||value.schema_version==='email.send_cap.v2'&&!Array.isArray(value.refused)))fail('EMAIL_RUNTIME_STORE_ROW_INVALID');
    const sends=(value?.sends??[]).filter(([,time])=>Number.isSafeInteger(time)&&time>at-kept).sort((a,b)=>a[1]-b[1]);
    // Refusals are kept 24 hours (at most REFUSALS_KEPT), past any window lifting.
    const refused=(value?.refused??[]).filter(entry=>entry.length===6&&Number.isSafeInteger(entry[1])&&entry[1]>at-DAY).slice(-REFUSALS_KEPT);
    return {sends,refused,notified_until:Number.isSafeInteger(value?.notified_until)?value.notified_until:null};
  };
  const write=async(tx,row,org,state)=>{if(!await tx.compareAndSwap({expected_revision:row?.revision??null,value:{schema_version:'email.send_cap.v2',org_id:org,...state}}))fail('EMAIL_RUNTIME_CONFLICT');};
  // A refusal is kept compact ([run, at, window, limit, sent, lifts]) so REFUSALS_KEPT of them fit beside 10000 slots.
  const expand=([,,day,limit,sent,lifts])=>({code:SEND_LIMIT_CODE,window:day===1?'day':'hour',limit,sent,lifts_at:new Date(lifts).toISOString()});
  const reached=(sends,at)=>{
    const windows=[];const hour=sends.filter(([,time])=>time>at-HOUR);
    if(hourly!==null&&hour.length>=hourly)windows.push({window:'hour',limit:hourly,sent:hour.length,lifts:hour[hour.length-hourly][1]+HOUR});
    if(daily!==null&&sends.length>=daily)windows.push({window:'day',limit:daily,sent:sends.length,lifts:sends[sends.length-daily][1]+DAY});
    if(!windows.length)return null;
    // Sending starts again only once every window is under its limit.
    const last=windows.reduce((a,b)=>b.lifts>a.lifts?b:a);
    return {code:SEND_LIMIT_CODE,window:last.window,limit:last.limit,sent:last.sent,lifts_at:new Date(Math.max(last.lifts,at+1000)).toISOString()};
  };
  return Object.freeze({
    enabled,limits:Object.freeze({hourly,daily}),
    /** Before the provider call: null when this Run may send (its slot is now
     * taken, durably), otherwise why not and until when. Idempotent per Run:
     * a Run that holds a slot keeps it; a refused Run stays refused. The first
     * refusal in a window gives one notice; later ones are quiet. */
    async take(org_id,run_id){
      if(!enabled)return null;if(!uuid(run_id))fail('EMAIL_SEND_LIMIT_INVALID');const key=keyFor(org_id),org=org_id.toLowerCase(),id=run_id.toLowerCase();
      return store.withLock({key},async tx=>{
        const at=now(),row=await tx.read(),state=current(row?.value,org,at);
        if(state.sends.some(([held])=>held===id))return null;
        const prior=state.refused.find(([refused])=>refused===id);if(prior)return expand(prior);
        const limit=reached(state.sends,at);
        if(!limit){await write(tx,row,org,{...state,sends:[...state.sends,[id,at]]});return null;}
        const notify=state.notified_until===null||state.notified_until<=at;
        await write(tx,row,org,{...state,refused:[...state.refused,[id,at,limit.window==='day'?1:0,limit.limit,limit.sent,Date.parse(limit.lifts_at)]].slice(-REFUSALS_KEPT),notified_until:notify?Date.parse(limit.lifts_at):state.notified_until});
        if(notify){try{onLimit({event:'email_send_limit_reached',org_id:org,window:limit.window,limit:limit.limit,sent:limit.sent,lifts_at:limit.lifts_at});}catch{}}
        return limit;
      });
    },
    /** Gives back a Run's slot. Only for a Send known not to have reached the
     * provider: never after an accepted, partial or uncertain outcome. */
    async release(org_id,run_id){
      if(!enabled)return false;if(!uuid(run_id))fail('EMAIL_SEND_LIMIT_INVALID');const key=keyFor(org_id),org=org_id.toLowerCase(),id=run_id.toLowerCase();
      return store.withLock({key},async tx=>{
        const at=now(),row=await tx.read(),state=current(row?.value,org,at);if(!state.sends.some(([held])=>held===id))return false;
        await write(tx,row,org,{...state,sends:state.sends.filter(([held])=>held!==id)});return true;
      });
    },
    async usage(org_id){
      const at=now(),org=org_id.toLowerCase(),row=enabled?await store.withLock({key:keyFor(org_id)},tx=>tx.read()):null,state=current(row?.value,org,at);
      return {hour:state.sends.filter(([,time])=>time>at-HOUR).length,day:state.sends.filter(([,time])=>time>at-DAY).length};
    }
  });
}
