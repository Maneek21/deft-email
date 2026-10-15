import {assertNoCredentialRepair,wrapCredentialProviderBridge} from './credential-repair-reservation.mjs';
import {randomBytes, randomUUID} from 'node:crypto';
import {createEmailOAuth as createUnfencedEmailOAuth} from './vendor/providers/oauth-account.mjs';
const createEmailOAuth=options=>wrapCredentialProviderBridge({bridge:createUnfencedEmailOAuth(options),store:options.store,scope:options.repair_scope});
import {createEncryptedEmailCustody} from './vendor/providers/custody-encrypted.mjs';
import {validateOAuthClient, oauthClientFingerprint} from './vendor/providers/oauth-provider.mjs';
import {consentDeadline,canonical, digest, exact, fail, isoTime, validateRegistration, validateRequest} from './contract.mjs';
import {reserveTarget,endTarget} from './target-reservation.mjs';
import * as Kit from '@deft/app-kit';
import {capabilitiesFor,credentialAnchor,sealPurposeSet} from './purpose-set.mjs';

const started = new Set(['begin_started', 'callback_started', 'disconnect_started']);
/** Frozen provider engine, independent app custody, public host authority only. */
export function createConnectionRuntime({registration: rawRegistration, client, provider = 'gmail', store, encryption_key, key_id, assertCurrent, fetch: fetchImpl = globalThis.fetch, now = Date.now,protocol='v1'}) {
  const registration = validateRegistration(rawRegistration);if(!['v1','v2'].includes(protocol))fail('EMAIL_RUNTIME_CONFIG_INVALID');const v2=protocol==='v2';
  const actions=request=>v2?request.action_consents:(request.action_consent?[request.action_consent]:[]);
  const validate=raw=>{if(!v2)return validateRequest(raw);if(!Kit.AppConnectionRuntimeV2RequestSchema?.safeParse(raw).success)fail('EMAIL_RUNTIME_INPUT_INVALID');capabilitiesFor(raw.action_consents);return structuredClone(raw);};
  if(!['gmail','microsoft'].includes(provider))fail('EMAIL_RUNTIME_CONFIG_INVALID');
  client = validateOAuthClient(provider, client);
  const client_fingerprint = oauthClientFingerprint(provider, client);
  if (typeof assertCurrent !== 'function') fail('EMAIL_RUNTIME_AUTHORITY_PORT_REQUIRED');
  const custody = createEncryptedEmailCustody({encryption_key, key_id, store, now});
  const registrationKey = 'email.runtime.registration.' + digest([registration.org_id, registration.runtime_registration_id, registration.runtime_epoch, registration.profile_digest]);
  async function bindRegistrationClient(check) {
    await store.withLock({key: registrationKey}, async tx => {
      await check(); const row = await tx.read();
      if (row) {
        if (row.value?.schema_version !== 'email.runtime.registration_client.v1' || canonical(row.value.registration) !== canonical(registration) || row.value.client_fingerprint !== client_fingerprint) fail('EMAIL_RUNTIME_CLIENT_REGISTRATION_CHANGED');
      } else {
        const value = {schema_version: 'email.runtime.registration_client.v1', registration, client_fingerprint};
        if (!await tx.compareAndSwap({expected_revision: null, value})) fail('EMAIL_RUNTIME_CONFLICT');
      }
      await check();
    });
  }
  function checker(request, signal) {
    let deadline = Math.min(Date.parse(request.expires_at), consentDeadline(request.scope,'consent_expires_at'), v2?(['begin','callback'].includes(request.operation)?Math.min(...actions(request).map(a=>consentDeadline(a))):Infinity):request.action_consent?consentDeadline(request.action_consent):Infinity, now() + 30000);
    const expiry = new AbortController();
    const combinedSignal = AbortSignal.any([signal, expiry.signal].filter(Boolean));
    let timer;
    const arm = () => {clearTimeout(timer); timer = setTimeout(() => expiry.abort(new Error('EMAIL_RUNTIME_AUTHORITY_EXPIRED')), Math.max(0, deadline - now())); timer.unref();};
    arm();
    const check = async () => {
      combinedSignal.throwIfAborted();
      if (deadline <= now() || Object.keys(registration).some(field => registration[field] !== request.scope[field])) fail('EMAIL_RUNTIME_AUTHORITY_DENIED');
      const expected={schema_version: v2?'deft.app_connection_runtime_authority.v2':'deft.app_connection_runtime_authority.v1', session_id: request.session_id, scope: request.scope, operation: request.operation, expires_at: new Date(deadline).toISOString(),...(v2?{action_consents:request.action_consents}:request.action_consent?{action_consent:request.action_consent}:{})};
      const current = await assertCurrent(expected, combinedSignal);
      exact(current, [...Object.keys(expected),'allowed']);
      if (current.schema_version !== expected.schema_version || current.session_id !== request.session_id || current.operation !== request.operation || current.allowed !== true || canonical(current.scope) !== canonical(request.scope) || canonical(v2?current.action_consents:current.action_consent??null)!==canonical(v2?request.action_consents:request.action_consent??null) || !isoTime(current.expires_at) || Date.parse(current.expires_at) <= now() || Date.parse(current.expires_at) > deadline) fail('EMAIL_RUNTIME_AUTHORITY_DENIED');
      deadline = Math.min(deadline, Date.parse(current.expires_at)); arm(); combinedSignal.throwIfAborted(); return deadline;
    };
    return {check, signal: combinedSignal, dispose: () => clearTimeout(timer)};
  }
  async function execute(raw, signal) {
    const request = validate(raw), guard = checker(request, signal), check = guard.check;
    signal = guard.signal;
    try {
    await check();
    return await store.withLock({key: 'email.runtime.session.' + request.session_id}, async tx => {
      let row = await tx.read(), record = row?.value; if(request.operation!=='status')await assertNoCredentialRepair({store,scope:request.scope});
      await check();
      const persist = async value => { if (!await tx.compareAndSwap({expected_revision: row?.revision ?? null, value})) fail('EMAIL_RUNTIME_CONFLICT'); row = await tx.read(); record = row.value; };
      if (record && (canonical(record.scope) !== canonical(request.scope) || record.session_id !== request.session_id)) fail('EMAIL_RUNTIME_AUTHORITY_DENIED');
      if(record&&request.operation==='callback'&&canonical(v2?record.action_consents:record.action_consent??null)!==canonical(v2?request.action_consents:request.action_consent??null))fail('EMAIL_RUNTIME_AUTHORITY_DENIED');
      if (request.operation !== 'begin' && (!record || record.runtime_session_ref !== request.runtime_session_ref)) fail('EMAIL_RUNTIME_SESSION_DENIED');
      if (['status', 'disconnect'].includes(request.operation) && (record.account?.account_ref ?? null) !== request.expected_account_ref) fail('EMAIL_RUNTIME_ACCOUNT_DENIED');
      if (record && record.client_fingerprint !== client_fingerprint) {
        await persist({...record, state: 'indeterminate'}); await check(); return {state: 'indeterminate'};
      }
      if (request.operation === 'begin' && record) return {state: 'indeterminate'}; // begin identity is never replayed, even after a lost URL response.
      if (record && started.has(record.state)) { await persist({...record, state: 'indeterminate'}); await check(); return {state: 'indeterminate'}; }
      if (request.operation === 'callback' && (record.state !== 'awaiting_callback' || record.callback_expires_at <= now())) {
        if (record.state === 'indeterminate') return {state: 'indeterminate'};
        fail('EMAIL_RUNTIME_CALLBACK_REPLAY');
      }
      if (request.operation === 'begin') {
        // Bind this independently operated registration before its first session.
        // A new session UUID cannot bypass a changed provider-client identity.
        await bindRegistrationClient(check);
        await reserveTarget({store,request,kind:'oauth',check,now});
        const account_id=randomUUID();
        record = {session_id: request.session_id, scope: request.scope, ...(v2?{action_consents:request.action_consents}: {action_consent:request.action_consent??null}), client_fingerprint, runtime_session_ref: randomBytes(32).toString('base64url'), binding: {
          scope: {org_id: request.scope.org_id, owner_id: request.scope.owner_user_id, installation_id: request.scope.installation_id}, account_id, provider, connection_target: request.scope.target_key,
          resource_binding_id: request.scope.resource_binding_id, action_binding_id:v2?(request.action_consents.length?credentialAnchor(account_id):null):request.action_consent?.action_binding_id??null, authority_epoch: 1, capabilities: v2?capabilitiesFor(request.action_consents):['read','search','thread',...(request.action_consent?['send']:[])]
        }, state: 'begin_started', account: null, provider_state: null, callback_expires_at: Math.min(now() + 600000, consentDeadline(request.scope,'consent_expires_at'))};
        if(v2)record.purpose_set=sealPurposeSet(record.binding,record.action_consents,1);await persist(record);
      }
      const binding = record.binding, browserBinding = 'email.runtime.session:' + request.session_id;
      const oauth = createEmailOAuth({store,repair_scope:request.scope,clients: {[provider]: client}, custody, now, fetch: async (url, options) => {
        await check();
        const signals = [signal, options.signal].filter(Boolean);
        return fetchImpl(url, {...options, signal: signals.length ? AbortSignal.any(signals) : undefined});
      }, host: {
        async resolveAccount(input) { await check(); if (canonical(input.scope) !== canonical(binding.scope) || input.account_id !== binding.account_id || !['connect', 'disconnect'].includes(input.purpose)) fail('EMAIL_RUNTIME_AUTHORITY_DENIED'); return structuredClone(binding); },
        async assertAuthority() { return {allowed: true, expires_at: await check()}; }
      }});
      try {
        if (request.operation === 'begin') {
          const result = await oauth.begin({scope: binding.scope, account_id: binding.account_id, browser_binding: browserBinding});
          const url = new URL(result.authorization_url), provider_state = url.searchParams.get('state'); url.searchParams.set('state', request.callback_state);
          await check(); await persist({...record, state: 'awaiting_callback', provider_state}); await check();
          return {state: 'awaiting_callback', runtime_session_ref: record.runtime_session_ref, authorization_url: url.href};
        }
        if (request.operation === 'callback') {
          await persist({...record, state: 'callback_started'}); // durable before state consumption or provider I/O
          if (request.callback.outcome === 'denied') {
            await custody.takeState({scope: binding.scope, state: record.provider_state, browser_binding: browserBinding});
            await persist({...record, state: 'not_connected', provider_state: null}); await endTarget({store,request,check});await check(); return {state: 'not_connected'};
          }
          const account = await oauth.complete({scope: binding.scope, state: record.provider_state, browser_binding: browserBinding, code: request.callback.code});
          const publicAccount = {account_ref: binding.account_id, label: account.primary_address};
          await check(); await persist({...record, state: 'connected', provider_state: null, account: publicAccount}); await check(); return {state: 'connected', account: publicAccount};
        }
        if (request.operation === 'disconnect') {
          if (record.state === 'indeterminate') return {state: 'indeterminate'};
          await persist({...record, state: 'disconnect_started'});
          await oauth.disconnect({scope: binding.scope, account_id: binding.account_id});
          await persist({...record, state: 'disconnected', provider_state: null, account: null});await endTarget({store,request,check}); await check(); return {state: 'disconnected'};
        }
        await check();
        return record.state === 'connected' ? {state: 'connected', account: record.account} : record.state === 'awaiting_callback' ? {state: 'not_connected'} : {state: record.state};
      } catch (error) {
        // Any started operation remains uncertain across timeout/process loss. Never erase tokens/receipts or start a fresh effect identity here.
        if (started.has(record.state)) await persist({...record, state: 'indeterminate'});
        throw error;
      }
    });
    } finally { guard.dispose(); }
  }
  return Object.freeze({request: execute});
}


