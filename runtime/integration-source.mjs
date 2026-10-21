import {resourceUuid,resourceView} from './mailbox-store.mjs';
import {fail} from './contract.mjs';
import {canonical} from './contract.mjs';

export const EMAIL_INTEGRATION_SOURCE_MAPPING=Object.freeze({record_id_field:'source_record_id',content_digest_field:'source_content_digest',observed_at_field:'source_observed_at'});
const metadataFields=Object.freeze({source_record_id:{type:'string',maxLength:36},source_content_digest:{type:'string',maxLength:71},source_observed_at:{type:'string',maxLength:64}});
/** Preserve the closed old metadata validator. Only this exact signed extension
 * is compatible; all unrelated descriptor changes still fail the original pin. */
export async function assertIntegrationSourceDescriptor(descriptor,attested_digest){
 const [{digestResourceSyncDescriptorV2},{assertEmailMetadataDescriptor}]=await Promise.all([import('@deft/app-kit/core'),import('./vendor/metadata-resource.mjs')]);
 const present=Object.keys(metadataFields).filter(field=>Object.hasOwn(descriptor.record_schema.properties,field));
 if(!present.length){await assertEmailMetadataDescriptor(descriptor,attested_digest);return null;}
 if(present.length!==3||await digestResourceSyncDescriptorV2(descriptor)!==attested_digest
  ||present.some(field=>canonical(descriptor.record_schema.properties[field])!==canonical(metadataFields[field])||!descriptor.record_schema.required.includes(field)))fail('EMAIL_INTEGRATION_SOURCE_MAPPING_DENIED');
 const base=structuredClone(descriptor);for(const field of present)delete base.record_schema.properties[field];base.record_schema.required=base.record_schema.required.filter(field=>!present.includes(field));
 await assertEmailMetadataDescriptor(base,await digestResourceSyncDescriptorV2(base));return EMAIL_INTEGRATION_SOURCE_MAPPING;
}

/** Adds only fields admitted by the signed descriptor. Compute the exact
 * existing public source identity first: metadata never feeds its own digest. */
export function integrationSourceProjection(scope,item,observed_at,mapping){
 const fields=[mapping?.record_id_field,mapping?.content_digest_field,mapping?.observed_at_field];
 if(new Set(fields).size!==3||fields.some(field=>typeof field!=='string'||!/^[a-z][a-z0-9_]{0,47}$/u.test(field)
  ||['constructor','prototype','__proto__'].includes(field)||Object.hasOwn(item.data,field))
  ||item.account_id!==scope.account_id||!Number.isFinite(Date.parse(observed_at)))fail('EMAIL_INTEGRATION_SOURCE_MAPPING_DENIED');
 const resource=resourceView({record_id:resourceUuid(scope,item.logical_message_id),logical_message_id:item.logical_message_id,
  provider_revision:item.revision,provider_source:item.provider_source,data:item.data,revision:1,deleted:false});
 const data={...item.data,[fields[0]]:resource.record_id,[fields[1]]:resource.content_digest,[fields[2]]:observed_at};
 if(Object.keys(data).length>32)fail('EMAIL_INTEGRATION_SOURCE_MAPPING_DENIED');
 return {id:item.logical_message_id,revision:item.revision,data,attachments:[]};
}
