import {parseNativeSafeComposeHtml} from './domain/safe-compose-html.mjs';
import {canonical,digest,exact,fail} from './contract.mjs';
import {uuid} from './draft-store.mjs';
import {writeNativeImportRow} from './native-adoption-records.mjs';

export const SETTINGS_STORES=Object.freeze(['templates','signatures','preferences','folder_preferences','smtp_preferences']);
export const SETTINGS_LIMITS=Object.freeze({preferences_bytes:8192,templates_bytes:491520,signatures_bytes:65536,signature_identities:32,index_records:1000});
const controls=/[\u0000-\u001f\u007f-\u009f]/u;
const plainControls=/[\u0000\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const signatureControls=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const normalized=address=>address.trim().toLocaleLowerCase('en-US');
const marker=/\{\{([A-Za-z][A-Za-z0-9_]{0,63})\}\}/gu;
function placeholderInTag(html){return [...html.matchAll(/<[^>]*>/gu)].some(match=>/\{\{[A-Za-z][A-Za-z0-9_]{0,63}\}\}/u.test(match[0].replace(/&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));|&(?:lbrace|lcub);/giu,(_all,hex,decimal)=>hex?String.fromCodePoint(Number.parseInt(hex,16)):decimal?String.fromCodePoint(Number.parseInt(decimal,10)):'{')));}
const positive=value=>Number.isSafeInteger(value)&&value>=1&&value<=2147483647;
const keyFor=(kind,scope,store_key,id='')=>'email.data.settings_'+kind+'.'+digest([scope.org_id,scope.owner_user_id,scope.account_id,store_key,id,...(store_key==='folder_preferences'?[scope.installation_id]:[])]);
export const settingsCollectionKey=(scope,store_key)=>keyFor('collection',scope,store_key);
const scopeFor=scope=>{exact(scope,['org_id','owner_user_id','account_id',...(Object.hasOwn(scope,'installation_id')?['installation_id']:[])]);if(Object.values(scope).some(value=>typeof value!=='string'||!value.length||value.length>256||controls.test(value)))fail('EMAIL_SETTINGS_ACCESS_DENIED');return structuredClone(scope);};
const storeFor=key=>{if(!SETTINGS_STORES.includes(key))fail('EMAIL_SETTINGS_INVALID');return key;};
export function validateSettingValue(store_key,raw){
  storeFor(store_key);
  if(store_key==='templates'){
    exact(raw,['title','subject','body','body_html']);
    if(typeof raw.title!=='string'||!raw.title.trim()||raw.title.length>120||controls.test(raw.title)||typeof raw.subject!=='string'||raw.subject.length>998||controls.test(raw.subject)||/[\u2028\u2029]/u.test(raw.subject)||typeof raw.body!=='string'||raw.body.length>262144||plainControls.test(raw.body)||typeof raw.body_html!=='string'||raw.body_html.length>262144)fail('EMAIL_SETTINGS_INVALID');
    // Preserve exact title/text. Native placeholder grammar and HTML/plain
    // parity are reused without importing a native HTTP client or host module.
    const placeholders=new Set();for(const text of [raw.subject,raw.body,raw.body_html]){
      const remainder=text.replace(marker,'');if(remainder.includes('{{')||remainder.includes('}}'))fail('EMAIL_SETTINGS_INVALID');
      for(const match of text.matchAll(marker))placeholders.add(match[1]);
      if([...text.matchAll(/\b(?:https?:\/\/|mailto:|www\.)[^\s<>]*/giu)].some(match=>match[0].includes('{{')||match[0].includes('}}')))fail('EMAIL_SETTINGS_INVALID');
    }
    if(placeholders.size>64||Buffer.byteLength(JSON.stringify(raw))>SETTINGS_LIMITS.templates_bytes)fail('EMAIL_SETTINGS_LIMIT');
    try{if(placeholderInTag(raw.body_html))fail('EMAIL_SETTINGS_INVALID');}catch{fail('EMAIL_SETTINGS_INVALID');}
    if(raw.body_html){try{if(parseNativeSafeComposeHtml(raw.body_html,{maxCharacters:262144,maxBytes:491520}).plainText!==raw.body)fail('EMAIL_SETTINGS_INVALID');}catch{fail('EMAIL_SETTINGS_INVALID');}}
  }else if(store_key==='folder_preferences'){
    exact(raw,['folder_record_id','favorite','color']);if(!uuid(raw.folder_record_id)||typeof raw.favorite!=='boolean'||!(raw.color===null||typeof raw.color==='string'&&/^#[a-f0-9]{6}$/iu.test(raw.color)))fail('EMAIL_SETTINGS_INVALID');
  }else if(store_key==='smtp_preferences'){
    exact(raw,['sent_copy_mode']);if(!['server_managed','append_exact'].includes(raw.sent_copy_mode))fail('EMAIL_SETTINGS_INVALID');
  }else if(store_key==='preferences'){
    exact(raw,['external_images']);if(!['ask','always'].includes(raw.external_images)||Buffer.byteLength(JSON.stringify(raw))>8192)fail('EMAIL_SETTINGS_INVALID');
  }else{
    exact(raw,['address','plain','html','placement',...(Object.hasOwn(raw,'automatic')?['automatic']:[])]);
    if(Object.hasOwn(raw,'automatic')){exact(raw.automatic,['schema_version','enabled']);if(raw.automatic.schema_version!=='deft.signature_automatic.v1'||typeof raw.automatic.enabled!=='boolean')fail('EMAIL_SETTINGS_INVALID');}
    if(typeof raw.address!=='string'||raw.address.length>320||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(raw.address)||controls.test(raw.address)||typeof raw.plain!=='string'||raw.plain.length>2048||signatureControls.test(raw.plain)||typeof raw.html!=='string'||raw.html.length>16384||!['new','reply','both','none'].includes(raw.placement)||Buffer.byteLength(JSON.stringify(raw))>65536)fail('EMAIL_SETTINGS_INVALID');
    if(raw.html){try{if(!raw.plain||parseNativeSafeComposeHtml(raw.html,{maxCharacters:16384,maxBytes:65536}).plainText!==raw.plain)fail('EMAIL_SETTINGS_INVALID');}catch{fail('EMAIL_SETTINGS_INVALID');}}
  }
  return structuredClone(raw);
}
const view=record=>({schema_version:'deft.app_record.v1',store_key:record.store_key,record_id:record.record_id,revision:record.revision,content_revision:record.content_revision,content_digest:'sha256:'+record.content_digest,status:record.status,value:structuredClone(record.value),files:[],summary:record.store_key==='smtp_preferences'?{sent_copy_mode:record.value.sent_copy_mode}:record.store_key==='folder_preferences'?{folder_record_id:record.value.folder_record_id,favorite:record.value.favorite,color:record.value.color??''}:record.store_key==='preferences'?{external_images:record.value.external_images}:record.store_key==='templates'?{title:record.value.title,subject:record.value.subject}:{address:record.value.address,placement:record.value.placement},created_at:record.created_at,updated_at:record.updated_at});

/** Settings are app-owned rows sealed under the existing app-data AAD. One
 * account/store lock spans signature aggregate validation and record CAS.
 * Index-before-row holes are harmless; only published rows count in quotas.
 * Archived content and receipts survive; no action/marker migration is implied. */
export function createSettingsStore({store,now=Date.now}){
  const readRow=(scope,key,id)=>store.withLock({key:keyFor('record',scope,key,id)},tx=>tx.read());
  const checked=(row,scope,key,id)=>{if(!row)return null;const record=row.value;if(record.schema_version!=='email.app_setting.v1'||canonical(record.scope)!==canonical(scope)||record.store_key!==key||record.record_id!==id||!positive(record.revision)||!positive(record.content_revision)||record.content_digest!==digest(record.value)||!['draft','archived'].includes(record.status))fail('EMAIL_SETTINGS_ACCESS_DENIED');validateSettingValue(key,record.value);return record;};
  async function indexIds(scope,key){const row=await store.withLock({key:keyFor('index',scope,key)},tx=>tx.read());if(!row)return [];if(canonical(row.value.scope)!==canonical(scope)||row.value.store_key!==key||!Array.isArray(row.value.ids)||row.value.ids.length>1000||new Set(row.value.ids).size!==row.value.ids.length||row.value.ids.some(id=>!uuid(id)))fail('EMAIL_SETTINGS_ACCESS_DENIED');return row.value.ids;}
  async function signatureQuota(scope,key,ids,candidate){
    if(key==='folder_preferences'){const active=[];for(const id of ids){const row=id===candidate.record_id?candidate:checked(await readRow(scope,key,id),scope,key,id);if(row?.status==='draft')active.push(row.value.folder_record_id);}if(new Set(active).size!==active.length)fail('EMAIL_SETTINGS_CONFLICT');return;}
    if(key==='preferences'||key==='smtp_preferences'){let active=0;for(const id of ids){const row=id===candidate.record_id?candidate:checked(await readRow(scope,key,id),scope,key,id);if(row?.status==='draft')active++;}if(active>1)fail('EMAIL_SETTINGS_LIMIT');return;}
    if(key!=='signatures')return;
    const values=[];for(const id of ids){const record=id===candidate.record_id?candidate:checked(await readRow(scope,key,id),scope,key,id);if(record&&record.status==='draft')values.push(validateSettingValue(key,record.value));}
    if(values.length>32||new Set(values.map(value=>normalized(value.address))).size!==values.length||Buffer.byteLength(JSON.stringify({identities:values}))>65536)fail('EMAIL_SETTINGS_LIMIT');
  }
  async function mutate(rawScope,key,id,{request_id,user_id,check,identities,expected_revision,expected_content_digest,public_input_digest=null},input,work){
    const scope=scopeFor(rawScope);storeFor(key);if(key==='folder_preferences'&&!uuid(scope.installation_id))fail('EMAIL_SETTINGS_ACCESS_DENIED');if(!uuid(id)||!uuid(request_id)||user_id!==scope.owner_user_id||typeof check!=='function')fail('EMAIL_SETTINGS_ACCESS_DENIED');
    const input_digest=digest(input);
    return store.withLock({key:keyFor('collection',scope,key)},async()=>{
      await check();let ids=await indexIds(scope,key);
      return store.withLock({key:keyFor('record',scope,key,id)},async tx=>{
        const row=await tx.read(),record=checked(row,scope,key,id),receipt=record?.receipts.find(value=>value.request_id===request_id);
        if(receipt){if(receipt.input_digest!==input_digest)fail('EMAIL_SETTINGS_CONFLICT');await check();return view(record);}
        if(record&&(!positive(expected_revision)||record.revision!==expected_revision||expected_content_digest!=='sha256:'+record.content_digest))fail('EMAIL_SETTINGS_CONFLICT');
        const next=work(record),value=validateSettingValue(key,next.value);
        if(key==='signatures'&&next.status!=='archived'){
          if(!Array.isArray(identities)||!identities.some(identity=>typeof identity.address==='string'&&normalized(identity.address)===normalized(value.address)))fail('EMAIL_SETTINGS_IDENTITY_DENIED');
          if(record&&record.value.address!==value.address)fail('EMAIL_SETTINGS_IDENTITY_DENIED');
        }
        next.value=value;next.content_digest=digest(value);
        if(!ids.includes(id)){if(ids.length>=1000)fail('EMAIL_SETTINGS_LIMIT');const proposed=[...ids,id];await store.withLock({key:keyFor('index',scope,key)},async indexTx=>{await check();const indexRow=await indexTx.read();if(!await indexTx.compareAndSwap({expected_revision:indexRow?.revision??null,value:{scope,store_key:key,ids:proposed}}))fail('EMAIL_SETTINGS_CONFLICT');});ids=proposed;}
        await signatureQuota(scope,key,ids,next);await check();next.receipts=[...(record?.receipts??[]),{request_id,input_digest,public_input_digest,revision:next.revision,content_digest:next.content_digest}].slice(-64);
        if(!await tx.compareAndSwap({expected_revision:row?.revision??null,value:next}))fail('EMAIL_SETTINGS_CONFLICT');await check();return view(next);
      });
    });
  }
  return Object.freeze({
    async importNative(rawScope,projections,check){const scope=scopeFor(rawScope);for(const projection of projections){const {store_key:key,record_id:id,...fields}=projection;storeFor(key);if(!['templates','signatures'].includes(key)||!uuid(id)||typeof check!=='function')fail('EMAIL_NATIVE_SETTING_INVALID');const value=validateSettingValue(key,fields.value),record={schema_version:'email.app_setting.v1',scope,store_key:key,record_id:id,...fields,value,content_digest:digest(value),created_by_user_id:null,last_edited_by_user_id:null,receipts:[]};await store.withLock({key:keyFor('collection',scope,key)},async()=>{await check();const ids=await indexIds(scope,key);if(ids.length>=1000&&!ids.includes(id))fail('EMAIL_SETTINGS_LIMIT');const next=ids.includes(id)?ids:[...ids,id];await signatureQuota(scope,key,next,record);await writeNativeImportRow(store,keyFor('record',scope,key,id),record,check);await store.withLock({key:keyFor('index',scope,key)},async tx=>{await check();const prior=await tx.read();if(canonical(prior?.value??null)===canonical({scope,store_key:key,ids:next}))return;if(!await tx.compareAndSwap({expected_revision:prior?.revision??null,value:{scope,store_key:key,ids:next}}))fail('EMAIL_NATIVE_IMPORT_CONFLICT');});});}},
    async create(scope,key,id,value,options){value=validateSettingValue(key,value);if(key==='smtp_preferences'&&value.sent_copy_mode!=='server_managed'||key==='preferences'&&value.external_images!=='ask'||key==='signatures'&&value.automatic?.enabled===true)fail('EMAIL_SETTINGS_CREATE_DENIED');return mutate(scope,key,id,options,{operation:'create',store_key:key,record_id:id,value},record=>{if(record)fail('EMAIL_SETTINGS_CONFLICT');const at=new Date(now()).toISOString();return {schema_version:'email.app_setting.v1',scope:scopeFor(scope),store_key:key,record_id:id,revision:1,content_revision:1,status:'draft',value,created_at:at,updated_at:at,created_by_user_id:options.user_id,last_edited_by_user_id:options.user_id,receipts:[]};});},
    async save(scope,key,id,value,options){value=validateSettingValue(key,value);return mutate(scope,key,id,options,{operation:'save',store_key:key,record_id:id,expected_revision:options.expected_revision,expected_content_digest:options.expected_content_digest,value},record=>{if(!record)fail('EMAIL_SETTINGS_NOT_FOUND');if(record.status!=='draft'||record.revision>=2147483647)fail('EMAIL_SETTINGS_CONFLICT');return {...record,value,revision:record.revision+1,content_revision:record.content_revision+1,last_edited_by_user_id:options.user_id,updated_at:new Date(now()).toISOString()};});},
    async archive(scope,key,id,options){if(key==='smtp_preferences')fail('EMAIL_SETTINGS_ARCHIVE_DENIED');return mutate(scope,key,id,options,{operation:'archive',store_key:key,record_id:id,expected_revision:options.expected_revision,expected_content_digest:options.expected_content_digest},record=>{if(!record)fail('EMAIL_SETTINGS_NOT_FOUND');if(record.status!=='draft'||record.revision>=2147483647)fail('EMAIL_SETTINGS_CONFLICT');return {...record,status:'archived',revision:record.revision+1,updated_at:new Date(now()).toISOString()};});},
    async read(rawScope,key,id,check){const scope=scopeFor(rawScope);storeFor(key);if(key==='folder_preferences'&&!uuid(scope.installation_id))fail('EMAIL_SETTINGS_ACCESS_DENIED');if(!uuid(id))fail('EMAIL_SETTINGS_INVALID');await check();const record=checked(await readRow(scope,key,id),scope,key,id);if(!record)fail('EMAIL_SETTINGS_NOT_FOUND');await check();return view(record);},
    async list(rawScope,key,{cursor,limit},check){const scope=scopeFor(rawScope);storeFor(key);if(key==='folder_preferences'&&!uuid(scope.installation_id))fail('EMAIL_SETTINGS_ACCESS_DENIED');if(!Number.isInteger(limit)||limit<1||limit>25||cursor!==null&&!uuid(cursor))fail('EMAIL_SETTINGS_INVALID');return store.withLock({key:keyFor('collection',scope,key)},async()=>{await check();const ids=await indexIds(scope,key),start=cursor===null?0:ids.indexOf(cursor)+1;if(cursor!==null&&start===0)fail('EMAIL_SETTINGS_INVALID');let position=start;const items=[];for(;position<ids.length&&items.length<limit;position++){const record=checked(await readRow(scope,key,ids[position]),scope,key,ids[position]);if(record&&record.status!=='archived'){const {value,files,...meta}=view(record);items.push(meta);}}await check();return {items,next_cursor:position<ids.length?ids[position-1]:null};});},
    async receipt(rawScope,key,id,request_id,check){const scope=scopeFor(rawScope);storeFor(key);if(key==='folder_preferences'&&!uuid(scope.installation_id))fail('EMAIL_SETTINGS_ACCESS_DENIED');if(!uuid(id)||!uuid(request_id))fail('EMAIL_SETTINGS_INVALID');await check();const record=checked(await readRow(scope,key,id),scope,key,id),receipt=record?.receipts.find(value=>value.request_id===request_id);await check();return receipt?structuredClone(receipt):null;},
  });
}
