import {canonical,digest,exact,fail} from './contract.mjs';
import {nativeScope,writeNativeImportRow} from './native-adoption-records.mjs';
import {validateEmailScope} from './vendor/account-registry.mjs';
import {validateOAuthBinding} from './vendor/providers/oauth-contract.mjs';
import {resolveProviderSource,providerSourceForParent} from './vendor/providers/provider-browser.mjs';
import {nativeContinuityEpochs} from './native-adoption-continuity.mjs';
export const nativeAdoptionKey=scope=>'email.data.native_adoption.'+digest(nativeScope(scope));
const identityKey=scope=>'email.data.native_identity.'+digest(nativeScope(scope));
export function nativeIdentity(scope,source_binding,destination_binding,snapshot_digest){
 scope=nativeScope(scope);source_binding=validateOAuthBinding(source_binding);destination_binding=validateOAuthBinding(destination_binding);
 if(!/^[a-f0-9]{64}$/.test(snapshot_digest)||source_binding.provider!=='gmail'||destination_binding.provider!=='gmail'||[source_binding,destination_binding].some(binding=>binding.scope.org_id!==scope.org_id||binding.scope.owner_id!==scope.owner_user_id||binding.account_id!==scope.account_id)||destination_binding.capabilities.some(capability=>!['read','search','thread'].includes(capability)))fail('EMAIL_NATIVE_IMPORT_BINDING_INVALID');
 return {schema_version:'email.native_identity.v1',scope,source_binding,destination_binding,snapshot_digest};
}
export async function importNativeIdentity(store,value,check){const valid=nativeIdentity(value.scope,value.source_binding,value.destination_binding,value.snapshot_digest);await writeNativeImportRow(store,identityKey(valid.scope),valid,check);}
export async function readNativeIdentity(store,scope,binding,check,session){
 scope=nativeScope(scope);await check();const row=await store.withLock({key:identityKey(scope)},tx=>tx.read());if(!row){if(await store.withLock({key:nativeAdoptionKey(scope)},tx=>tx.read()))fail('EMAIL_NATIVE_ADOPTION_NOT_VERIFIED');return null;}
 const value=row.value,valid=nativeIdentity(value.scope,value.source_binding,value.destination_binding,value.snapshot_digest);
 const receipt=(await store.withLock({key:nativeAdoptionKey(scope)},tx=>tx.read()))?.value;
 if(canonical(value)!==canonical(valid)||canonical(value.scope)!==canonical(scope)||receipt?.state!=='staged_verified'||receipt.snapshot_digest!==value.snapshot_digest)fail('EMAIL_NATIVE_ADOPTION_NOT_VERIFIED');
 if(canonical(value.destination_binding)!==canonical(binding)){if(canonical(session?.binding)!==canonical(binding))fail('EMAIL_NATIVE_ADOPTION_NOT_VERIFIED');await nativeContinuityEpochs({store,scope,session,original_binding:value.destination_binding});}
 await check();return valid;
}
export function createNativeIdentityScopeResolver({store,scope,binding,check,session}){return async()=>{const proof=await readNativeIdentity(store,scope,binding,check,session);return proof?validateEmailScope(proof.source_binding.scope):validateEmailScope(binding.scope);};}
export async function resolveNativeOwnedSource({store,scope,binding,record,check,session}){
 const proof=await readNativeIdentity(store,scope,binding,check,session);if(!proof)return null;
 const epochs=session?await nativeContinuityEpochs({store,scope,session,original_binding:proof.destination_binding}):[binding.authority_epoch];
 const source=record.provider_source;
 if(canonical(record.scope)!==canonical(scope)||record.logical_message_id!==source?.logical_message_id||![proof.source_binding.authority_epoch,...epochs].includes(source.authority_epoch))fail('EMAIL_NATIVE_SOURCE_DENIED');
 const parent=resolveProviderSource({scope:proof.source_binding.scope,account:{...binding,authority_epoch:source.authority_epoch},source});await check();return providerSourceForParent(binding,parent);
}
