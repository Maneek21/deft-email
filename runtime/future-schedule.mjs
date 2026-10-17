import {exact,fail,digest} from './contract.mjs';
import {EMAIL_FUTURE_SEND_POLICY as policy} from './future-record-action-policy.mjs';
export function prepareFutureRecordAction(window,deadline,now){
 exact(window,['undo_delay_seconds','schedule','dispatch_expires_at']);
 if(!Number.isInteger(window.undo_delay_seconds)||window.undo_delay_seconds<0||window.undo_delay_seconds>policy.max_undo_delay_seconds
 ||Date.parse(window.dispatch_expires_at)!==deadline||deadline<=now||deadline>now+(policy.max_schedule_horizon_seconds+420)*1000
 ||window.schedule===null&&window.undo_delay_seconds===0)fail('EMAIL_FUTURE_WINDOW_INVALID');
 let schedule=null;
 if(window.schedule!==null){
  const input=window.schedule;exact(input,['wall_time','zone','ambiguity','missed_policy']);
  if(typeof input.wall_time!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(input.wall_time)
  ||typeof input.zone!=='string'||input.zone.length<1||input.zone.length>128||!['earlier','later','reject'].includes(input.ambiguity)
  ||!policy.missed_policies.includes(input.missed_policy))fail('EMAIL_FUTURE_WINDOW_INVALID');
  const p=input.wall_time.match(/\d+/gu).map(Number),wall=Date.UTC(p[0],p[1]-1,p[2],p[3],p[4]);
  if(new Date(wall).toISOString().slice(0,16)!==input.wall_time)fail('EMAIL_FUTURE_WINDOW_INVALID');
  let format;try{format=new Intl.DateTimeFormat('en-CA',{timeZone:input.zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});}catch{fail('EMAIL_FUTURE_WINDOW_INVALID');}
  const local=ms=>{const p=Object.fromEntries(format.formatToParts(new Date(ms)).filter(v=>v.type!=='literal').map(v=>[v.type,v.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;};
  const offsets=new Set();for(let hours=-48;hours<=48;hours+=6){const ms=wall+hours*3600000,p=local(ms).match(/\d+/gu).map(Number);offsets.add(Date.UTC(p[0],p[1]-1,p[2],p[3],p[4])-ms);}
  const candidates=[...offsets].map(offset=>wall-offset).filter(ms=>local(ms)===input.wall_time).sort((a,b)=>a-b);
  if(!candidates.length)fail('EMAIL_FUTURE_SCHEDULE_GAP');if(candidates.length>1&&input.ambiguity==='reject')fail('EMAIL_FUTURE_SCHEDULE_AMBIGUOUS');
  const instant=input.ambiguity==='later'?candidates.at(-1):candidates[0];
  if(instant<=now||instant>=deadline||instant>now+policy.max_schedule_horizon_seconds*1000)fail('EMAIL_FUTURE_WINDOW_INVALID');
  schedule={...input,zone:format.resolvedOptions().timeZone,instant:new Date(instant).toISOString(),rules_version:`node-tz:${process.versions.tz??'unavailable'};icu:${process.versions.icu??'unavailable'}`};
 }
 return {schema_version:'deft.app_prepared_future_release.v1',policy_digest:'sha256:'+digest(policy),execution_window:structuredClone(window),schedule,
 authority_expires_at:new Date(deadline).toISOString(),max_dispatch_lifetime_seconds:policy.max_dispatch_lifetime_seconds};
}
