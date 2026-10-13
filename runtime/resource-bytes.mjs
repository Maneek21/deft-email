import {createHash} from 'node:crypto';
import {fail} from './contract.mjs';
import {inspectEmailSourceFiles} from './vendor/providers/incoming-source-files.mjs';
import {fetchPublicMessageImage} from './vendor/providers/remote-image-proxy.mjs';
import {NATIVE_INCOMING_LIMITS} from './vendor/providers/contract.mjs';

/** One current, scoped native MIME read. Frozen part references bind the exact
 * source digest and part/source nomination; no presentation prefetch is needed.
 * Neither a browser URL nor a caller-supplied provider locator enters this port. */
export async function readResourceBytes({bridge,provider_source,input,operation,context,check,imageDependencies}){
  const isImage=operation==='resource_read_image',ref=isImage?'image_ref':'file_ref';
  if(!['resource_read_file','resource_read_image'].includes(operation)||!/^sha256:[a-f0-9]{64}$/u.test(input[ref]??''))fail('EMAIL_DATA_INPUT_INVALID');
  let source,result;
  try{
    source=await bridge.nativeEmailSource({source:provider_source},context);
    if(source.account_id!==context.account_id||source.provider!==provider_source.provider||!(source.mime_bytes instanceof Uint8Array)||source.mime_bytes.length<1||source.mime_bytes.length>NATIVE_INCOMING_LIMITS.source_bytes||createHash('sha256').update(source.mime_bytes).digest('hex')!==source.digest)fail('EMAIL_DATA_SOURCE_CHANGED');
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
