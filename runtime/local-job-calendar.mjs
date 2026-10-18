import {exact,fail} from './contract.mjs';
/** Behavior port of frozen email-outbox-schedule.ts; saved instants are never
 * recomputed after restart. No host calendar or provider authority is involved. */
export function resolveLocalJobCalendar(input,now=Date.now()){
 exact(input,['wall_time','zone','ambiguity']);
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(input.wall_time??'')||typeof input.zone!=='string'||input.zone.length<1||input.zone.length>128||!['reject','earlier','later'].includes(input.ambiguity))fail('EMAIL_LOCAL_JOB_TIME_INVALID');
 const [year,month,day,hour,minute]=input.wall_time.match(/\d+/gu).map(Number),wall=Date.UTC(year,month-1,day,hour,minute);
 if(new Date(wall).toISOString().slice(0,16)!==input.wall_time||!Number.isFinite(now)||wall<now-3*86400000||wall>now+2*366*86400000)fail('EMAIL_LOCAL_JOB_TIME_INVALID');
 let format;try{format=new Intl.DateTimeFormat('en-CA',{timeZone:input.zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});}catch{fail('EMAIL_LOCAL_JOB_TIME_INVALID');}
 const local=instant=>{const p=Object.fromEntries(format.formatToParts(new Date(instant)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;},offsets=new Set();
 for(let delta=-48;delta<=48;delta+=6){const instant=wall+delta*3600000,p=local(instant).match(/\d+/gu).map(Number);offsets.add(Date.UTC(p[0],p[1]-1,p[2],p[3],p[4])-instant);}
 const candidates=[...offsets].map(offset=>wall-offset).filter(instant=>local(instant)===input.wall_time).sort((a,b)=>a-b);
 if(!candidates.length)fail('EMAIL_LOCAL_JOB_TIME_GAP');if(candidates.length>1&&input.ambiguity==='reject')fail('EMAIL_LOCAL_JOB_TIME_AMBIGUOUS');
 const instant=input.ambiguity==='later'?candidates.at(-1):candidates[0];if(instant<now)fail('EMAIL_LOCAL_JOB_TIME_PAST');
 return {...input,zone:format.resolvedOptions().timeZone,instant:new Date(instant).toISOString(),rules_version:`node-tz:${process.versions.tz??'unavailable'};icu:${process.versions.icu??'unavailable'}`};
}
