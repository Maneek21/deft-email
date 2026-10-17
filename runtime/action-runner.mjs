import {createMirrorRunner} from './mirror-runner.mjs';
import {createSendRunner} from './send-runner.mjs';
import {createOrganizeRunner} from './organize-runner.mjs';
import {fail} from './contract.mjs';
/** One claim consumer per explicitly issued action channel. Unknown operation
 * names never fall back to Send or infer authority from provider credentials. */
export function createAppActionRunner(options){
 const {runtime_client}=options,send=createSendRunner(options),organize=createOrganizeRunner(options),mirror=createMirrorRunner(options);
 const executeClaim=(claim,started,signal)=>claim.operation_name==='send_message'?send.executeClaim(claim,started,signal):claim.operation_name==='organize_messages'?organize.executeClaim(claim,started,signal):claim.operation_name==='mirror_drafts'?mirror.executeClaim(claim,started,signal):fail('EMAIL_RUNTIME_ACTION_UNSUPPORTED');
 return Object.freeze({executeClaim,async runOnce(signal){const claim=await runtime_client.claim({signal});if(!claim)return null;let result;try{const started=await runtime_client.start(claim,{signal});result=await executeClaim(claim,started,signal);}catch{result={status:'not_attempted',error_code:'APP_RUN_PROVIDER_UNAVAILABLE'};}await runtime_client.result(claim,result,{signal});return result;}});
}
