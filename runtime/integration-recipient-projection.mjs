import {exact,fail} from './contract.mjs';
const address=/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/u;
/** Called only after the runner validates provider acceptance. Values come from
 * its immutable prepared payload, never the later editable draft. */
export function acceptedRecipientMetadata({payload,installation_id,run_id,snapshot_id,accepted_at}){
 if(payload?.scope?.installation_id!==installation_id||typeof accepted_at!=='string'||!Number.isFinite(Date.parse(accepted_at)))fail('EMAIL_RECIPIENT_METADATA_DENIED');
 const recipients=[];for(const row of [...(payload.to??[]),...(payload.cc??[]),...(payload.bcc??[])]){
  if(typeof row?.address!=='string'||row.address.length>320||!address.test(row.address)||typeof row.display_name!=='string'||row.display_name.length>512)fail('EMAIL_RECIPIENT_METADATA_DENIED');
  if(!recipients.some(v=>v.address.toLowerCase()===row.address.toLowerCase()))recipients.push({address:row.address,name:row.display_name});
 }
 if(recipients.length>200)fail('EMAIL_RECIPIENT_METADATA_DENIED');
 return {schema_version:'email.accepted_recipient_metadata.v1',installation_id,run_id,snapshot_id,accepted_at,recipients};
}
/** Bound to current account read authority by the signed internal wrapper.
 * A record without the new atomic metadata projection is unavailable history. */
export async function recentAcceptedSuggestions({installation_id,input,readBounded,check}){
 exact(input,['query','limit']);if(typeof input.query!=='string'||input.query.length<1||input.query.length>240||/[\x00-\x1f\x7f]/u.test(input.query)||!Number.isInteger(input.limit)||input.limit<1||input.limit>10)fail('EMAIL_RECIPIENT_INPUT_INVALID');
 await check();const rows=await readBounded(50);if(!Array.isArray(rows)||rows.length>50)fail('EMAIL_RECIPIENT_METADATA_DENIED');
 const items=[],query=input.query.toLowerCase();let available=false;
 for(const row of rows){if(row.send_effect?.state!=='accepted')continue;const metadata=row.accepted_recipient_metadata;
  if(!metadata)continue;if(metadata.schema_version!=='email.accepted_recipient_metadata.v1'||metadata.installation_id!==installation_id||metadata.run_id!==row.send_effect.run_id||!Array.isArray(metadata.recipients)||metadata.recipients.length>200)fail('EMAIL_RECIPIENT_METADATA_DENIED');available=true;
  for(const item of metadata.recipients){if(typeof item.address!=='string'||!address.test(item.address)||typeof item.name!=='string')fail('EMAIL_RECIPIENT_METADATA_DENIED');if(!item.address.toLowerCase().includes(query)&&!item.name.toLowerCase().includes(query))continue;if(!items.some(v=>v.address.toLowerCase()===item.address.toLowerCase()))items.push({address:item.address,name:item.name,provenance:['recent'],accepted_at:metadata.accepted_at});}
 }
 await check();return {schema_version:'email.recipient_suggestions.v1',items:items.slice(0,input.limit),recent_status:available?'available':'unavailable',partial:true,has_more:items.length>input.limit};
}
