import {createImapMoveAliases} from './imap-move-aliases.mjs';
import {resolveNativeImapSource} from './vendor/providers/native-imap-alias.mjs';
import {canonical,fail} from './contract.mjs';
import {resourceUuid} from './mailbox-store.mjs';
import {resolveProviderSource,providerSourceForParent} from './vendor/providers/provider-browser.mjs';
import {formReceiptDigest} from './connection-form-contract.mjs';
/** Accept only a runtime-owned row, verify the predecessor generation chain,
 * then nominate current custody ephemerally. Persisted source/origin stays exact. */
export async function currentImapOwnedSource({forms,session_id,scope,record,check,store}){
 const account=await forms.currentAccount(session_id,scope,check),owned={org_id:scope.org_id,owner_user_id:scope.owner_user_id,account_id:account.account_id},source=record?.provider_source;
 if(!source||canonical(record.scope)!==canonical(owned)||record.logical_message_id!==source.logical_message_id||record.record_id!==resourceUuid(owned,record.logical_message_id)||!Number.isSafeInteger(source.authority_epoch))fail('EMAIL_IMAP_SOURCE_DENIED');
 if(source.authority_epoch!==account.authority_epoch){const prior=account.lineage??[];if(prior.length!==account.custody_generation-1||prior.some((entry,index)=>entry.generation!==index+1||entry.receipt.custody_generation!==entry.generation||entry.receipt.account_ref!==account.account_id||entry.receipt.principal_digest!=='sha256:'+account.principal_digest||entry.receipt.digest!==formReceiptDigest(entry.receipt))||!prior.some(entry=>entry.generation===source.authority_epoch))fail('EMAIL_IMAP_SOURCE_DENIED');}
 const providerScope={org_id:scope.org_id,owner_id:scope.owner_user_id,installation_id:scope.installation_id},aliases=store?createImapMoveAliases({store}):null,currentSource=aliases?await aliases.resolve(owned,account,source,check):source,parent=await resolveNativeImapSource({scope:providerScope,account:{account_id:account.account_id,provider:'imap_smtp',authority_epoch:source.authority_epoch},source:currentSource,aliases:aliases?{lookup:locator=>aliases.lookup(owned,locator,check)}:null,check});await check();return providerSourceForParent({account_id:account.account_id,provider:'imap_smtp',authority_epoch:account.authority_epoch},parent);
}
