const string=maxLength=>({type:'string',maxLength});
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const uuid={...string(36),minLength:36},digest={...string(71),minLength:71},revision={type:'number',minimum:1,maximum:2147483646};
// Immutable private snapshot references only. Runtime/provider IDs and MIME
// never enter the Worker or public Run input/output.
export const EMAIL_MIRROR_INPUT_SCHEMA=object({mirror_receipt_id:uuid,mirror_receipt_revision:revision,mirror_policy_digest:digest,
 record_store_key:string(48),record_id:uuid,record_revision:revision,content_digest:digest,snapshot_id:uuid,snapshot_digest:digest,
 mirror_operation:string(16),accepted_submission_id:string(36),accepted_snapshot_id:string(36),accepted_snapshot_digest:string(71)});
export const EMAIL_MIRROR_OUTPUT_SCHEMA=object({operation_id:uuid,record_id:uuid,record_revision:revision,
 mirror_state:string(16),automatic_retry:{type:'boolean'},limitations_json:string(2048)});
export const EMAIL_MIRROR_POLICY=Object.freeze({schema_version:'deft.app_record_mirror.v1',key:'provider_drafts',action_key:'mirror_drafts',
 max_authority_seconds:90*86400,max_attempts_per_day:1000,max_mime_bytes:35*1024*1024,
 operations:['create','update','inspect','delete'],cleanup:'matching_accepted_submission',cleanup_action_keys:['send_message']});
