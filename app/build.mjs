import {EMAIL_INTEGRATION_TOOL_DECLARATIONS} from './ten-tool-schema.mjs';
import {EMAIL_FUTURE_SEND_POLICY} from './future-record-action-policy.mjs';
import {EMAIL_MIRROR_INPUT_SCHEMA,EMAIL_MIRROR_OUTPUT_SCHEMA,EMAIL_MIRROR_POLICY} from './mirror-contract.mjs';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {prepareDeftExperienceArtifact,buildDeftAppPackage} from '@deft/app-kit';
import {EMAIL_PROVIDER_CONNECTIONS} from './provider-admission.mjs';
import {EMAIL_RECORD_FORM_PROFILE,emptyEmailRecord} from './record-ui.mjs';
import {EMAIL_METADATA_DESCRIPTOR} from './metadata-resource.mjs';

const root=realpathSync(process.cwd());
for(const name of ['@deft/app-kit','esbuild'])assert.ok(realpathSync(resolve('node_modules',name)).startsWith(root+sep));
const bundled=await build({entryPoints:['worker.mjs'],outfile:'worker.bundle.js',bundle:true,minify:true,format:'iife',platform:'browser',target:'es2022',metafile:true});
assert.ok(!Object.keys(bundled.metafile.inputs).some(path=>path.endsWith('/dist/index.js')||path.includes('/node_modules/zod/')));
const capabilities=['record_form_seed.v1','record_mirror.v1','keyboard_controls.v1','local_job.v1','record_document.v1','record_document_policy.v1','record_form.v1','record_form.v2','repeated_fields.v1','record_initial_change.v1','record_change_parameters.v1','record_form_presentation.v1','record_intake.mailto.v1'];
const artifact=await prepareDeftExperienceArtifact('experiences/main.json',{
 schema_version:'deft.experience_bundle.v4',record_intakes:[{key:'new_message',store_key:'drafts',format:'mailto',profile:EMAIL_RECORD_FORM_PROFILE,seed:emptyEmailRecord(),fields:{to:'to',cc:'cc',bcc:'bcc',subject:'subject',plain:'body',html:'body_html'}}],state_keys:[],record_store_keys:['native_history','rules','rules_order','drafts','preferences','signatures','templates','smtp_preferences','mailbox_status','folders','folder_preferences'].sort(),search_resource_keys:['inbox'],
 worker_source:readFileSync('worker.bundle.js','utf8'),entry_view:'main',resource_keys:['inbox'],action_keys:['mirror_drafts','organize_messages','send_message'],
});
const string=maxLength=>({type:'string',maxLength});
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const uuid={...string(36),minLength:36},digest={...string(71),minLength:71},revision={type:'number',minimum:1,maximum:2147483646};
// Immutable references only. Full native draft values and MIME/file bytes never
// enter an App Run or the small author Worker bridge.
export const EMAIL_SEND_INPUT_SCHEMA=object({snapshot_id:uuid,account_ref:uuid,draft_id:uuid,draft_revision:revision,content_revision:revision,
 content_digest:digest,source_digest:string(71),file_manifest_digest:digest,mime_digest:digest,payload_digest:digest,
 record_action_version:string(64),record_store_key:string(48),connection_session_id:uuid,
 connection_revision:revision,data_consent_id:uuid,data_consent_digest:digest,prepared_digest:digest});
const output=object({operation_id:string(120),transport_outcome:string(40),sent_copy_outcome:string(40)});
const count={type:'number',minimum:0,maximum:25};
export const EMAIL_ORGANIZE_INPUT_SCHEMA=object({snapshot_id:uuid,account_ref:uuid,operation_key:string(48),source_manifest_digest:digest,
 item_count:{...count,minimum:1},plan_digest:digest,resource_action_version:string(64),resource_store_key:string(48),connection_session_id:uuid,
 connection_revision:revision,data_consent_id:uuid,data_consent_digest:digest,prepared_digest:digest});
export const EMAIL_ORGANIZE_OUTPUT_SCHEMA=object({operation_id:uuid,operation_key:string(48),item_count:{...count,minimum:1},succeeded_count:count,failed_count:count,
 items_json:string(2048),automatic_retry:{type:'boolean'}});
EMAIL_ORGANIZE_OUTPUT_SCHEMA.properties.actions_json=string(16384);
EMAIL_ORGANIZE_OUTPUT_SCHEMA.required.push('actions_json');
const manifest={schema_version:'7',id:'io.deft.email',version:JSON.parse(readFileSync('package.json','utf8')).version,name:'Email',license:'AGPL-3.0-only',compatibility:{app_protocol:'7'},modules:[],navigation:[],
 runtime_requirements:[{key:'sync_provider',protocol_version:'deft.app_runtime_channel.v3'},{key:'mail_provider',protocol_version:'deft.app_runtime_channel.v1'}],
 private_capabilities:[{key:'mirror_drafts',version:'1',input_schema:EMAIL_MIRROR_INPUT_SCHEMA,output_schema:EMAIL_MIRROR_OUTPUT_SCHEMA},{key:'organize_messages',version:'1',input_schema:EMAIL_ORGANIZE_INPUT_SCHEMA,output_schema:EMAIL_ORGANIZE_OUTPUT_SCHEMA},{key:'send_message',version:'1',input_schema:EMAIL_SEND_INPUT_SCHEMA,output_schema:output}],
 runtime_actions:[{key:'mirror_drafts',label:'Sync provider drafts',capability_key:'mirror_drafts',runtime_requirement_key:'mail_provider'},{key:'organize_messages',label:'Organize messages',capability_key:'organize_messages',runtime_requirement_key:'mail_provider'},{key:'send_message',label:'Send message',capability_key:'send_message',runtime_requirement_key:'mail_provider'}],
 integration_tools:EMAIL_INTEGRATION_TOOL_DECLARATIONS,
 sync_descriptors:[{...EMAIL_METADATA_DESCRIPTOR,key:'inbox',record_schema:{...EMAIL_METADATA_DESCRIPTOR.record_schema,properties:{...EMAIL_METADATA_DESCRIPTOR.record_schema.properties,source_record_id:string(36),source_content_digest:string(71),source_observed_at:string(64)},required:[...EMAIL_METADATA_DESCRIPTOR.record_schema.required,'source_record_id','source_content_digest','source_observed_at']}}],
 experiences:[{key:'main',label:'Inbox',artifact_path:artifact.path,artifact_digest:artifact.digest,bridge_version:'deft.experience_bridge.v1',renderer_version:'deft.trusted_renderer.v2',capabilities}],
 owner_connections:EMAIL_PROVIDER_CONNECTIONS.map(connection=>({...connection,action_keys:[...connection.action_keys]})),
 record_stores:[{schema_version:'deft.app_record_store.v1',key:'native_history',resource_key:'inbox',runtime_requirement_key:'sync_provider',max_record_bytes:8192,max_files:1,max_file_bytes:25*1024*1024,max_total_file_bytes:25*1024*1024},{schema_version:'deft.app_record_store.v1',key:'drafts',source_projection:{sync_descriptor_key:'inbox',record_id_field:'source_record_id',content_digest_field:'source_content_digest',observed_at_field:'source_observed_at',projection_identity_field:'logical_message_id',navigation_entry_key:'main'},resource_key:'inbox',runtime_requirement_key:'sync_provider',future_record_actions:[EMAIL_FUTURE_SEND_POLICY],record_mirrors:[EMAIL_MIRROR_POLICY],max_record_bytes:480*1024,max_files:32,max_file_bytes:25*1024*1024,max_total_file_bytes:25*1024*1024,
 local_job_operations:[{key:'follow_up',local_only:true},{key:'snooze',local_only:true}],
 record_changes:[{key:'signature_apply',source_store_key:'signatures'},{key:'signature_default',source_store_key:'signatures'},{key:'signature_remove',source_store_key:'signatures'},{key:'template_append',source_store_key:'templates'},{key:'template_replace',source_store_key:'templates'}],
 resource_content:{max_presentation_bytes:262144,max_source_bytes:35*1024*1024,max_file_bytes:25*1024*1024,max_image_bytes:2097152}},
 ...['rules','rules_order'].map(key=>({schema_version:'deft.app_record_store.v1',key,resource_key:'inbox',runtime_requirement_key:'sync_provider',max_record_bytes:32768,max_files:0,max_file_bytes:1,max_total_file_bytes:1})),
 ...['folder_preferences','folders'].map(key=>({schema_version:'deft.app_record_store.v1',key,resource_key:'inbox',runtime_requirement_key:'sync_provider',max_record_bytes:8192,max_files:0,max_file_bytes:1,max_total_file_bytes:1})),
 {schema_version:'deft.app_record_store.v1',key:'mailbox_status',resource_key:'inbox',runtime_requirement_key:'sync_provider',max_record_bytes:2048,max_files:0,max_file_bytes:1,max_total_file_bytes:1},
 {schema_version:'deft.app_record_store.v1',key:'smtp_preferences',resource_key:'inbox',runtime_requirement_key:'sync_provider',max_record_bytes:1024,max_files:0,max_file_bytes:1,max_total_file_bytes:1},
 {schema_version:'deft.app_record_store.v1',key:'preferences',resource_key:'inbox',runtime_requirement_key:'sync_provider',max_record_bytes:8192,max_files:0,max_file_bytes:1,max_total_file_bytes:1},
 {schema_version:'deft.app_record_store.v1',key:'signatures',resource_key:'inbox',runtime_requirement_key:'sync_provider',max_record_bytes:65536,max_files:0,max_file_bytes:1,max_total_file_bytes:1},
 {schema_version:'deft.app_record_store.v1',key:'templates',resource_key:'inbox',runtime_requirement_key:'sync_provider',max_record_bytes:491520,max_files:0,max_file_bytes:1,max_total_file_bytes:1}].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0),
 native_actions:[],public_actions:[],
};
const pkg=await buildDeftAppPackage({manifest,artifacts:[artifact]});
writeFileSync('app.deft.json',pkg.json);writeFileSync('artifact.json',JSON.stringify(artifact));
writeFileSync('build-result.json',JSON.stringify({packageDigest:pkg.digest,artifactDigest:artifact.digest,sourceInputs:Object.keys(bundled.metafile.inputs),normalBundler:true,
 workerSha256:createHash('sha256').update(readFileSync('worker.bundle.js')).digest('hex')},null,2));
console.log(JSON.stringify({passed:true,packageDigest:pkg.digest}));
