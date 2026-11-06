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
 * action (kind, label and any valid optional id) or null. The Host sends ids
 * only when it can point at the exact installation, target or consent, so a
 * bare `review_consent` is valid and unknown extra fields are ignored. */
export function parseNextStep(body){
 const step=body?.details?.next_step;
 if(!step||typeof step!=='object'||Array.isArray(step))return null;
 if(!NEXT_STEP_KINDS.includes(step.kind))return null;
 const valid=(field,value)=>field==='target_key'?key(value):hostUuid(value);
 for(const field of ['installation_id','target_key','consent_id'])if(step[field]!==undefined&&!valid(field,step[field]))return null;
 const action=NEXT_STEP_ACTIONS[step.kind],result={kind:action.kind,label:action.label};
 for(const field of ['installation_id','target_key','consent_id'])if(step[field]!==undefined)result[field]=step[field];
 return result;
}

/** Map a runtime provider/custody failure code to a recoverable action. Reauth
 * needs a reconnect; a transient custody outage is retryable, never reconnect. */
export function actionForRuntimeError(code){
 if(code==='EMAIL_PROVIDER_REAUTH_REQUIRED')return {kind:'reconnect',label:'Reconnect'};
 if(code==='EMAIL_OAUTH_CUSTODY_UNAVAILABLE')return {kind:'retry',label:'Retry'};
 return null;
}
