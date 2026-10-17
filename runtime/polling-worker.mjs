import {setTimeout as delay} from 'node:timers/promises';
/** Only a claim result resets the delay. Empty claims and transport errors
 * reduce idle traffic; this loop never retries an action start or effect. */
export async function runPollingWorker(runner,{signal,waitMs,maxWaitMs=waitMs,wait=delay}){
 let nextWait=waitMs;
 while(!signal.aborted){
  let worked=false;
  try{const result=await runner.runOnce(signal);worked=result!==null&&result!==undefined;}catch{}
  if(signal.aborted)break;
  if(worked)nextWait=waitMs;
  try{await wait(nextWait,undefined,{signal});}catch{}
  if(!worked)nextWait=Math.min(maxWaitMs,nextWait*2);
 }
}
