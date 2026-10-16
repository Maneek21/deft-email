import {createHash} from 'node:crypto';
import {fail} from './contract.mjs';
import {inspectEmailSourceFiles} from './vendor/providers/incoming-source-files.mjs';
import {fetchPublicMessageImage} from './vendor/providers/remote-image-proxy.mjs';
import {NATIVE_INCOMING_LIMITS} from './vendor/providers/contract.mjs';

/** One current, scoped native MIME read. Frozen part references bind the exact
 * source digest and part/source nomination; no presentation prefetch is needed.
 * Neither a browser URL nor a caller-supplied provider locator enters this port. */
export async function readResourceBytes({bridge,provider_source,input,operation,context,check,imageDependencies,sourceCache,sourceCacheKey}){
  const isImage=operation==='resource_read_image',ref=isImage?'image_ref':'file_ref';
  if(!['resource_read_file','resource_read_image'].includes(operation)||!/^sha256:[a-f0-9]{64}$/u.test(input[ref]??''))fail('EMAIL_DATA_INPUT_INVALID');
  let source,result;
  try{
    const load=async()=>{const value=await bridge.nativeEmailSource({source:provider_source},context);try{if(value.account_id!==context.account_id||value.provider!==provider_source.provider||!(value.mime_bytes instanceof Uint8Array)||value.mime_bytes.length<1||value.mime_bytes.length>NATIVE_INCOMING_LIMITS.source_bytes||createHash('sha256').update(value.mime_bytes).digest('hex')!==value.digest)fail('EMAIL_DATA_SOURCE_CHANGED');return value;}catch(error){value?.mime_bytes?.fill(0);throw error;}};
    // Gmail messages have immutable body identity; draft replacement creates a
    // new message ID. Other providers retain the full-source validation path.
    const immutableGmail=sourceCache&&typeof sourceCacheKey==='string'&&provider_source?.schema_version==='deft.email_provider_source.v1'&&provider_source.provider==='gmail'&&provider_source.account_id===context.account_id&&provider_source.locator?.kind==='gmail'&&typeof provider_source.locator.message_id==='string'&&typeof bridge.nativeEmailConversation==='function';
    source=immutableGmail?await sourceCache.read({key:sourceCacheKey,load,check,signal:context.signal,validateHit:async()=>{const current=await bridge.nativeEmailConversation({source:provider_source,cursor:null,limit:1},context);if(current.account_id!==context.account_id||current.provider!=='gmail'||current.anchor_logical_message_id!==provider_source.logical_message_id)fail('EMAIL_DATA_SOURCE_CHANGED');}}):await load();
    await check();
    result=await inspectEmailSourceFiles(source.mime_bytes,{profile:'native',[ref]:input[ref].slice(7),check,fetchRemote:async({url})=>{
      if(!isImage||input.external_images!=='allowed')fail('EMAIL_DATA_IMAGE_DENIED');
      await check();let image;
      try{
        image=await fetchPublicMessageImage(url,{signal:context.signal,recheck:async()=>{await check();return true;}},imageDependencies);
        await check();return image;
      }catch(error){image?.bytes?.fill(0);throw error;}
    }});
    await check();
    if(isImage)return {bytes:result.bytes,media_type:result.media_type};
    const file=result.files.find(value=>value.file_ref===input.file_ref.slice(7));
    if(!file)fail('EMAIL_DATA_SOURCE_CHANGED');
    return {bytes:result.bytes,media_type:file.media_type,filename:file.filename};
  }catch(error){result?.bytes?.fill(0);throw error;}
  finally{source?.mime_bytes?.fill(0);}
}
