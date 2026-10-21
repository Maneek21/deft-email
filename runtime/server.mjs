import {createCredentialRepairPorts} from './credential-repair-ports.mjs';
import {CHANNEL_INSTALL_SCHEMA,createChannelInstaller,installedChannelKey} from './installed-channels.mjs';
import {createRuntimeChannelRenewal} from './runtime-channel-renewal.mjs';
import {createLifecycleFetch} from './lifecycle-fetch.mjs';
import {createMirrorClient} from './mirror-client.mjs';
import {createMirrorCoordinator} from './mirror-coordinator.mjs';
import {createLocalJobRuntime} from './local-job-runtime.mjs';
import {createLocalJobClient,createLocalJobRunner} from './local-job-client.mjs';
import {createRegistrationContinuity} from './registration-continuity.mjs';
import {createBackgroundAccessReconciler} from './background-access-reconciler.mjs';
import {createServer} from 'node:http';
import {runPollingWorker} from './polling-worker.mjs';
import {open} from 'node:fs/promises';
import {constants as C} from 'node:fs';
import {isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createDurableStore} from './durable-store.mjs';
import {createRegistrationDispatcher, validateRegistrations} from './registration-dispatch.mjs';
import {createDeclaredIntegrationToolsRuntime} from './declared-integration-tools.mjs';
import {createDataRuntime} from './data-runtime.mjs';
import {createAppActionRunner} from './action-runner.mjs';
import {createResourceObservationRunner,createResourceObservationPoller} from './observation-runner.mjs';
import {createAppRuntimeClient,createDeftResourceSyncClientV3,createResourceObservationClient} from '@deft/app-kit';
import {createAuthorityClient, createHttpHandler,trustedUrl} from './http.mjs';
import {exact, fail,canonical,validateRegistration} from './contract.mjs';
import {resolveProviderConfig} from './provider-config.mjs';

export async function readOperatorJson(path, allow_windows_fixture = false) {
  if (typeof path !== 'string' || !isAbsolute(path) || process.platform === 'win32' && !allow_windows_fixture) fail('EMAIL_RUNTIME_SECRET_FILE_INVALID');
  const handle = await open(path, C.O_RDONLY | (C.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16384 || process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)) fail('EMAIL_RUNTIME_SECRET_FILE_INVALID');
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}

export async function startRuntime(config, options = {}) {
  if(config?.provider_config?.provider==='imap_smtp')return (await import('./imap-server.mjs')).startFormRuntime(config,options);
  const stopped=new AbortController();
  options={...options,channelFetch:createLifecycleFetch(stopped.signal,options.channelFetch)};
  const registrationField = Object.hasOwn(config, 'registration') ? 'registration' : 'registrations';
  const integrationFields=Object.hasOwn(config,'integration_tool_authority_url')?['integration_tool_authority_url']:[];
  const dataFields=Object.hasOwn(config,'data_authority_url')?['data_authority_url']:[];
  const channelFields=Object.hasOwn(config,'runtime_channel_files')?['runtime_channel_files']:[];
  const continuationFields=Object.hasOwn(config,'consent_continuation_authority_url')?['consent_continuation_authority_url']:[];
  const reattachFields=Object.hasOwn(config,'reattach_authority_url')?['reattach_authority_url']:[];
  const v2Fields=Object.hasOwn(config,'authority_v2_url')?['authority_v2_url']:[],upgradeFields=Object.hasOwn(config,'upgrade_authority_url')?['upgrade_authority_url']:[];
  const mirrorFields=Object.hasOwn(config,'record_mirror_channel_url')?['record_mirror_channel_url']:[];
  const localJobFields=Object.hasOwn(config,'local_job_channel_url')?['local_job_channel_url']:[];
  const observationFields=Object.hasOwn(config,'resource_sync_channel_files')?['resource_sync_channel_files']:[];
  const providerFields=Object.hasOwn(config,'provider_config')?['provider_config']:['gmail_client_file'];
  exact(config, ['listen_port', 'store_root', 'key_id', 'encryption_key_hex', 'runtime_auth_token', 'authority_token', 'authority_url', registrationField, ...providerFields,...dataFields,...integrationFields,...channelFields,...reattachFields,...continuationFields,...observationFields,...v2Fields,...upgradeFields,...localJobFields,...mirrorFields]);
  if(integrationFields.length){if(!config.data_authority_url)fail('EMAIL_INTEGRATION_CONFIG_INVALID');const integrationUrl=trustedUrl(config.integration_tool_authority_url,options.allow_loopback_fixture??false);if(new URL(integrationUrl).pathname!=='/api/app-integration-tools/runtime/authority'||new URL(integrationUrl).origin!==new URL(config.data_authority_url).origin)fail('EMAIL_INTEGRATION_CONFIG_INVALID');}
  if(channelFields.length&&(!dataFields.length||!Array.isArray(config.runtime_channel_files)||config.runtime_channel_files.length<1||config.runtime_channel_files.length>32||new Set(config.runtime_channel_files).size!==config.runtime_channel_files.length))fail('EMAIL_RUNTIME_CONFIG_INVALID');
  if(observationFields.length&&(!Array.isArray(config.resource_sync_channel_files)||config.resource_sync_channel_files.length<1||config.resource_sync_channel_files.length>32||new Set(config.resource_sync_channel_files).size!==config.resource_sync_channel_files.length))fail('EMAIL_RUNTIME_CONFIG_INVALID');
  if (!Number.isInteger(config.listen_port) || config.listen_port < 0 || config.listen_port > 65535 || !/^[a-f0-9]{64}$/iu.test(config.encryption_key_hex ?? '')) fail('EMAIL_RUNTIME_CONFIG_INVALID');
  const registrations = validateRegistrations(registrationField === 'registration' ? [config.registration] : config.registrations);
  const {provider,client}=await resolveProviderConfig(config,registrations,path=>readOperatorJson(path,options.allow_windows_fixture??false));
  const encryption_key = Buffer.from(config.encryption_key_hex, 'hex');
  const store = await createDurableStore({root: config.store_root, encryption_key, key_id: config.key_id, allow_windows_fixture: options.allow_windows_fixture ?? false});
  try {
    const continuity=await createRegistrationContinuity({registrations,store}),getRegistrations=continuity.all;
    const assertCurrent = createAuthorityClient({authority_url: config.authority_url, authority_token: config.authority_token, allow_loopback_fixture: options.allow_loopback_fixture ?? false});
    const assertContinuationCurrent=config.consent_continuation_authority_url?createAuthorityClient({authority_url:config.consent_continuation_authority_url,authority_token:config.authority_token,allow_loopback_fixture:options.allow_loopback_fixture??false}):undefined;
    const assertReattachCurrent=config.reattach_authority_url?createAuthorityClient({authority_url:config.reattach_authority_url,authority_token:config.authority_token,allow_loopback_fixture:options.allow_loopback_fixture??false}):undefined;
    const assertV2Current=config.authority_v2_url?createAuthorityClient({authority_url:config.authority_v2_url,authority_token:config.authority_token,allow_loopback_fixture:options.allow_loopback_fixture??false}):undefined,assertUpgradeCurrent=config.upgrade_authority_url?createAuthorityClient({authority_url:config.upgrade_authority_url,authority_token:config.authority_token,allow_loopback_fixture:options.allow_loopback_fixture??false}):undefined;
    const runtime = createRegistrationDispatcher({registrations,registrationContinuity:continuity, client, provider, store, encryption_key, key_id: config.key_id, assertCurrent, assertReattachCurrent,assertContinuationCurrent,assertV2Current,assertUpgradeCurrent,fetch: options.fetch});
    const dataCurrent=config.data_authority_url?createAuthorityClient({authority_url:config.data_authority_url,authority_token:config.authority_token,allow_loopback_fixture:options.allow_loopback_fixture??false}):undefined;
    const localJobClient=config.local_job_channel_url?createLocalJobClient({channel_url:config.local_job_channel_url,authority_token:config.authority_token,fetch:options.channelFetch,allow_loopback_fixture:options.allow_loopback_fixture??false}):undefined;
    const local_job_runtime=localJobClient?createLocalJobRuntime({registrations,getRegistrations,client,provider,store,encryption_key,key_id:config.key_id,assertInteractive:localJobClient.interactive,assertJob:localJobClient.authorize,assertVisibility:localJobClient.visibility}):undefined;
    const local_job_runner=localJobClient?createLocalJobRunner({runtime:local_job_runtime,client:localJobClient,onDiagnostic:options.localJobDiagnostic}):undefined;
    let data_runtime=config.data_authority_url?createDataRuntime({registrations,getRegistrations,client,provider,store,encryption_key,key_id:config.key_id,assertCurrent:createAuthorityClient({authority_url:config.data_authority_url,authority_token:config.authority_token,allow_loopback_fixture:options.allow_loopback_fixture??false}),fetch:options.fetch,imageDependencies:options.imageDependencies,preparedActions:options.preparedActions}):undefined;
    const integration_tool_runtime=integrationFields.length?createDeclaredIntegrationToolsRuntime({createDataRuntime:({assertCurrent})=>createDataRuntime({registrations,getRegistrations,client,provider,store,encryption_key,key_id:config.key_id,assertCurrent,fetch:options.fetch,imageDependencies:options.imageDependencies,preparedActions:options.preparedActions}),assertCurrent:createAuthorityClient({authority_url:config.integration_tool_authority_url,authority_token:config.authority_token,allow_loopback_fixture:options.allow_loopback_fixture??false,maximum_bytes:614400})}):undefined;
    if(local_job_runtime&&data_runtime){const request=data_runtime.request;data_runtime=Object.freeze({...data_runtime,request:async(raw,signal,bytes)=>local_job_runtime.project(raw,await request(raw,signal,bytes),dataCurrent,signal)});}
    const mirror_client=mirrorFields.length?createMirrorClient({channel_url:config.record_mirror_channel_url,authority_token:config.authority_token,fetch:options.channelFetch,allow_loopback_fixture:options.allow_loopback_fixture??false}):undefined;
    const mirror_coordinator=mirror_client?createMirrorCoordinator({store,client,mirror_client,provider,encryption_key,key_id:config.key_id,fetch:options.fetch}):undefined;
    if(mirror_coordinator&&data_runtime){const request=data_runtime.request;data_runtime=Object.freeze({...data_runtime,request:async(raw,signal,bytes)=>{const result=await request(raw,signal,bytes);if(raw.input?.store_key==='drafts'&&result.outcome==='completed')try{await mirror_coordinator.observe(raw.scope);}catch{options.mirrorDiagnostic?.('EMAIL_MIRROR_HINT_UNAVAILABLE');}return result;}});}
    const channel_renewals=[],channel_sessions=new Map(),send_runners=[],observation_runners=[];
    let channelOwners={};
    const activeChannels=new Map(),runnerStops=new WeakMap();
    const replaceChannel=(channel,renewal,kind,runner)=>{
      const key=kind+':'+channel.registration.runtime_registration_id,prior=activeChannels.get(key);
      if(prior){prior.renewal.close?.();prior.stop.abort();channel_sessions.delete(prior.session_id);
        const list=kind==='action'?send_runners:observation_runners,index=list.indexOf(prior.runner);if(index>=0)list.splice(index,1);
        const at=channel_renewals.findIndex(item=>item.session_id===prior.session_id);if(at>=0)channel_renewals.splice(at,1);}
      const stop=new AbortController();runnerStops.set(runner,stop);
      activeChannels.set(key,{renewal,runner,stop,session_id:channel.credential.session_id});
    };
    const allow_loopback=options.allow_loopback_fixture??false;
    const actionRenewal=channel=>{exact(channel,['channel_url','credential','registration',...(Object.hasOwn(channel,'technical_renewal')?['technical_renewal']:[])]);exact(channel.credential,['session_id','session_token']);const runtime_client=createAppRuntimeClient({channel_url:trustedUrl(channel.channel_url,allow_loopback),credential:channel.credential,fetch:options.channelFetch});return {renewal:createRuntimeChannelRenewal({channel,runtime_client})};};
    const observationParts=channel=>{exact(channel,['channel_url','observation_authority_url','credential','registration',...(Object.hasOwn(channel,'technical_renewal')?['technical_renewal']:[])]);exact(channel.credential,['session_id','session_token']);
      const registration=validateRegistration(channel.registration);if(!getRegistrations().some(({connection_protocol,...value})=>canonical(value)===canonical(registration)))fail('EMAIL_OBSERVATION_CONFIG_INVALID');
      const channel_url=trustedUrl(channel.channel_url,allow_loopback),authority_url=trustedUrl(channel.observation_authority_url,allow_loopback);
      if(new URL(channel_url).origin!==new URL(authority_url).origin||new URL(channel_url).pathname!=='/api/app-resource-sync-channel/v3'||new URL(authority_url).pathname!=='/api/app-resource-observations/runtime')fail('EMAIL_OBSERVATION_CONFIG_INVALID');
      const {observation_authority_url,...renewalChannel}=channel,resourceClient=createDeftResourceSyncClientV3({channel_url,credential:channel.credential,fetch:options.channelFetch});
      return {registration,authority_url,renewal:createRuntimeChannelRenewal({channel:renewalChannel,runtime_client:{...resourceClient,renew:(input,signal)=>resourceClient.renew(input,{signal})}})};};
    const track=(channel,renewal,kind)=>{const id=channel.credential.session_id;if(channel_sessions.has(id)&&(kind==='observation'||renewal.renewable||channel_sessions.get(id)))fail('EMAIL_RUNTIME_RENEWAL_CONFIG_INVALID');channel_sessions.set(id,renewal.renewable);const entry=renewal.renewable?{session_id:id,renewal,kind}:null;if(entry)channel_renewals.push(entry);return entry;};
    const addAction=(channel,{renewal})=>{const entry=track(channel,renewal,'action'),runner=createAppActionRunner({runtime_client:renewal.client,registration:channel.registration,client,provider,store,encryption_key,key_id:config.key_id,fetch:options.fetch});replaceChannel(channel,renewal,'action',runner);send_runners.push(runner);return {entry,runner};};
    const addObservation=(channel,{registration,authority_url,renewal})=>{const entry=track(channel,renewal,'observation'),observation_client=createResourceObservationClient({channel_url:authority_url,credential:channel.credential,fetch:options.channelFetch});
      const runner=createResourceObservationRunner({repairContinuity:createCredentialRepairPorts({store,registration}).repairContinuity,runtime_client:renewal.client,observation_client,registration:channel.registration,client,provider,store,encryption_key,key_id:config.key_id,fetch:options.fetch});replaceChannel(channel,renewal,'observation',runner);observation_runners.push(runner);return {entry,runner};};
    // Sessions the Host installed replace operator-file channels for the same registration.
    let startInstalled=null;
    const installer=createChannelInstaller({store,registrations,getRegistrations,allow_loopback_fixture:allow_loopback,
      verify:async(entry,signal)=>{const parts=entry.kind==='action'?actionRenewal(entry.channel):observationParts(entry.channel);if(!parts.renewal.renewable||!await parts.renewal.renew(signal))fail('EMAIL_RUNTIME_CHANNEL_INSTALL_DENIED');return parts;},
      activate:async verified=>{channelOwners=await installer.owners();if(!startInstalled)fail('EMAIL_RUNTIME_CHANNEL_INSTALL_DENIED');for(const {entry,verification} of verified)startInstalled(entry.kind,entry.kind==='action'?addAction(entry.channel,verification):addObservation(entry.channel,verification));}});
    channelOwners=await installer.owners();
    const installed=await installer.load(),superseded=new Set(installed.map(installedChannelKey));
    for(const path of config.runtime_channel_files??[]){const channel=await readOperatorJson(path,options.allow_windows_fixture??false);if(superseded.has('action:'+channel?.registration?.runtime_registration_id))continue;addAction(channel,actionRenewal(channel));}
    for(const path of config.resource_sync_channel_files??[]){const channel=await readOperatorJson(path,options.allow_windows_fixture??false);if(superseded.has('observation:'+channel?.registration?.runtime_registration_id))continue;addObservation(channel,observationParts(channel));}
    for(const entry of installed)entry.kind==='action'?addAction(entry.channel,actionRenewal(entry.channel)):addObservation(entry.channel,observationParts(entry.channel));
    const requests=new Set();
    const connection_runtime=Object.freeze({...runtime,request:(input,signal,bytes)=>input?.schema_version===CHANNEL_INSTALL_SCHEMA?installer.request(input,signal):runtime.request(input,signal,bytes)});
    const handler=createHttpHandler({runtime:connection_runtime,data_runtime,local_job_runtime,integration_tool_runtime,runtime_auth_token:config.runtime_auth_token,shutdown_signal:stopped.signal});
    const server=createServer((request,response)=>{
      const pending=handler(request,response).catch(()=>response.destroy());
      requests.add(pending);void pending.finally(()=>requests.delete(pending));
    });
    server.headersTimeout = 10000; server.requestTimeout = 30000; server.timeout = 35000;
    await new Promise((done, reject) => {server.once('error', reject); server.listen(config.listen_port, '127.0.0.1', done);});
    const worker=(runner,waitMs,maxWaitMs=waitMs)=>runPollingWorker(runner,{signal:runnerStops.has(runner)?AbortSignal.any([stopped.signal,runnerStops.get(runner).signal]):stopped.signal,waitMs,maxWaitMs});
    const background_reconciler=createBackgroundAccessReconciler({registrations,getRegistrations:continuity.current,authority_url:config.authority_url,authority_token:config.authority_token,
      fetch:options.channelFetch,allow_loopback_fixture:allow_loopback,
      needsReconcile:registration=>{const id=registration.runtime_registration_id;
        const channels=[...activeChannels.entries()].filter(([key])=>key.endsWith(':'+id)||channelOwners[key]===id);
        const unknownFailure=[...activeChannels.entries()].some(([key,item])=>key.startsWith('action:')&&!channelOwners[key]&&['denied','expired'].includes(item.renewal.state));
        return unknownFailure||channels.length===0||channels.some(([,item])=>!item.renewal.renewable||['denied','expired'].includes(item.renewal.state));},
      acknowledged:async(_registration,items)=>{const installed=await installer.load();return items.every(item=>installed.some(entry=>entry.kind===item.kind&&entry.channel.registration.runtime_registration_id===item.runtime_registration_id&&entry.channel.credential.session_id===item.session_id));}});
    const initialWorkers=[...(options.start_background_reconciler===false||options.start_observation_workers===false&&options.start_send_workers===false?[]:[background_reconciler.run(stopped.signal)]),...channel_renewals.filter(({kind})=>kind==='observation'?options.start_observation_workers!==false:options.start_send_workers!==false).map(({renewal})=>renewal.run(stopped.signal)),...(mirror_coordinator&&options.start_mirror_worker!==false?[worker(mirror_coordinator,5000)]:[]),...(local_job_runner&&options.start_local_job_worker!==false?[worker(local_job_runner,5000)]:[]),...(options.start_send_workers===false?[]:send_runners.map(runner=>worker(runner,500,5000))),...(options.start_observation_workers===false||!observation_runners.length?[]:[worker(createResourceObservationPoller(observation_runners),5000)])];
    const workers=new Set();
    const keepWorker=promise=>{workers.add(promise);void promise.then(()=>workers.delete(promise),()=>workers.delete(promise));};
    for(const promise of initialWorkers)keepWorker(promise);
    let observationPolling=options.start_observation_workers!==false&&observation_runners.length>0;
    startInstalled=(kind,{entry,runner})=>{if(stopped.signal.aborted){entry?.renewal.close();return;}const enabled=kind==='observation'?options.start_observation_workers!==false:options.start_send_workers!==false;if(!enabled)return;
      if(entry)keepWorker(entry.renewal.run(stopped.signal));
      if(kind==='action')keepWorker(worker(runner,500,5000));
      else if(!observationPolling){observationPolling=true;keepWorker(worker(createResourceObservationPoller(observation_runners),5000));}};
    let closing;
    const phase=value=>{try{(options.onShutdown??(entry=>console.error(JSON.stringify(entry))))({event:'email_runtime_shutdown',phase:value});}catch{}};
    return {server, store, background_reconciler, data_runtime,integration_tool_runtime, mirror_coordinator,send_runners, observation_runners, local_job_runtime,local_job_runner, close() {return closing??=(async()=>{phase('admission_closed');const drained=new Promise(done=>server.close(done));stopped.abort();server.closeAllConnections();for(const {renewal}of channel_renewals)renewal.close();await Promise.all(workers);phase('workers_drained');
      // Socket closure does not mean the handler has finished its durable work.
      // Keep the writer lease until both handlers and transports have settled.
      await Promise.all(requests);await drained;phase('http_drained');data_runtime?.close?.();await store.close();encryption_key.fill(0);phase('writer_released');})();}};
  } catch (error) { stopped.abort();await store.close(); encryption_key.fill(0); throw error; }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const path = process.env.EMAIL_RUNTIME_CONFIG_FILE; if (!path) fail('EMAIL_RUNTIME_CONFIG_INVALID');
    const instance = await startRuntime(await readOperatorJson(path));
    process.stdout.write(JSON.stringify({event: 'email_runtime_listening', port: instance.server.address().port}) + '\n');
    let closing = false;
    const close = async () => { if (closing) return; closing = true; await instance.close(); process.exitCode = 0; };
    process.on('SIGINT', close); process.on('SIGTERM', close);
    process.on('message', message => { if (message === 'shutdown') close(); });
  } catch { process.stderr.write('EMAIL_RUNTIME_STARTUP_FAILED\n'); process.exitCode = 1; }
}

