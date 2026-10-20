import {canonical, exact, fail, token, validateRegistration} from './contract.mjs';
import {trustedUrl} from './http.mjs';

// The Host delivers fresh channel sessions over its authenticated connection
// transport after a current owner asked to re-establish background access.
// Tokens never pass through people, agents or operator files.
export const CHANNEL_INSTALL_SCHEMA = 'deft.app_runtime_channel_install.v1';
export const CHANNEL_INSTALL_RESULT_SCHEMA = 'deft.app_runtime_channel_install_result.v1';
const STORE_KEY = 'email.runtime.installed_channels.v1';
const MAX_CHANNELS = 16;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const denied = () => fail('EMAIL_RUNTIME_CHANNEL_INSTALL_DENIED');

/** Validate one channel exactly like an operator channel file. */
export function validateInstalledChannel(entry, registrations, allow_loopback_fixture = false) {
  exact(entry, ['kind', 'channel']);
  const {kind, channel} = entry;
  if (kind === 'action') {
    exact(channel, ['channel_url', 'credential', 'registration', ...(Object.hasOwn(channel, 'technical_renewal') ? ['technical_renewal'] : [])]);
    exact(channel.registration, ['org_id', 'runtime_registration_id', 'runtime_epoch']);
    if (!uuid.test(channel.registration.org_id) || !uuid.test(channel.registration.runtime_registration_id)
      || !Number.isSafeInteger(channel.registration.runtime_epoch) || channel.registration.runtime_epoch < 1) denied();
    if (new URL(trustedUrl(channel.channel_url, allow_loopback_fixture)).pathname !== '/api/app-runtime/channel') denied();
  } else if (kind === 'observation') {
    exact(channel, ['channel_url', 'observation_authority_url', 'credential', 'registration', ...(Object.hasOwn(channel, 'technical_renewal') ? ['technical_renewal'] : [])]);
    const registration = validateRegistration(channel.registration);
    if (!registrations.some(({connection_protocol, ...value}) => canonical(value) === canonical(registration))) denied();
    const channel_url = new URL(trustedUrl(channel.channel_url, allow_loopback_fixture));
    const authority_url = new URL(trustedUrl(channel.observation_authority_url, allow_loopback_fixture));
    if (channel_url.origin !== authority_url.origin || channel_url.pathname !== '/api/app-resource-sync-channel/v3'
      || authority_url.pathname !== '/api/app-resource-observations/runtime') denied();
  } else denied();
  exact(channel.credential, ['session_id', 'session_token']);
  if (!uuid.test(channel.credential.session_id)) denied();
  token(channel.credential.session_token);
  // Installed sessions must keep themselves alive; a fixed lease would strand again.
  if (!Object.hasOwn(channel, 'technical_renewal')) denied();
  return {kind, channel: structuredClone(channel)};
}

/** One channel per kind and Runtime registration; a newer install replaces it. */
export const installedChannelKey = entry => entry.kind + ':' + entry.channel.registration.runtime_registration_id;

export function createChannelInstaller({store, registrations, allow_loopback_fixture = false, verify, activate}) {
  if (typeof verify !== 'function' || typeof activate !== 'function') fail('EMAIL_RUNTIME_CONFIG_INVALID');
  async function load() {
    const row = await store.withLock({key: STORE_KEY}, tx => tx.read());
    const channels = row?.value?.channels ?? [];
    return channels.map(entry => validateInstalledChannel(entry, registrations, allow_loopback_fixture));
  }
  async function request(input, signal) {
    exact(input, ['schema_version', 'scope', 'channels']);
    if (input.schema_version !== CHANNEL_INSTALL_SCHEMA || !Array.isArray(input.channels) || !input.channels.length || input.channels.length > MAX_CHANNELS) denied();
    // The Host addresses one reviewed connection registration of this Runtime.
    const scope = input.scope;
    if (!scope || typeof scope !== 'object' || !registrations.some(r => r.org_id === scope.org_id
      && r.runtime_registration_id === scope.runtime_registration_id && r.operator_user_id === scope.operator_user_id)) denied();
    const entries = input.channels.map(entry => validateInstalledChannel(entry, registrations, allow_loopback_fixture));
    if (entries.some(entry => entry.channel.registration.org_id !== scope.org_id)) denied();
    if (new Set(entries.map(installedChannelKey)).size !== entries.length) denied();
    // Prove each session is genuine before it is kept: only the Host can renew it.
    const verified = [];
    for (const entry of entries) { signal?.throwIfAborted(); verified.push({entry, verification: await verify(entry, signal)}); }
    for (const item of verified) item.entry.channel.technical_renewal = {...item.entry.channel.technical_renewal, expires_at: item.verification.renewal.expires_at};
    await store.withLock({key: STORE_KEY}, async tx => {
      signal?.throwIfAborted();
      const row = await tx.read(), kept = new Map((row?.value?.channels ?? []).map(entry => [installedChannelKey(entry), entry]));
      for (const {entry} of verified) kept.set(installedChannelKey(entry), entry);
      if (!await tx.compareAndSwap({expected_revision: row?.revision ?? null, value: {schema_version: 'email.runtime.installed_channels.v1', channels: [...kept.values()]}})) fail('EMAIL_RUNTIME_CONFLICT');
    });
    await activate(verified);
    return {schema_version: CHANNEL_INSTALL_RESULT_SCHEMA, installed: verified.map(({entry, verification}) => ({
      kind: entry.kind, runtime_registration_id: entry.channel.registration.runtime_registration_id,
      session_id: entry.channel.credential.session_id, expires_at: verification.renewal.expires_at}))};
  }
  return Object.freeze({load, request});
}
