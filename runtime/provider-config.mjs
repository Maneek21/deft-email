import {isAbsolute} from 'node:path';
import {exact,fail} from './contract.mjs';
import {validateOAuthClient} from './vendor/providers/oauth-provider.mjs';

/** Deployment-only, one provider per process. Profile allowlist is explicit;
 * neither public request bodies nor credential files nominate registration. */
export async function resolveProviderConfig(config,registrations,readPrivate){
  if(typeof readPrivate!=='function'||!Array.isArray(registrations)||!registrations.length)fail('EMAIL_RUNTIME_CONFIG_INVALID');
  if(Object.hasOwn(config,'provider_config')){
    if(Object.hasOwn(config,'gmail_client_file'))fail('EMAIL_RUNTIME_CONFIG_INVALID');
    const selected=config.provider_config;exact(selected,['provider','client_file','profile_digests']);
    if(selected.provider!=='microsoft'||typeof selected.client_file!=='string'||!isAbsolute(selected.client_file)
      ||!Array.isArray(selected.profile_digests)||selected.profile_digests.length<1||selected.profile_digests.length>32
      ||selected.profile_digests.some(value=>!/^sha256:[a-f0-9]{64}$/u.test(value))
      ||new Set(selected.profile_digests).size!==selected.profile_digests.length
      ||registrations.some(row=>!selected.profile_digests.includes(row.profile_digest)))fail('EMAIL_RUNTIME_CONFIG_INVALID');
    return {provider:'microsoft',client:validateOAuthClient('microsoft',await readPrivate(selected.client_file))};
  }
  if(typeof config.gmail_client_file!=='string'||!isAbsolute(config.gmail_client_file))fail('EMAIL_RUNTIME_CONFIG_INVALID');
  return {provider:'gmail',client:validateOAuthClient('gmail',await readPrivate(config.gmail_client_file))};
}
