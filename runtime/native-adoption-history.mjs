import {createNativeHistoryIndex} from './native-history-index.mjs';
import {createHash} from 'node:crypto';
import {canonical,digest,exact,fail} from './contract.mjs';
import {nativeScope,writeNativeImportRow} from './native-adoption-records.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const key=(scope,id)=>'email.data.file.'+digest([nativeScope(scope),'native-history',id]);
export function nativeHistoryRecord(scope,input){
 scope=nativeScope(scope);exact(input,['kind','id','revision','state','value','mime']);
 if(!['send','outbox','outbox_event','triage','draft_sync','graph_send','sent_copy','folder','timer','rule_receipt','native_provenance'].includes(input.kind)||typeof input.id!=='string'||!input.id||input.id.length>256||!Number.isSafeInteger(input.revision)||input.revision<0||typeof input.state!=='string'||input.state.length>64||input.value===undefined||Buffer.byteLength(JSON.stringify(input.value))>1024*1024)fail('EMAIL_NATIVE_IMPORT_HISTORY_INVALID');
 let mime=null;if(input.mime!==null){exact(input.mime,['bytes','sha256']);if(!(input.mime.bytes instanceof Uint8Array)||input.mime.bytes.length>35*1024*1024||sha(input.mime.bytes)!==input.mime.sha256)fail('EMAIL_NATIVE_IMPORT_MIME_INVALID');mime={bytes:Buffer.from(input.mime.bytes).toString('base64url'),sha256:input.mime.sha256};}
 return {schema_version:'email.native_history.v1',scope,kind:input.kind,id:input.id,revision:input.revision,state:input.state,value:structuredClone(input.value),mime,effect_policy:'inspect_only'};
}
export function createNativeHistoryStore({store}){return Object.freeze({
 async buildIndex(scope,rows,check){return createNativeHistoryIndex({store}).build(scope,rows,check);},
 async listIndex(scope,input,check){return createNativeHistoryIndex({store}).list(scope,input,check);},
 async import(scope,input,check){const row=nativeHistoryRecord(scope,input);await writeNativeImportRow(store,key(scope,row.kind+':'+row.id+':'+row.revision),row,check);return digest(row);},
 async read(scope,{kind,id,revision},check){await check();const row=(await store.withLock({key:key(scope,kind+':'+id+':'+revision)},tx=>tx.read()))?.value;if(!row||canonical(row.scope)!==canonical(nativeScope(scope))||row.kind!==kind||row.id!==id||row.revision!==revision||row.effect_policy!=='inspect_only')fail('EMAIL_NATIVE_HISTORY_DENIED');const result=structuredClone(row);if(result.mime){result.mime.bytes=Buffer.from(result.mime.bytes,'base64url');if(sha(result.mime.bytes)!==result.mime.sha256)fail('EMAIL_NATIVE_IMPORT_MIME_INVALID');}await check();return result;},
});}
