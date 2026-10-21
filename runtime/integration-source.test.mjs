import {test} from 'node:test';
import assert from 'node:assert/strict';
import {integrationSourceProjection,assertIntegrationSourceDescriptor} from './integration-source.mjs';
import {resourceUuid,resourceView} from './mailbox-store.mjs';
import {integrationKnowledgeEvidence,integrationKnowledgePresentation} from './integration-knowledge.mjs';
import {EMAIL_METADATA_DESCRIPTOR} from './vendor/metadata-resource.mjs';
import {digestResourceSyncDescriptorV2} from '@deft/app-kit/core';
const scope={org_id:'org_a',owner_user_id:'user_a',account_id:'account_a'};
const item={account_id:scope.account_id,logical_message_id:'mail_'+'a'.repeat(64),revision:'provider_revision_1',provider_source:{provider:'gmail',id:'opaque_native'},data:{label:'Decision',subject:'Planning decision',from:'Person',folder:'inbox'}};
const mapping={record_id_field:'source_record_id',content_digest_field:'source_content_digest',observed_at_field:'source_observed_at'};
test('sync metadata retains exact existing resource UUID/digest computed before metadata injection',()=>{
 const row=integrationSourceProjection(scope,item,'2026-10-11T00:00:00Z',mapping);
 const resource=resourceView({...item,record_id:resourceUuid(scope,item.logical_message_id),provider_revision:item.revision,revision:1});
 assert.equal(row.data.source_record_id,resource.record_id);assert.equal(row.data.source_content_digest,resource.content_digest);
 assert.deepEqual(item.data,{label:'Decision',subject:'Planning decision',from:'Person',folder:'inbox'});
 assert.throws(()=>integrationSourceProjection(scope,{...item,data:row.data},'2026-10-11T00:00:00Z',mapping));
 assert.throws(()=>integrationSourceProjection({...scope,account_id:'foreign'},item,'2026-10-11T00:00:00Z',mapping));
});
test('signed source extension retains exact old 25-field compatibility and rejects unrelated fields or attestation',async()=>{
 assert.equal(await assertIntegrationSourceDescriptor(EMAIL_METADATA_DESCRIPTOR,await digestResourceSyncDescriptorV2(EMAIL_METADATA_DESCRIPTOR)),null);
 const descriptor=structuredClone(EMAIL_METADATA_DESCRIPTOR);
 for(const [field,maxLength] of [['source_record_id',36],['source_content_digest',71],['source_observed_at',64]]){descriptor.record_schema.properties[field]={type:'string',maxLength};descriptor.record_schema.required.push(field);}
 const digest=await digestResourceSyncDescriptorV2(descriptor);assert.deepEqual(await assertIntegrationSourceDescriptor(descriptor,digest),mapping);
 await assert.rejects(assertIntegrationSourceDescriptor(descriptor,'sha256:'+'0'.repeat(64)));
 const unrelated=structuredClone(descriptor);unrelated.record_schema.properties.sender.maxLength=200;
 await assert.rejects(assertIntegrationSourceDescriptor(unrelated,await digestResourceSyncDescriptorV2(unrelated)));
 const incomplete=structuredClone(descriptor);incomplete.record_schema.required=incomplete.record_schema.required.filter(field=>field!=='source_observed_at');
 await assert.rejects(assertIntegrationSourceDescriptor(incomplete,await digestResourceSyncDescriptorV2(incomplete)));
});
test('canonical folder nominations exclude provider label IDs and override broad inbox flags',()=>{
 const presentation=integrationKnowledgePresentation({record_id:'record',logical_message_id:'mail_a',provider_revision:'revision',provider_source:{provider:'gmail'},data:{sender:'Person',date:'2026-10-11T00:00:00Z'},revision:1,folders:['inbox','trash','private_label_123']},{plain_text:'We agreed to preserve this substantive reusable release procedure.',metadata:{conversation_id:'thread'}});
 assert.deepEqual(JSON.parse(presentation.metadata.capture_folders),['inbox','trash']);
 assert.equal(JSON.parse(presentation.metadata.capture_nomination).eligible,false);
 assert.equal(integrationKnowledgeEvidence({resource:{record_id:'message',data:{in_inbox:true}},presentation,policy:{include_bulk:false,excluded_folders:[],excluded_senders:[]}}).reason,'excluded_folder');
});

test('V2 capture publishes the privately normalized body rather than asking Host to infer it',()=>{
 const body='We agreed this exact procedure will be retained as durable release knowledge.';
 const presentation=integrationKnowledgePresentation({record_id:'record',logical_message_id:'mail_a',provider_revision:'revision',provider_source:{provider:'gmail'},data:{sender:'Person',date:'2026-10-11T00:00:00Z'},revision:1,folders:['inbox']},{plain_text:body+'\n> quoted history\nOn Monday wrote:\nold history',metadata:{conversation_id:'thread'}});
 const nomination=JSON.parse(presentation.metadata.capture_nomination);assert.equal(nomination.schema_version,'deft.app_capture_nomination.v2');assert.equal(nomination.body,body);assert.deepEqual(nomination.folders,['inbox']);assert.ok(nomination.body_digest.startsWith('sha256:'));
});
test('bounded body-only eligibility excludes secrets/bulk and preserves thread nomination without subject merges',()=>{
 const resource={record_id:'message_a',content_digest:'sha256:'+'a'.repeat(64),data:item.data,tombstone:false},policy={include_bulk:false,excluded_folders:[],excluded_senders:[]};
 const body='We agreed that release validation will use this documented process and preserve each original request.';
 const read=text=>integrationKnowledgeEvidence({resource,presentation:{plain_text:text,metadata:{}},policy});
 const result=read(body+'\n> quoted old secret\nOn Monday wrote:\nold text');assert.equal(result.eligible,true);assert.equal(result.body,body);
 assert.equal(result.partial,true);assert.equal(result.attachments_processed,false);
 assert.equal(read('Password reset token. '+body).reason,'sensitive');assert.equal(read('Newsletter unsubscribe '+body).reason,'bulk');assert.equal(read('a'.repeat(16001)).reason,'body_too_large');
 const other=integrationKnowledgeEvidence({resource:{...resource,record_id:'message_b'},presentation:{plain_text:body,metadata:{}},policy});assert.notEqual(result.thread_key,other.thread_key);
});
