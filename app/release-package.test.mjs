import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash, randomUUID,webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {verifyDeftAppPackageJson, parseRuntimeObjectInput, RuntimeObjectSchema, DEFT_APP_KIT_VERSION} from '@deft/app-kit/core';
import {createDeftExperienceSdk} from '@deft/app-kit/experience';

const json = readFileSync(new URL('./app.deft.json', import.meta.url), 'utf8');
const verified = await verifyDeftAppPackageJson(json);
const manifest = verified.package.manifest;
const metadata = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));
const rootMetadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const compatibility = JSON.parse(readFileSync(new URL('../release/compatibility.json', import.meta.url)));

test('packed public Kit keeps the displayed target on a mailbox refresh', async () => {
  const sent=[],port={onmessage:null,postMessage:value=>sent.push(value),close(){}},sdk=createDeftExperienceSdk(port,'packed-refresh');
  const pending=sdk.refreshDataResource('drafts','inbox','receiving_account');
  assert.deepEqual(sent[0].input,{operation:'resource_refresh',input:{store_key:'drafts',resource_key:'inbox'},target_key:'receiving_account'});
  port.onmessage({data:{version:'deft.experience_bridge.v1',kind:'response',session_id:'packed-refresh',request_id:'request_1',ok:true,output:{outcome:'completed'}}});
  assert.equal((await pending).outcome,'completed');sdk.close();
});

test('fresh package authenticates its manifest and worker artifact against public Kit42', () => {
  assert.equal(DEFT_APP_KIT_VERSION, '0.1.0-alpha.42');
  assert.equal(metadata.version, '1.9.1-preview.10');
  assert.equal(compatibility.email.tag, 'v' + rootMetadata.version);
  assert.equal(compatibility.email.app_version, metadata.version);
  assert.equal(compatibility.host.minimum_version, '0.3.0-preview.136');
  assert.equal(compatibility.host.version, compatibility.host.minimum_version);
  const artifact = JSON.parse(readFileSync(new URL('./artifact.json', import.meta.url)));
  assert.equal(JSON.parse(artifact.content).background_refresh_description, "Keep mailbox metadata current while Email is closed. Background refresh makes new messages available for Tasks and Knowledge; each action keeps its own review.");
  assert.equal(manifest.id, 'io.deft.email');
  assert.equal(manifest.version, metadata.version);
  assert.equal(manifest.license, metadata.license);
  assert.equal(verified.json, json);
  assert.equal(verified.digest, 'sha256:' + createHash('sha256').update(json).digest('hex'));
  assert.equal(manifest.experiences.length, 1);
  assert.equal(manifest.experiences[0].key, 'main');
  assert.equal(manifest.native_actions.length, 0);
  assert.ok(manifest.owner_connections.every(policy => policy.allow_until_revoked === true));
});

for (const key of ['send_message', 'organize_messages']) {
  test(`${key} public parser enforces the current 36-character account identity contract`, () => {
    const contract = RuntimeObjectSchema.parse(manifest.private_capabilities.find(v => v.key === key).input_schema);
    assert.deepEqual(contract.properties.account_ref, {type:'string', minLength:36, maxLength:36});
    const payload = Object.fromEntries(Object.entries(contract.properties).map(([name, field]) => [name,
      field.type === 'number' ? field.minimum ?? 1 : field.minLength === 36 ? randomUUID() : field.minLength === 71 ? 'sha256:' + 'a'.repeat(64) : 'x']));
    for (const account_ref of [randomUUID(), randomUUID()]) {
      const input = {...payload, account_ref};
      assert.deepEqual(parseRuntimeObjectInput(contract, input), input);
    }
    for (const account_ref of ['', 'gmail_controlled_sender', 'x'.repeat(35), 'x'.repeat(37)])
      assert.throws(() => parseRuntimeObjectInput(contract, {...payload, account_ref}));
    assert.throws(() => parseRuntimeObjectInput(contract, {...payload, unreviewed: 'x'}));
  });
}

test('package rejects a changed account declaration without a rebuilt digest', async () => {
  const changed = JSON.parse(json);
  changed.manifest.private_capabilities.find(v => v.key === 'send_message').input_schema.properties.account_ref.maxLength = 513;
  await assert.rejects(() => verifyDeftAppPackageJson(JSON.stringify(changed)));
});


test('packed Worker opens Reply immediately with every further network request held and no create or Send',async()=>{
 const artifact=JSON.parse(readFileSync(new URL('./artifact.json',import.meta.url),'utf8')),source=JSON.parse(artifact.content).worker_source,session='packed-reply-readonly',record='11111111-1111-4111-8111-111111111111',digest='sha256:'+'a'.repeat(64),views=[],requests=[];let held=false;
 const port={onmessage:null,close(){},postMessage(message){const value=structuredClone(message);if(value.kind==='view'){views.push(value.view);return;}requests.push(value);if(held)return;const operation=value.input?.operation,output=operation==='account_catalog'?{targets:[{key:'primary',label:'Current account'}],selected_target_key:'primary'}:operation==='resource_list'?{outcome:'completed',items:[{record_id:record,content_digest:digest,data:{provider:'gmail',sender:'Sender <sender@example.test>',subject:'Exact selected source',date:'2026-10-22T00:00:00Z'}}],next_cursor:null}:{outcome:'completed',items:[],next_cursor:null};queueMicrotask(()=>port.onmessage({data:{version:'deft.experience_bridge.v1',kind:'response',session_id:session,request_id:value.request_id,ok:true,output}}));}};
 const allNodes=()=>{const nodes=[],walk=node=>{nodes.push(node);node.children?.forEach(walk);node.items?.forEach(walk);};if(views.length)walk(views.at(-1).root);return nodes;},find=id=>allNodes().find(node=>node.id===id),wait=async predicate=>{const deadline=performance.now()+1000;while(!predicate()){assert.ok(performance.now()<deadline,'packed Worker event did not settle within one second');await new Promise(setImmediate);}},emit=node_id=>port.onmessage({data:{version:'deft.experience_bridge.v1',kind:'ui_event',session_id:session,event:{kind:'click',node_id}}});
 const self={};vm.runInNewContext(source,{self,crypto:webcrypto,TextEncoder,Date,Map,setTimeout,clearTimeout});self.onmessage({data:{kind:'start',port,session_id:session}});
 await wait(()=>find('mail_'+record.replaceAll('-',''))&&!find('compose').disabled);emit('mail_'+record.replaceAll('-',''));await wait(()=>find('reply')&&!find('reply').disabled);
 held=true;const before=requests.length,started=performance.now();emit('reply');await wait(()=>find('draft_form'));assert.ok(performance.now()-started<1000);const form=find('draft_form');assert.equal(form.expected_revision,0);assert.equal(form.seed.value.mode,'reply');assert.equal(form.seed.value.record_seed.source.record_id,record);assert.equal(requests.length,before,'Reply performs no Worker data/permission/write request');assert.equal(requests.some(request=>request.input?.operation==='record_create'||request.operation==='dialog'),false);
});
