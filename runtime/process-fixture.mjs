// Internal test bootstrap only. No provider override or Windows-fixture switch exists in production config.
import {readFile} from 'node:fs/promises';
import {startRuntime} from './server.mjs';
import {providerFixture, twoAccountProviderFixture} from './test-support.mjs';
const config = JSON.parse(await readFile(process.env.EMAIL_RUNTIME_CONFIG_FILE, 'utf8'));
const selectedProviderFixture = process.env.EMAIL_RUNTIME_FIXTURE_MODE === 'two-accounts' ? twoAccountProviderFixture() : providerFixture;
const fetch = async (url, options) => {
  process.send({event: 'provider_request'});
  if (process.env.EMAIL_RUNTIME_FIXTURE_MODE === 'hang-token' && url === 'https://oauth2.googleapis.com/token') {process.send({event: 'exchange_started'}); return new Promise(() => {});}
  return selectedProviderFixture(url, options);
};
const instance = await startRuntime(config, {allow_windows_fixture: true, allow_loopback_fixture: true, fetch});
process.send({port: instance.server.address().port});
process.on('message', async message => {if (message === 'shutdown') {await instance.close(); process.exit(0);}});
