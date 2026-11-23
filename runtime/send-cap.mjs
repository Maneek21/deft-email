import {fail} from './contract.mjs';

/** Per-workspace cap on sent email (launch check 6.6).
 *
 * Settings, read from the helper's environment when it starts:
 * - EMAIL_RUNTIME_SEND_LIMIT_HOURLY: sends allowed in any rolling hour.
 * - EMAIL_RUNTIME_SEND_LIMIT_DAILY: sends allowed in any rolling 24 hours.
 * Each is a whole number from 1 to 10000. Any other value refuses to start.
 * Unset: 200 and 2,000 when the helper is hosted (form mode with
 * `registration_admission: "host_authority"`, which only the hosted control
 * plane writes), and no cap at all for a self-hosted helper.
 *
 * A send is counted once, when the mail provider accepts it, under the Run's
 * own id (the provider idempotency key), so a retry of the same Run never
 * counts twice. Counts live in the helper's own encrypted store, so a restart
 * keeps them. Past the cap a Send is refused before any provider call. */
export const SEND_LIMIT_HOURLY_SETTING='EMAIL_RUNTIME_SEND_LIMIT_HOURLY';
export const SEND_LIMIT_DAILY_SETTING='EMAIL_RUNTIME_SEND_LIMIT_DAILY';
export const HOSTED_SEND_LIMITS=Object.freeze({hourly:200,daily:2000});
export const SEND_LIMIT_CODE='EMAIL_SEND_LIMIT_REACHED';
export const SEND_LIMIT_OUTCOME='send_limit_reached';
const HOUR=3600000,DAY=24*HOUR,MAXIMUM=10000;
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value);

export function resolveSendLimits({env=process.env,hosted=false}={}){
  const read=name=>{const raw=env?.[name];if(raw===undefined||raw==='')return null;if(typeof raw!=='string'||!/^[1-9][0-9]{0,4}$/u.test(raw.trim())||Number(raw)>MAXIMUM)fail('EMAIL_RUNTIME_CONFIG_INVALID');return Number(raw);};
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
  const keyFor=org_id=>{if(!uuid(org_id))fail('EMAIL_SEND_LIMIT_INVALID');return 'email.runtime.send_cap.'+org_id.toLowerCase();};
  const current=(value,org_id,at)=>{
    if(value&&(value.schema_version!=='email.send_cap.v1'||value.org_id!==org_id.toLowerCase()||!Array.isArray(value.sends)))fail('EMAIL_RUNTIME_STORE_ROW_INVALID');
    // Kept for 24 hours: the longest window, and the retry dedupe horizon.
    const sends=(value?.sends??[]).filter(([,time])=>Number.isSafeInteger(time)&&time>at-DAY).sort((a,b)=>a[1]-b[1]);
    return {sends,notified_until:Number.isSafeInteger(value?.notified_until)?value.notified_until:null};
  };
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
    /** null when this workspace may send now; otherwise why not and until when.
     * The first refusal in a window gives one notice; later ones are quiet. */
    async admit(org_id){
      if(!enabled)return null;const key=keyFor(org_id);
      return store.withLock({key},async tx=>{
        const at=now(),row=await tx.read(),state=current(row?.value,org_id,at),limit=reached(state.sends,at);if(!limit)return null;
        if(state.notified_until===null||state.notified_until<=at){
          const lifts=Date.parse(limit.lifts_at);
          if(await tx.compareAndSwap({expected_revision:row?.revision??null,value:{schema_version:'email.send_cap.v1',org_id:org_id.toLowerCase(),sends:state.sends,notified_until:lifts}})){
            try{onLimit({event:'email_send_limit_reached',org_id:org_id.toLowerCase(),window:limit.window,limit:limit.limit,sent:limit.sent,lifts_at:limit.lifts_at});}catch{}
          }
        }
        return limit;
      });
    },
    /** Counts one provider-accepted Send. The Run id is its idempotency key. */
    async record(org_id,run_id){
      if(!enabled)return false;if(!uuid(run_id))fail('EMAIL_SEND_LIMIT_INVALID');const key=keyFor(org_id),id=run_id.toLowerCase();
      return store.withLock({key},async tx=>{
        const at=now(),row=await tx.read(),state=current(row?.value,org_id,at);
        if(state.sends.some(([counted])=>counted===id))return false;
        if(!await tx.compareAndSwap({expected_revision:row?.revision??null,value:{schema_version:'email.send_cap.v1',org_id:org_id.toLowerCase(),sends:[...state.sends,[id,at]],notified_until:state.notified_until}}))fail('EMAIL_RUNTIME_CONFLICT');
        return true;
      });
    },
    async usage(org_id){
      const at=now(),row=enabled?await store.withLock({key:keyFor(org_id)},tx=>tx.read()):null,state=current(row?.value,org_id,at);
      return {hour:state.sends.filter(([,time])=>time>at-HOUR).length,day:state.sends.length};
    }
  });
}
