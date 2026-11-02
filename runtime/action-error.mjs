import {hostUuid} from './contract.mjs';

// Host 403 / APP_REVIEW_REQUIRED / APP_ACCESS_DENIED bodies may carry an
// enum-typed `details.next_step`. This parser accepts only the fixed kind enum
// and id/key-shaped pins; free text and any extra field are dropped so no raw
// provider or callback data ever reaches an Email-facing action.

const key=value=>typeof value==='string'&&/^[a-z][a-z0-9_]{0,47}$/u.test(value);

export const NEXT_STEP_KINDS=Object.freeze(['reconnect','restore_access','review_consent']);
export const NEXT_STEP_ACTIONS=Object.freeze({
 reconnect:Object.freeze({kind:'reconnect',label:'Reconnect'}),
 restore_access:Object.freeze({kind:'restore_access',label:'Restore access'}),
 review_consent:Object.freeze({kind:'review_consent',label:'Review access'}),
});

/** Parse `details.next_step` out of a Host error body. Returns a validated
 * action (kind, label, installation_id, target_key) or null. */
export function parseNextStep(body){
 const step=body?.details?.next_step;
 if(!step||typeof step!=='object'||Array.isArray(step))return null;
 if(Object.keys(step).some(field=>!['kind','installation_id','target_key'].includes(field)))return null;
 if(!NEXT_STEP_KINDS.includes(step.kind)||!hostUuid(step.installation_id)||!key(step.target_key))return null;
 const action=NEXT_STEP_ACTIONS[step.kind];
 return {kind:action.kind,label:action.label,installation_id:step.installation_id,target_key:step.target_key};
}

/** Map a runtime provider/custody failure code to a recoverable action. Reauth
 * needs a reconnect; a transient custody outage is retryable, never reconnect. */
export function actionForRuntimeError(code){
 if(code==='EMAIL_PROVIDER_REAUTH_REQUIRED')return {kind:'reconnect',label:'Reconnect'};
 if(code==='EMAIL_OAUTH_CUSTODY_UNAVAILABLE')return {kind:'retry',label:'Retry'};
 return null;
}
