import {fail} from './contract.mjs';

const copy=source=>({...source,mime_bytes:Buffer.from(source.mime_bytes)});
/** Immutable source data only; every consumer supplies fresh current-authority
 * and source-existence checks. A settled grant/token never enters this cache. */
export function createSourceSnapshotCache({now=Date.now,maxEntries=8,maxBytes=32*1024*1024,ttl_ms=300000}={}){
 if(!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>32||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>64*1024*1024||!Number.isSafeInteger(ttl_ms)||ttl_ms<1||ttl_ms>300000)fail('EMAIL_DATA_CACHE_INVALID');
 const entries=new Map(),pending=new Map();let bytes=0,closed=false,api;
 const remove=key=>{const row=entries.get(key);if(row){entries.delete(key);bytes-=row.source.mime_bytes.length;row.source.mime_bytes.fill(0);}};
 const prune=()=>{for(const [key,row]of entries)if(row.expires_at<=now())remove(key);};
 const store=(key,source)=>{if(closed||source.mime_bytes.length>maxBytes)return;remove(key);while(entries.size>=maxEntries||bytes+source.mime_bytes.length>maxBytes)remove(entries.keys().next().value);const owned=copy(source);entries.set(key,{source:owned,expires_at:now()+ttl_ms});bytes+=owned.mime_bytes.length;};
 const wait=async(work,signal)=>{let abort;const cancelled=new Promise((_,reject)=>{abort=()=>reject(signal.reason);if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});});try{return await Promise.race([work,cancelled]);}finally{signal?.removeEventListener('abort',abort);}};
 return api=Object.freeze({
  async read({key,load,validateHit,check,signal}){
   signal?.throwIfAborted();await check();if(closed||!(/^[a-f0-9]{64}$/u.test(key)))fail('EMAIL_DATA_CACHE_INVALID');prune();
   const hit=entries.get(key);let result;
   try{
    if(hit){result=copy(hit.source);await validateHit();}
    else{
     let row=pending.get(key),owner=false;
     if(!row&&pending.size>=maxEntries)result=await load();
     else{
      if(!row){owner=true;row={users:0,done:false,signal};pending.set(key,row);row.work=(async()=>{try{const source=await load();row.source=source;await check();signal?.throwIfAborted();store(key,source);return source;}finally{row.done=true;if(pending.get(key)===row)pending.delete(key);if(!row.users)row.source?.mime_bytes.fill(0);}})();row.work.catch(()=>{});}
      row.users++;
      try{let source;try{source=await wait(row.work,signal);}catch(error){if(!owner&&row.signal?.aborted&&!signal?.aborted)return api.read({key,load,validateHit,check,signal});throw error;}signal?.throwIfAborted();result=copy(source);if(!owner)await validateHit();}
      finally{row.users--;if(row.done&&!row.users)row.source?.mime_bytes.fill(0);}
     }
    }
    await check();signal?.throwIfAborted();if(closed)fail('EMAIL_DATA_CACHE_INVALID');return result;
   }catch(error){result?.mime_bytes.fill(0);remove(key);throw error;}
  },
  invalidate(){for(const key of entries.keys())remove(key);},
  close(){closed=true;for(const key of entries.keys())remove(key);},
  get size(){prune();return entries.size;},get bytes(){prune();return bytes;}
 });
}
