import {createHash} from 'node:crypto';
import {canonical,exact,fail} from './contract.mjs';
import {uuid} from './draft-store.mjs';
import {resourceView} from './mailbox-store.mjs';
import {inspectEmailSourceFiles} from './vendor/providers/incoming-source-files.mjs';

/** A source file_ref is a nomination, never a byte hash or URL. The private
 * immutable draft origin binds exact original MIME. Existing draft upload CAS,
 * quotas and durable request receipt own the copied bytes and recovery. */
export async function copyOriginalFile({request,scope,input,drafts,mailbox,bridge,sourceFor,context,check}){
 exact(input,['store_key','record_id','expected_revision','expected_content_digest','file_id','source']);
 exact(input.source,['resource_key','record_id','content_digest','file_ref']);
 if(input.store_key!=='drafts'||!uuid(input.file_id)||!/^sha256:[a-f0-9]{64}$/u.test(input.source.file_ref??'')||input.source.resource_key!==request.scope.resource_key)fail('EMAIL_DATA_INPUT_INVALID');
 const draft=await drafts.read(scope,input.record_id,check),origin=draft.origin;
 if(draft.status!=='draft'||draft.revision!==input.expected_revision||'sha256:'+draft.content_digest!==input.expected_content_digest)fail('EMAIL_DRAFT_CONFLICT');
 if(!origin||canonical({resource_key:origin.resource_key,record_id:origin.record_id,content_digest:origin.content_digest})!==canonical(Object.fromEntries(['resource_key','record_id','content_digest'].map(k=>[k,input.source[k]]))))fail('EMAIL_DATA_SOURCE_CHANGED');
 const resource=await mailbox.get(scope,input.source.record_id,check);
 if(resourceView(resource).content_digest!==input.source.content_digest||resource.logical_message_id!==origin.logical_message_id)fail('EMAIL_DATA_SOURCE_CHANGED');
 let source,selected;
 try{
  source=await bridge.nativeEmailSource({source:await sourceFor(resource)},context);await check();
  if(source.account_id!==scope.account_id||!(source.mime_bytes instanceof Uint8Array)||source.mime_bytes.length>35*1024*1024||'sha256:'+source.digest!==origin.source_digest||createHash('sha256').update(source.mime_bytes).digest('hex')!==source.digest)fail('EMAIL_DATA_SOURCE_CHANGED');
  selected=await inspectEmailSourceFiles(source.mime_bytes,{profile:'native',file_ref:input.source.file_ref.slice(7),check});
  const metadata=selected.files.find(file=>'sha256:'+file.file_ref===input.source.file_ref);
  if(!metadata||metadata.disposition!=='attachment'||selected.bytes.length!==metadata.size_bytes||selected.bytes.length>25*1024*1024)fail('EMAIL_DRAFT_FILE_DENIED');
  await check();return await drafts.upload(scope,input.record_id,input.expected_revision,{file_id:input.file_id,filename:metadata.filename,media_type:metadata.media_type,size_bytes:selected.bytes.length,sha256:createHash('sha256').update(selected.bytes).digest('hex')},selected.bytes,{request_id:request.request_id,check});
 }finally{selected?.bytes?.fill(0);source?.mime_bytes?.fill(0);}
}
