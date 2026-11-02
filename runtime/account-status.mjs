import {actionForRuntimeError} from './action-error.mjs';

// Honest connection status wording. Reauth and custody states are runtime
// observations (`EMAIL_PROVIDER_REAUTH_REQUIRED`,
// `EMAIL_OAUTH_CUSTODY_UNAVAILABLE`) that are never written back to the Host
// session record, so a re-read context can still say `connected` while every
// provider call is failing. This helper reports the runtime observation instead.
export const CONNECTION_STATUS_LABELS=Object.freeze({
 connected:'Connected',
 reauth_required:'Needs reconnect',
 custody_unavailable:'Temporarily unavailable',
 revoked:'Access revoked',
 unavailable:'Unavailable',
});

/** Re-read the Host connection context and derive an honest status. `readContext`
 * returns the fresh context (or a value); `options.last_observation` is the last
 * runtime provider/custody failure code, if any. */
export async function checkConnectionStatus(readContext,options={}){
 const context=await readContext();
 const last=options.last_observation??null;
 const action=actionForRuntimeError(last);
 if(action?.kind==='reconnect')return {state:'reauth_required',label:CONNECTION_STATUS_LABELS.reauth_required,action:'reconnect'};
 if(action?.kind==='retry')return {state:'custody_unavailable',label:CONNECTION_STATUS_LABELS.custody_unavailable,action:'retry'};
 const state=context?.state??context?.health??null;
 return {state,label:CONNECTION_STATUS_LABELS[state]??'Status unavailable',action:null};
}
