import {createHash} from 'node:crypto';

export const fail = code => { throw Object.assign(new Error(code), {code}); };
export const canonical = value => JSON.stringify(sort(value));
function sort(value) { return Array.isArray(value) ? value.map(sort) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value; }
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
export function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail('EMAIL_RUNTIME_INPUT_INVALID');
  return value;
}
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value);
const key = value => typeof value === 'string' && /^[a-z][a-z0-9_]{0,47}$/u.test(value) && !['constructor', 'prototype', '__proto__'].includes(value);
const hash = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
const epoch = value => Number.isInteger(value) && value >= 0 && value <= 2147483647;
export const isoTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString().slice(0, 19) === value.slice(0, 19);
export const opaque = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,512}$/u.test(value);
const scopeIds = ['org_id', 'owner_user_id', 'installation_id', 'app_version_id', 'grant_snapshot_id', 'resource_binding_id', 'runtime_registration_id', 'operator_user_id'];
const scopeKeys = [...scopeIds, 'package_digest', 'grant_snapshot_digest', 'lifecycle_epoch', 'grant_epoch', 'target_key', 'resource_key', 'runtime_epoch', 'profile_digest', 'consent_expires_at'];
export function validateScope(scope) {
  exact(scope, scopeKeys);
  if (scopeIds.some(field => !uuid(scope[field])) || ['package_digest', 'grant_snapshot_digest', 'profile_digest'].some(field => !hash(scope[field])) || ['lifecycle_epoch', 'grant_epoch', 'runtime_epoch'].some(field => !epoch(scope[field])) || !key(scope.target_key) || !key(scope.resource_key) || !isoTime(scope.consent_expires_at)) fail('EMAIL_RUNTIME_INPUT_INVALID');
  return structuredClone(scope);
}
/** Wire projection of frozen E1 AppConnectionRuntimeRequestSchema. No provider options or owner credentials can enter. */
export function validateRequest(input) {
  const common = ['schema_version', 'session_id', 'scope', 'expires_at', 'operation'];
  const additional = {begin: ['callback_state'], callback: ['runtime_session_ref', 'callback'], status: ['runtime_session_ref', 'expected_account_ref'], disconnect: ['runtime_session_ref', 'expected_account_ref']}[input?.operation];
  if (!additional) fail('EMAIL_RUNTIME_INPUT_INVALID');
  const actionFields=['begin','callback'].includes(input?.operation)&&Object.hasOwn(input,'action_consent')?['action_consent']:[];
  exact(input, [...common, ...additional,...actionFields]);
  if (input.schema_version !== 'deft.app_connection_runtime.v1' || !uuid(input.session_id) || !isoTime(input.expires_at)) fail('EMAIL_RUNTIME_INPUT_INVALID');
  validateScope(input.scope);
  if(actionFields.length){const consent=input.action_consent;exact(consent,['action_binding_id','action_key','authority_epoch','consent_id','consent_digest','expires_at']);if(!uuid(consent.action_binding_id)||!uuid(consent.consent_id)||!key(consent.action_key)||!epoch(consent.authority_epoch)||!hash(consent.consent_digest)||!isoTime(consent.expires_at)||Date.parse(consent.expires_at)<=Date.now()||Date.parse(consent.expires_at)>Date.parse(input.scope.consent_expires_at))fail('EMAIL_RUNTIME_INPUT_INVALID');}
  if (input.operation === 'begin') { if (!/^[A-Za-z0-9_-]{43}$/u.test(input.callback_state ?? '')) fail('EMAIL_RUNTIME_INPUT_INVALID'); }
  else if (!opaque(input.runtime_session_ref)) fail('EMAIL_RUNTIME_INPUT_INVALID');
  if (input.operation === 'callback') {
    if (!['authorized', 'denied'].includes(input.callback?.outcome)) fail('EMAIL_RUNTIME_INPUT_INVALID');
    exact(input.callback, input.callback.outcome === 'authorized' ? ['outcome', 'code'] : ['outcome']);
    if (input.callback.outcome === 'authorized' && (typeof input.callback.code !== 'string' || input.callback.code.length < 1 || input.callback.code.length > 4096 || /[\u0000-\u0020\u007f]/u.test(input.callback.code))) fail('EMAIL_RUNTIME_INPUT_INVALID');
  }
  if (['status', 'disconnect'].includes(input.operation) && input.expected_account_ref !== null && !opaque(input.expected_account_ref)) fail('EMAIL_RUNTIME_INPUT_INVALID');
  return structuredClone(input);
}
export function validateRegistration(value) {
  const fields = ['org_id', 'runtime_registration_id', 'operator_user_id', 'runtime_epoch', 'profile_digest', 'target_key', 'resource_key'];
  exact(value, fields);
  if (fields.filter(field => field.endsWith('_id')).some(field => !uuid(value[field])) || !epoch(value.runtime_epoch) || !hash(value.profile_digest) || !key(value.target_key) || !key(value.resource_key)) fail('EMAIL_RUNTIME_CONFIG_INVALID');
  return structuredClone(value);
}
export function token(value) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43,256}$/u.test(value)) fail('EMAIL_RUNTIME_CONFIG_INVALID'); return value; }
