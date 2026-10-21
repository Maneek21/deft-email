import {createConsentContinuationRuntime} from './connection-consent-continuation-runtime.mjs';
import {CONTINUATION_VERSION,validateContinuationRequest} from './consent-continuation-contract.mjs';
import {createConnectionRuntime} from './connection-runtime.mjs';
import {canonical, fail, validateRegistration, validateRequest} from './contract.mjs';
import {createReattachRuntime} from './connection-reattach-runtime.mjs';
import {REATTACH_VERSION,REATTACH_V2_VERSION,validateReattachRequest} from './reattach-contract.mjs';
import {createUpgradeRuntime} from './connection-upgrade-runtime.mjs';
import {UPGRADE_VERSION,validateUpgradeRequest} from './upgrade-contract.mjs';
import * as Kit from '@deft/app-kit/core';
import {createCredentialRepairRuntime} from './connection-credential-repair-runtime.mjs';
import {createCredentialRepairPorts} from './credential-repair-ports.mjs';
import {REPAIR_VERSION,validateRepairRequest} from './credential-repair-contract.mjs';

const identity = registration => canonical([registration.org_id, registration.runtime_registration_id]);
export function validateRegistrations(values) {
  if (!Array.isArray(values) || values.length < 1 || values.length > 32) fail('EMAIL_RUNTIME_CONFIG_INVALID');
  const registrations = values.map(value=>{const {connection_protocol,...pins}=value;const registration=validateRegistration(pins);if(connection_protocol!==undefined&&connection_protocol!=='v2')fail('EMAIL_RUNTIME_CONFIG_INVALID');return {...registration,...(connection_protocol?{connection_protocol}: {})};}), seen = new Set();
  for (const registration of registrations) {
    const key = identity(registration);
    if (seen.has(key)) fail('EMAIL_RUNTIME_CONFIG_INVALID');
    seen.add(key);
  }
  return registrations;
}
/** Explicit operator data, one current set of pins per registration. All engines
 * share the process's single durable store writer and private Google client. */
export function createRegistrationDispatcher({registrations: values, registrationContinuity, ...dependencies}) {
  const registrations = validateRegistrations(values);
  const engineFor=row=>{const {connection_protocol,...registration}=row;return {
    registration,protocol:connection_protocol??'v1', runtime: createConnectionRuntime({...dependencies, registration,protocol:connection_protocol??'v1',assertCurrent:connection_protocol?dependencies.assertV2Current:dependencies.assertCurrent}),
    continuation:connection_protocol&&dependencies.assertContinuationCurrent?createConsentContinuationRuntime({...dependencies,registration,assertCurrent:dependencies.assertContinuationCurrent}):null,
    upgrade:connection_protocol&&dependencies.assertUpgradeCurrent?createUpgradeRuntime({...dependencies,registration,assertCurrent:dependencies.assertUpgradeCurrent}):null,
    repair:connection_protocol&&dependencies.assertUpgradeCurrent?createCredentialRepairRuntime({...dependencies,...createCredentialRepairPorts({...dependencies,registration}),...(dependencies.repairPorts??{}),registration,assertCurrent:dependencies.assertUpgradeCurrent}):null,
    reattach: dependencies.assertReattachCurrent?createReattachRuntime({...dependencies,registration,assertCurrent:dependencies.assertReattachCurrent}):null
  };};
  const selected=new Map(registrations.map(row=>[identity(row),engineFor(row)]));
  return Object.freeze({async request(raw, signal) {
    const repair=raw?.schema_version===REPAIR_VERSION,continuation=raw?.schema_version===CONTINUATION_VERSION,upgrade=raw?.schema_version===UPGRADE_VERSION,v2=raw?.schema_version==='deft.app_connection_runtime.v2',reattachV2=raw?.schema_version===REATTACH_V2_VERSION,reattach=raw?.schema_version===REATTACH_VERSION||reattachV2,input = repair?validateRepairRequest(raw):continuation?validateContinuationRequest(raw):upgrade?validateUpgradeRequest(raw):reattach?validateReattachRequest(raw):v2?(Kit.AppConnectionRuntimeV2RequestSchema?.safeParse(raw).success?structuredClone(raw):fail('EMAIL_RUNTIME_INPUT_INVALID')):validateRequest(raw), enrolled=registrationContinuity?.all().find(r=>identity(r)===identity(input.scope)), known=selected.get(identity(input.scope))??(enrolled?engineFor(enrolled):null), successor=!known&&reattachV2&&registrationContinuity?registrationContinuity.candidate(input):null, engine=known??(successor?{registration:(({connection_protocol,...r})=>r)(successor),protocol:'v2',reattach:createReattachRuntime({...dependencies,registration:(({connection_protocol,...r})=>r)(successor),assertCurrent:dependencies.assertReattachCurrent})}:null);
    if (!engine || Object.keys(engine.registration).some(field => engine.registration[field] !== input.scope[field])) fail('EMAIL_RUNTIME_REGISTRATION_DENIED');
    if(repair&&(!engine.repair||engine.protocol!=='v2')||continuation&&(!engine.continuation||engine.protocol!=='v2')||upgrade&&(!engine.upgrade||engine.protocol!=='v2')||(v2||reattachV2)&&engine.protocol!=='v2'||!repair&&!v2&&!reattachV2&&!upgrade&&!continuation&&engine.protocol!=='v1')fail('EMAIL_RUNTIME_REGISTRATION_DENIED');
    if(reattach&&!engine.reattach)fail('EMAIL_RUNTIME_REGISTRATION_DENIED');
    const result=await (repair?engine.repair:continuation?engine.continuation:upgrade?engine.upgrade:reattach?engine.reattach:engine.runtime).request(input, signal);
    if(reattachV2&&registrationContinuity&&!registrations.some(row=>identity(row)===identity(input.scope)))await registrationContinuity.record(input,result);
    return result;
  }});
}
