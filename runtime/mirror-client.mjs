import {createAuthorityClient,trustedUrl} from './http.mjs';import {fail} from './contract.mjs';
export function createMirrorClient({channel_url,authority_token,fetch,allow_loopback_fixture=false}){
 const url=trustedUrl(channel_url,allow_loopback_fixture);if(new URL(url).pathname!=='/api/app-data/runtime/record-mirrors')fail('EMAIL_MIRROR_CHANNEL_INVALID');const call=createAuthorityClient({authority_url:url,authority_token,fetch,allow_loopback_fixture});
 // Only original status denial may be isolated to its record. Whole-channel,
 // malformed response and transport failures keep their existing failure path.
 const statusCall=createAuthorityClient({authority_url:url,authority_token,allow_loopback_fixture,fetch:async(...args)=>{const response=await (fetch??globalThis.fetch)(...args);if(response.status===403||response.status===410){await response.body?.cancel();fail('EMAIL_MIRROR_ORIGINAL_STATUS_DENIED');}return response;}});
 return Object.freeze({cleanupSource:(scope,receipt_id,input,signal)=>call({scope,operation:'cleanup_source',receipt_id,input},signal),poll:(scope,signal)=>call({scope,operation:'poll',store_key:'drafts',mirror_key:'provider_drafts'},signal),check:(scope,receipt_id,signal)=>call({scope,operation:'check',receipt_id},signal),submit:(scope,request_id,input,signal)=>call({scope,operation:'submit',request_id,input},signal),status:(scope,receipt_id,request_id,signal)=>statusCall({scope,operation:'status',receipt_id,request_id},signal)});
}
