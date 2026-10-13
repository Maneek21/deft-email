import {canonical,fail} from './contract.mjs';
import {lineageKey,validateLineage} from './account-lineage.mjs';
/** Capture before native I/O, then check under every existing custody read
 * including refresh reads. Never recursively acquire custody from fetch. */
export async function fenceCredentialGeneration({store,custody,session}){
 const lineage=(await store.withLock({key:lineageKey(session.binding)},tx=>tx.read()))?.value;
 if(lineage)validateLineage(lineage,session);
 const record=await custody.withAccount(session.binding,tx=>tx.read()),generation=session.purpose_set?.custody_generation??record?.setup_generation;
 const verify=value=>{if(!value||!Number.isSafeInteger(generation)||generation<1||value.setup_generation!==generation||canonical(value.binding)!==canonical(session.binding)||value.secret?.client_fingerprint!==session.client_fingerprint)fail('EMAIL_RUNTIME_CREDENTIAL_GENERATION_DENIED');return value;};verify(record);
 return {...custody,withAccount(binding,work){return custody.withAccount(binding,tx=>work({...tx,read(){return verify(tx.read());}}));}};
}
