import {canonical,digest,exact,fail} from './contract.mjs';
import {uuid} from './draft-store.mjs';
import {validateRuleValue} from './rule-matcher.mjs';
import {writeNativeImportRow} from './native-adoption-records.mjs';
import {opaque} from './contract.mjs';

const positive=value=>Number.isSafeInteger(value)&&value>0&&value<=2147483646;
const hash=value=>typeof value==='string'&&/^sha256:[a-f0-9]{64}$/u.test(value);
function scopeFor(scope){exact(scope,['org_id','owner_user_id','account_id','installation_id']);if(!opaque(scope.account_id)||['org_id','owner_user_id','installation_id'].some(key=>!uuid(scope[key])))fail('EMAIL_RULE_ACCESS_DENIED');return structuredClone(scope);}
const key=(kind,scope,id='')=>'email.data.rule_'+kind+'.'+digest([scope,id]);
const view=record=>({schema_version:'deft.app_record.v1',store_key:'rules',record_id:record.record_id,revision:record.revision,content_revision:record.content_revision,content_digest:'sha256:'+digest(record.value),status:record.status,value:structuredClone(record.value),files:[],summary:{title:record.value.name,enabled:record.value.enabled},created_at:record.created_at,updated_at:record.updated_at});
const meta=record=>{const {value,files,...metadata}=view(record);return metadata;};
/** The existing encrypted app store owns all content. A per-account/install
 * collection lock serializes CAS and order. An index-before-row crash leaves a
 * harmless hole; next mutation prunes holes and archived IDs. Archived records
 * and mutation receipts remain directly addressable and are never deleted. */
export function createRuleStore({store,now=Date.now}){
  const readRow=(scope,id)=>store.withLock({key:key('record',scope,id)},tx=>tx.read());
  function checked(row,scope,id){if(!row)return null;const value=row.value;if(value.schema_version!=='email.app_rule.v1'||canonical(value.scope)!==canonical(scope)||value.record_id!==id||!positive(value.revision)||!positive(value.content_revision)||!['draft','archived'].includes(value.status)||!Array.isArray(value.receipts))fail('EMAIL_RULE_ACCESS_DENIED');validateRuleValue(value.value);return value;}
  async function index(scope){const row=await store.withLock({key:key('index',scope)},tx=>tx.read());if(!row)return {row:null,value:{schema_version:'email.app_rule_index.v1',scope,ids:[],receipts:[]}};const value=row.value;if(value.schema_version!=='email.app_rule_index.v1'||canonical(value.scope)!==canonical(scope)||!Array.isArray(value.ids)||value.ids.length>100||value.ids.some(id=>!uuid(id))||new Set(value.ids).size!==value.ids.length||!Array.isArray(value.receipts))fail('EMAIL_RULE_ACCESS_DENIED');return {row,value};}
  async function active(scope,entry,check=async()=>{}){const records=[];for(const id of entry.value.ids){await check();const record=checked(await readRow(scope,id),scope,id);await check();if(record?.status==='draft')records.push(record);}return records;}
  const stamp=records=>'sha256:'+digest(records.map(record=>[record.record_id,record.revision,record.status,digest(record.value)]));
  async function writeIndex(scope,entry,ids,receipt,check){await check();return store.withLock({key:key('index',scope)},async tx=>{const receipts=receipt?[...entry.value.receipts,receipt].slice(-64):entry.value.receipts;if(!await tx.compareAndSwap({expected_revision:entry.row?.revision??null,value:{...entry.value,ids,receipts,mutation_fence_version:1}}))fail('EMAIL_RULE_CONFLICT');});}
  function optionsFor(scope,options){if(!options||!uuid(options.request_id)||options.user_id!==scope.owner_user_id||typeof options.check!=='function'||options.public_input_digest!==undefined&&!hash(options.public_input_digest))fail('EMAIL_RULE_ACCESS_DENIED');return options;}
  async function mutate(rawScope,id,value,options,operation){
    const scope=scopeFor(rawScope);if(!uuid(id))fail('EMAIL_RULE_INVALID');optionsFor(scope,options);if(operation!=='archive')value=validateRuleValue(value);
    const input={operation,record_id:id,...(operation!=='archive'?{value}:{}),...(operation!=='create'?{expected_revision:options.expected_revision,expected_content_digest:options.expected_content_digest}:{})},input_digest=digest(input);
    return store.withLock({key:key('collection',scope)},async()=>{
      await options.check();const entry=await index(scope),records=await active(scope,entry);
      return store.withLock({key:key('record',scope,id)},async tx=>{
        const row=await tx.read(),record=checked(row,scope,id),receipt=record?.receipts.find(item=>item.request_id===options.request_id);
        if(receipt){if(receipt.input_digest!==input_digest)fail('EMAIL_RULE_CONFLICT');await options.check();return view(record);}
        if(operation==='create'){if(record)fail('EMAIL_RULE_CONFLICT');if(records.length>=100)fail('EMAIL_RULE_LIMIT');}
        else if(!record||record.status!=='draft'||record.revision!==options.expected_revision||'sha256:'+digest(record.value)!==options.expected_content_digest||record.revision>=2147483646)fail('EMAIL_RULE_CONFLICT');
        const at=new Date(now()).toISOString(),next=operation==='create'?{schema_version:'email.app_rule.v1',scope,record_id:id,revision:1,content_revision:1,status:'draft',value,created_at:at,updated_at:at,receipts:[]}:{...record,revision:record.revision+1,content_revision:record.content_revision+(operation==='archive'?0:1),status:operation==='archive'?'archived':'draft',value:operation==='archive'?record.value:value,updated_at:at};
        // Advance the durable collection fence before every row mutation. A crash
        // invalidates a captured snapshot conservatively; IDs are retained on
        // failed save/archive. The collection lock excludes concurrent readers.
        await writeIndex(scope,entry,operation==='create'?[...records.map(item=>item.record_id),id]:entry.value.ids,null,options.check);
        await options.check();next.receipts=[...(record?.receipts??[]),{request_id:options.request_id,input_digest,public_input_digest:options.public_input_digest??null,revision:next.revision,content_digest:'sha256:'+digest(next.value)}].slice(-64);
        if(!await tx.compareAndSwap({expected_revision:row?.revision??null,value:next}))fail('EMAIL_RULE_CONFLICT');await options.check();return view(next);
      });
    });
  }
  return Object.freeze({
    async importNative(rawScope,projections,check){const scope=scopeFor(rawScope);if(typeof check!=='function'||projections.length>100)fail('EMAIL_NATIVE_RULE_INVALID');await store.withLock({key:key('collection',scope)},async()=>{for(const projection of projections){const record={schema_version:'email.app_rule.v1',scope,...projection,receipts:[]};if(!uuid(record.record_id))fail('EMAIL_NATIVE_RULE_INVALID');validateRuleValue(record.value);await writeNativeImportRow(store,key('record',scope,record.record_id),record,check);}await writeNativeImportRow(store,key('index',scope),{schema_version:'email.app_rule_index.v1',scope,ids:projections.map(x=>x.record_id),receipts:[],mutation_fence_version:1},check);});},
    create:(scope,id,value,options)=>mutate(scope,id,value,options,'create'),
    save:(scope,id,value,options)=>mutate(scope,id,value,options,'save'),
    archive:(scope,id,options)=>mutate(scope,id,null,options,'archive'),
    async read(rawScope,id,check){const scope=scopeFor(rawScope);if(!uuid(id)||typeof check!=='function')fail('EMAIL_RULE_INVALID');await check();const record=checked(await readRow(scope,id),scope,id);if(!record)fail('EMAIL_RULE_NOT_FOUND');await check();return view(record);},
    async list(rawScope,{cursor=null,limit=25},check){const scope=scopeFor(rawScope);if(!Number.isSafeInteger(limit)||limit<1||limit>50||typeof check!=='function')fail('EMAIL_RULE_INVALID');return store.withLock({key:key('collection',scope)},async()=>{await check();const records=await active(scope,await index(scope),check),order_digest=stamp(records);let offset=0;if(cursor!==null){if(typeof cursor!=='string'||!/^rule_cursor:[a-f0-9]{64}:\d{1,3}$/u.test(cursor))fail('EMAIL_RULE_INVALID');const [,expected,index]=cursor.split(':');if('sha256:'+expected!==order_digest)fail('EMAIL_RULE_CONFLICT');offset=Number(index);if(offset<1||offset>=records.length)fail('EMAIL_RULE_INVALID');}const items=records.slice(offset,offset+limit).map(meta),end=offset+items.length;await check();return {items,next_cursor:end<records.length?'rule_cursor:'+order_digest.slice(7)+':'+end:null,order_digest};});},
    async snapshot(rawScope,check){const scope=scopeFor(rawScope);if(typeof check!=='function')fail('EMAIL_RULE_INVALID');return store.withLock({key:key('collection',scope)},async()=>{await check();const entry=await index(scope),records=await active(scope,entry,check);await check();return {records:records.map(view),order_digest:stamp(records),generation:entry.value.mutation_fence_version===1?entry.row.revision:null};});},
    async assertGeneration(rawScope,generation,check){const scope=scopeFor(rawScope);if(!positive(generation)||typeof check!=='function')fail('EMAIL_RULE_INVALID');return store.withLock({key:key('collection',scope)},async()=>{await check();const entry=await index(scope);if(entry.value.mutation_fence_version!==1||entry.row?.revision!==generation)fail('EMAIL_RULE_CONFLICT');await check();});},
    async active(rawScope,check){const scope=scopeFor(rawScope);return store.withLock({key:key('collection',scope)},async()=>{await check();const records=await active(scope,await index(scope),check);await check();return records.map(view);});},
    async reorder(rawScope,references,expected_order_digest,options){const scope=scopeFor(rawScope);optionsFor(scope,options);if(!hash(expected_order_digest)||!Array.isArray(references)||references.length<1||references.length>100||new Set(references.map(ref=>ref?.record_id)).size!==references.length)fail('EMAIL_RULE_INVALID');for(const ref of references){exact(ref,['record_id','expected_revision','expected_content_digest']);if(!uuid(ref.record_id)||!positive(ref.expected_revision)||!hash(ref.expected_content_digest))fail('EMAIL_RULE_INVALID');}const input_digest=digest({references,expected_order_digest});return store.withLock({key:key('collection',scope)},async()=>{await options.check();const entry=await index(scope),receipt=entry.value.receipts.find(value=>value.request_id===options.request_id);if(receipt){if(receipt.input_digest!==input_digest)fail('EMAIL_RULE_CONFLICT');await options.check();return structuredClone(receipt);}const records=await active(scope,entry);if(stamp(records)!==expected_order_digest||records.length!==references.length||references.some(ref=>!records.some(row=>row.record_id===ref.record_id&&row.revision===ref.expected_revision&&'sha256:'+digest(row.value)===ref.expected_content_digest)))fail('EMAIL_RULE_CONFLICT');const next=references.map(ref=>records.find(row=>row.record_id===ref.record_id)),result={request_id:options.request_id,input_digest,public_input_digest:options.public_input_digest??null,order_digest:stamp(next)};await writeIndex(scope,entry,next.map(row=>row.record_id),result,options.check);await options.check();return result;});},
    async receipt(rawScope,id,request_id,check){const scope=scopeFor(rawScope);if(!uuid(request_id)||id!==null&&!uuid(id))fail('EMAIL_RULE_INVALID');await check();const source=id===null?(await index(scope)).value:checked(await readRow(scope,id),scope,id);const receipt=source?.receipts.find(row=>row.request_id===request_id)??null;await check();return structuredClone(receipt);}
  });
}
