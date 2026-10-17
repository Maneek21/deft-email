import {canonical,digest,fail} from './contract.mjs';
import {nativeScope} from './native-adoption-records.mjs';
import {lineageKey,validateLineage} from './account-lineage.mjs';
const read=async(store,key)=>(await store.withLock({key},tx=>tx.read()))?.value;
/** Current authority may advance only through the complete retained receipt chain. */
export async function nativeContinuityEpochs({store,scope,session,original,original_binding}){
 if(!original){const journal=await read(store,'email.native.activation.'+digest(nativeScope(scope)));if(journal?.state!=='active')fail('EMAIL_NATIVE_ACTIVATION_NOT_VISIBLE');original={...journal.session,state:'connected'};}
 if(!session)fail('EMAIL_NATIVE_ACTIVATION_NOT_VISIBLE');
 if(original_binding&&canonical(original.binding)!==canonical(original_binding))fail('EMAIL_NATIVE_ACTIVATION_NOT_VISIBLE');
 if(canonical(original)===canonical(session))return [original.binding.authority_epoch];
 const lineage=await read(store,lineageKey(session.binding));validateLineage(lineage,session);
 if(lineage.base.session_id!==original.session_id||canonical(lineage.base.binding)!==canonical(original.binding)
  ||lineage.base.custody_generation!==original.purpose_set.custody_generation||!lineage.receipts.length
  ||canonical(session.binding.scope)!==canonical(original.binding.scope)||session.binding.account_id!==original.binding.account_id
  ||session.scope.target_key!==original.scope.target_key||session.scope.resource_key!==original.scope.resource_key
  ||session.scope.operator_user_id!==original.scope.operator_user_id||canonical(session.account)!==canonical(original.account)
  ||canonical(lineage.receipts[0].pins.source.scope)!==canonical(original.scope)
  ||lineage.receipts[0].pins.source.runtime_session_ref!==original.runtime_session_ref
  ||canonical(await read(store,'email.runtime.session.'+original.session_id))!==canonical(original))fail('EMAIL_NATIVE_ACTIVATION_NOT_VISIBLE');
 return lineage.epochs;
}
