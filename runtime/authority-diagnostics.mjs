const routes=new Set(['data','connection','resource','integration','other']);
const outcomes=new Set(['completed','denied','failed']);
const rounded=value=>Math.round(value*100)/100;
const metrics=values=>{
 if(!values.length)return {p50:null,p95:null,max:null,total:0};
 const sorted=[...values].sort((a,b)=>a-b),at=q=>sorted[Math.ceil(sorted.length*q)-1];
 return {p50:at(0.5),p95:at(0.95),max:sorted.at(-1),total:rounded(values.reduce((total,value)=>total+value,0))};
};
/** Exact, non-overlapping batches of at most64 actual transport callbacks per
 * closed route category. Only successful callbacks contribute latency targets;
 * denials/failures have separate counts. No body, URL, token, org or request pin
 * is retained. Quiet partial batches flush on that route's next callback after
 *60seconds. There is no timer, unbounded sample list, or per-callback default log. */
export function createAuthorityTimingReporter({clock=()=>performance.now(),emit=event=>console.info(JSON.stringify(event))}={}){
 const buckets=new Map([...routes].map(route=>[route,{started:clock(),samples:[]}]));
 return sample=>{
  try{
   const route=routes.has(sample.route)?sample.route:'other',outcome=outcomes.has(sample.outcome)?sample.outcome:'failed';
   const clean={outcome,dispatched:sample.dispatched===true};
   for(const field of ['elapsed_ms','queue_ms','http_ms']){
    const value=sample[field];if(!Number.isFinite(value)||value<0)return;clean[field]=rounded(value);
   }
   const bucket=buckets.get(route);bucket.samples.push(clean);
   if(bucket.samples.length<64&&clock()-bucket.started<60000)return;
   const samples=bucket.samples,completed=samples.filter(value=>value.outcome==='completed');
   bucket.samples=[];bucket.started=clock();
   const event={event:'email_authority_timing_summary',route,calls:samples.length,dispatched:samples.filter(value=>value.dispatched).length,completed:completed.length,
    denied:samples.filter(value=>value.outcome==='denied').length,failed:samples.filter(value=>value.outcome==='failed').length,
    completed_under_150_ms:completed.filter(value=>value.elapsed_ms<150).length,
    elapsed_ms:metrics(completed.map(value=>value.elapsed_ms)),queue_ms:metrics(completed.map(value=>value.queue_ms)),
    http_ms:metrics(completed.map(value=>value.http_ms))};
   const emitted=emit(event);if(emitted&&typeof emitted.then==='function')void Promise.resolve(emitted).catch(()=>{});
  }catch{/* Diagnostics cannot change callback admission or its outcome. */}
 };
}
export function authorityTimingRoute(path){
 return path==='/api/app-data/runtime/authority'?'data'
  :path.startsWith('/api/app-connection-sessions/runtime/')?'connection'
  :path.startsWith('/api/app-resource-')?'resource'
  :path.startsWith('/api/app-integration-')?'integration':'other';
}
export const reportAuthorityTiming=createAuthorityTimingReporter();
/** Public Kit authority clients own their HTTP body validation. Time that whole
 * client method without replacing its transport, retries, deadline or guards. */
export async function measureAuthorityTiming({route,queue_ms=0,onTiming},work){
 const began=performance.now();let outcome='failed',dispatched=false;
 try{const result=await work();dispatched=true;outcome=result?.allowed===false?'denied':'completed';return result;}
 catch(error){dispatched=Number.isInteger(error?.status)&&error.status>0;if(error?.status===401||error?.status===403||error?.code==='EMAIL_RUNTIME_AUTHORITY_DENIED')outcome='denied';throw error;}
 finally{
  const http_ms=rounded(Math.max(0,performance.now()-began));
  const sample={event:'email_authority_timing',route,outcome,dispatched,elapsed_ms:rounded(queue_ms+http_ms),queue_ms:rounded(queue_ms),http_ms};
  try{const emitted=onTiming?onTiming(sample):reportAuthorityTiming(sample);if(emitted&&typeof emitted.then==='function')void Promise.resolve(emitted).catch(()=>{});}catch{}
 }
}
