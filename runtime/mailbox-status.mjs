import {digest,canonical,fail} from './contract.mjs';
export const unreadInboxRow=row=>!!row&&!row.deleted&&row.flags?.seen===false&&Array.isArray(row.folders)&&row.folders.some(folder=>typeof folder==='string'&&folder.toLowerCase()==='inbox');
export function mailboxStatusId(scope){const hex=digest([scope,'mailbox_status','inbox']).slice(0,32);return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20)}`;}
export function mailboxStatusRecord(scope,value){
 const id=mailboxStatusId(scope),observed=value.observed_at??'1970-01-01T00:00:00.000Z';
 return {schema_version:'deft.app_record.v1',store_key:'mailbox_status',record_id:id,revision:1,content_revision:1,content_digest:'sha256:'+digest(value),status:'draft',value,files:[],summary:{count_ready:value.count_ready,coverage_complete:value.coverage==='complete',...(value.cached_unread_count===null?{}:{cached_unread_count:value.cached_unread_count}),...(value.unread_count===null?{}:{unread_count:value.unread_count}),observed_at:value.observed_at??'',scanned_records:value.scanned_records,total_cached_records:value.total_cached_records},created_at:observed,updated_at:observed};
}
/** Called under the existing mailbox index lock. Each chunk reads at most250
 * sealed rows; a completed generation needs no message-row reads. */
export async function readUnreadChunk({scope,index,hidden=[],progress,readRecord,saveProgress,check,limit=250}){
 if(!Array.isArray(hidden)||hidden.length>256||new Set(hidden).size!==hidden.length||!Number.isInteger(limit)||limit<1||limit>250)fail('EMAIL_DATA_INPUT_INVALID');
 const ids=index?.ids??[];if(ids.length>100000||index&&canonical(index.scope)!==canonical(scope))fail('EMAIL_DATA_AUTHORITY_DENIED');
 const generation=digest([scope,index?.content_generation??0,index?.checkpoint_generation??1,index?.coverage_generation??1,ids.length,hidden.slice().sort()]);
 let state=progress?.generation===generation?structuredClone(progress):{generation,position:0,count:0};
 if(!Number.isInteger(state.position)||state.position<0||state.position>ids.length||!Number.isInteger(state.count)||state.count<0||state.count>state.position)fail('EMAIL_DATA_RESOURCE_INVALID');
 const excluded=new Set(hidden),end=Math.min(ids.length,state.position+limit);
 for(;state.position<end;state.position++){await check();const row=await readRecord(ids[state.position]);if(!row||canonical(row.scope)!==canonical(scope)||row.record_id!==ids[state.position])fail('EMAIL_DATA_RESOURCE_INVALID');if(!excluded.has(row.record_id)&&unreadInboxRow(row))state.count++;}
 await check();if(!progress||canonical(progress)!==canonical(state))await saveProgress(state);
 const ready=state.position===ids.length,complete=index?.complete===true;
 return {folder:'inbox',count_ready:ready,cached_unread_count:ready?state.count:null,unread_count:ready&&complete?state.count:null,coverage:complete?'complete':'partial',content_generation:index?.content_generation??0,checkpoint_generation:index?.checkpoint_generation??1,coverage_generation:index?.coverage_generation??1,observed_at:index?.observed_at??null,scanned_records:state.position,total_cached_records:ids.length};
}
