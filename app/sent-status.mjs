const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value);
/** Only an exact retained Run receipt can supply delivery/copy wording. */
export function sentReceiptNotice(result,runId){
 if(!uuid(runId)||result?.id!==runId)throw Error('Send status could not be verified');
 if(!['succeeded','failed','cancelled'].includes(result.state))return 'The outcome is not yet confirmed. Check status again; do not send another copy.';
 if(result.state==='cancelled')return 'This request was cancelled. Check Activity for its recorded outcome.';
 const output=result.output;
 if(!output||output.operation_id!==runId||!['accepted','rejected'].includes(output.primary_outcome)||(output.primary_outcome==='accepted')!==(result.state==='succeeded'))return 'The current delivery receipt is unavailable. Check Activity; do not infer delivery from the saved draft.';
 if(output.primary_outcome==='rejected')return 'The mail provider rejected this Send. No recipient delivery is confirmed.';
 const copy={provider_managed:'The mail server manages the Sent copy; a copy is not confirmed.',completed:'An exact Sent copy was confirmed.',unknown:'The Sent-copy outcome is unknown. No copy will be retried automatically.',not_attempted:'The Sent copy was not saved. Do not resend the email to create a copy.',not_applicable:'The mail provider manages its Sent folder.'}[output.effect_outcome];
 return 'The mail provider accepted this email. '+(copy??'Sent-copy status is unavailable.')+' Recipient delivery is not confirmed.';
}
