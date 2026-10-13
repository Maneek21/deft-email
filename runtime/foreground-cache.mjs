import {canonical,digest,fail} from './contract.mjs';

const partition=scope=>digest([scope.org_id,scope.owner_user_id,scope.account_id]);
/** Data only. Entries never contain a settled authority decision, token or bytes.
 * A hit is usable only after the caller's fresh custody/host and durable row
 * checks. Expiration never moves on access; process restart is always a miss. */
export function createForegroundCache({now=Date.now,maxEntries=64,maxBytes=32*1024*1024,ttl_ms=60000}={}){
 if(!Number.isSafeInteger(maxEntries)||maxEntries<1||!Number.isSafeInteger(maxBytes)||maxBytes<1||!Number.isSafeInteger(ttl_ms)||ttl_ms<1||ttl_ms>60000)fail('EMAIL_DATA_CACHE_INVALID');
 const entries=new Map();let bytes=0;
 const remove=key=>{const row=entries.get(key);if(row){bytes-=row.size;entries.delete(key);}};
 const prune=()=>{for(const [key,row] of entries)if(row.expires_at<=now()||row.observed_at>now())remove(key);};
 return Object.freeze({
  key(request,{client_fingerprint,custody_generation}){return digest({scope:request.scope,connection:request.connection,authority:request.authority,client_fingerprint,custody_generation,operation:request.operation,input:request.input});},
  get(key,stamp){prune();const row=entries.get(key);if(!row||canonical(row.stamp)!==canonical(stamp)){remove(key);return null;}entries.delete(key);entries.set(key,row);return structuredClone(row.value);},
  set(key,scope,stamp,value,observed_at=now()){prune();remove(key);const size=Buffer.byteLength(JSON.stringify(value));if(size>2*1024*1024||size>maxBytes)return;const row={partition:partition(scope),stamp:structuredClone(stamp),value:structuredClone(value),size,observed_at,expires_at:Math.min(now(),observed_at)+ttl_ms};entries.set(key,row);bytes+=size;while(entries.size>maxEntries||bytes>maxBytes)remove(entries.keys().next().value);},
  invalidate(scope){const selected=partition(scope);for(const [key,row]of entries)if(row.partition===selected)remove(key);},
 });
}
