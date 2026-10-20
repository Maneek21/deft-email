import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash, randomUUID} from 'node:crypto';
import {verifyDeftAppPackageJson, parseRuntimeObjectInput, RuntimeObjectSchema, DEFT_APP_KIT_VERSION} from '@deft/app-kit';
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

test('fresh package authenticates its manifest and worker artifact against public Kit39', () => {
  assert.equal(DEFT_APP_KIT_VERSION, '0.1.0-alpha.39');
  assert.equal(metadata.version, '1.9.0-preview.14');
  assert.equal(compatibility.email.tag, 'v' + rootMetadata.version);
  assert.equal(compatibility.email.app_version, metadata.version);
  assert.equal(compatibility.host.minimum_version, '0.3.0-preview.127');
  assert.equal(compatibility.host.version, compatibility.host.minimum_version);
  const artifact = JSON.parse(readFileSync(new URL('./artifact.json', import.meta.url)));
  assert.equal(JSON.parse(artifact.content).background_refresh_description, "Keep mailbox metadata current while this app is closed. Turn this on to create Tasks or Knowledge from mail: it is how the app shares messages with Deft.");
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
