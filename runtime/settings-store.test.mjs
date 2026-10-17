import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSettingsStore,validateSettingValue} from './settings-store.mjs';
import {canonical} from './contract.mjs';
const scope=()=>({org_id:randomUUID(),owner_user_id:randomUUID(),account_id:randomUUID()});
const template={title:'  Exact title  ',subject:'Different subject',body:'Line one\n\nLine two ',body_html:''};
const signature=address=>({address,plain:'Exact signature',html:'<p>Exact signature</p>',placement:'both'});
function memory(){const rows=new Map(),locks=new Map();return {rows,async withLock({key},work){const prior=locks.get(key)??Promise.resolve();let release;const current=new Promise(done=>release=done);locks.set(key,current);await prior;try{return await work({read:async()=>structuredClone(rows.get(key)??null),compareAndSwap:async({expected_revision,value})=>{const old=rows.get(key);if((old?.revision??null)!==expected_revision)return false;rows.set(key,{revision:(old?.revision??0)+1,value:structuredClone(value)});return true;}});}finally{release();if(locks.get(key)===current)locks.delete(key);}}};}
const opts=(s,identities=[],extra={})=>({request_id:randomUUID(),user_id:s.owner_user_id,identities:identities.map(address=>({address,label:address})),check:async()=>{},...extra});
const cas=row=>({expected_revision:row.revision,expected_content_digest:row.content_digest});
test('closed native template grammar preserves whitespace/title and denies placeholders in URLs and invalid rich pairs',()=>{
 assert.deepEqual(validateSettingValue('templates',template),template);
 for(const value of [{...template,title:' '},{...template,title:'a'.repeat(121)},{...template,body:'{{bad-key}}'},{...template,body:'https://example.test/{{id}}'},{...template,body_html:'<p>Other</p>'},{...template,unexpected:true}])assert.throws(()=>validateSettingValue('templates',value));
 assert.equal(validateSettingValue('templates',{...template,body:'{{name}}',body_html:'<p>{{name}}</p>'}).body,'{{name}}');
 assert.throws(()=>validateSettingValue('templates',{...template,body:'Visible',body_html:'<p><a href="https://example.test/&#123;&#123;id&#125;&#125;">Visible</a></p>'}));
 assert.throws(()=>validateSettingValue('preferences',{background:true}));
});
test('template CRUD CAS/archive/list/store+account isolation and exact repeated acknowledgement',async()=>{
 const s=scope(),store=memory(),settings=createSettingsStore({store}),id=randomUUID(),create=opts(s);const first=await settings.create(s,'templates',id,template,create);
 assert.deepEqual(await settings.create(s,'templates',id,template,create),first);assert.equal(first.value.title,template.title);assert.deepEqual(first.files,[]);
 const next=await settings.save(s,'templates',id,{...template,subject:'Updated'},opts(s,[],cas(first)));assert.equal(next.revision,2);assert.equal(next.content_revision,2);
 await assert.rejects(settings.save(s,'templates',id,template,opts(s,[],cas(first))),error=>error.code==='EMAIL_SETTINGS_CONFLICT');
 await assert.rejects(settings.read({...s,account_id:randomUUID()},'templates',id,async()=>{}));await assert.rejects(settings.read(s,'signatures',id,async()=>{}));
 assert.equal((await settings.list(s,'templates',{cursor:null,limit:25},async()=>{})).items[0].summary.subject,'Updated');
 const archived=await settings.archive(s,'templates',id,opts(s,[],cas(next)));assert.equal(archived.content_revision,2);assert.equal((await settings.read(s,'templates',id,async()=>{})).status,'archived');assert.equal((await settings.list(s,'templates',{cursor:null,limit:25},async()=>{})).items.length,0);
 await assert.rejects(settings.save(s,'templates',id,template,opts(s,[],cas(archived))));
});
test('32 unique normalized verified identities allowed; 33rd and address reassignment denied; unavailable saved history remains readable',async()=>{
 const s=scope(),settings=createSettingsStore({store:memory()}),addresses=Array.from({length:33},(_,i)=>'alias'+i+'@example.test');let first;
 for(const address of addresses.slice(0,32)){const row=await settings.create(s,'signatures',randomUUID(),signature(address),opts(s,addresses));first??=row;}
 await assert.rejects(settings.create(s,'signatures',randomUUID(),signature(addresses[32]),opts(s,addresses)),error=>error.code==='EMAIL_SETTINGS_LIMIT');
 await assert.rejects(settings.create(s,'signatures',randomUUID(),signature(addresses[0].toUpperCase()),opts(s,addresses)),error=>error.code==='EMAIL_SETTINGS_LIMIT');
 await assert.rejects(settings.save(s,'signatures',first.record_id,signature(addresses[1]),opts(s,addresses,cas(first))),error=>error.code==='EMAIL_SETTINGS_IDENTITY_DENIED');
 await assert.rejects(settings.save(s,'signatures',first.record_id,first.value,opts(s,[],cas(first))),error=>error.code==='EMAIL_SETTINGS_IDENTITY_DENIED');
 assert.deepEqual((await settings.read(s,'signatures',first.record_id,async()=>{})).value,first.value);
 await settings.archive(s,'signatures',first.record_id,opts(s,[],cas(first)));assert.equal((await settings.create(s,'signatures',randomUUID(),signature(addresses[32]),opts(s,addresses))).revision,1);
});
test('atomic account aggregate blocks concurrent creates and concurrent saves crossing exact UTF8 budget',async()=>{
 const s=scope(),settings=createSettingsStore({store:memory()}),addresses=Array.from({length:18},(_,i)=>'a'+i+'@example.test'),large=address=>({address,plain:'💚'.repeat(1024),html:'',placement:'new'});
 for(const address of addresses.slice(0,14))await settings.create(s,'signatures',randomUUID(),large(address),opts(s,addresses));
 const raced=await Promise.allSettled(addresses.slice(14,16).map(address=>settings.create(s,'signatures',randomUUID(),large(address),opts(s,addresses))));assert.equal(raced.filter(row=>row.status==='fulfilled').length,1);
 const s2=scope(),settings2=createSettingsStore({store:memory()}),saved=[];for(const address of addresses.slice(0,16))saved.push(await settings2.create(s2,'signatures',randomUUID(),signature(address),opts(s2,addresses)));
 // One record expansion fits, but all fifteen expansions cannot independently
 // observe the old collection and oversubscribe its aggregate bytes.
 const saves=await Promise.allSettled(saved.map(row=>settings2.save(s2,'signatures',row.record_id,large(row.value.address),opts(s2,addresses,cas(row)))));
 const page=await settings2.list(s2,'signatures',{cursor:null,limit:25},async()=>{}),values=await Promise.all(page.items.map(row=>settings2.read(s2,'signatures',row.record_id,async()=>{})));
 assert.equal(saves.filter(row=>row.status==='fulfilled').length,15);assert.equal(saves.filter(row=>row.status==='rejected').length,1);assert.ok(Buffer.byteLength(JSON.stringify({identities:values.map(row=>row.value)}))<=65536);
});
test('late current actor denial after CAS exposes no value and leaves exact durable acknowledgement receipt',async()=>{
 const s=scope(),store=memory(),settings=createSettingsStore({store}),id=randomUUID(),request_id=randomUUID();let checks=0;
 const o=opts(s,[],{request_id,public_input_digest:'sha256:'+'a'.repeat(64),check:async()=>{if(++checks===4)throw Error('revoked');}});
 await assert.rejects(settings.create(s,'templates',id,template,o));const receipt=await settings.receipt(s,'templates',id,request_id,async()=>{});assert.equal(receipt.revision,1);assert.equal(receipt.public_input_digest,o.public_input_digest);assert.deepEqual((await settings.read(s,'templates',id,async()=>{})).value,template);
 await assert.rejects(settings.create(s,'templates',randomUUID(),template,opts(s,[],{user_id:randomUUID()})));
});
