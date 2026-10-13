import {canonical,digest,exact,fail} from './contract.mjs';
import {parseEmailCalendarInvitations,selectEmailInvitationAttendee,serializeEmailInvitationReply} from './integration-calendar-parser.mjs';
const sha=v=>typeof v==='string'&&/^sha256:[a-f0-9]{64}$/u.test(v);
/** App-owned closed record intent. All invitation/sender metadata is derived
 * from exact governed bytes; no public calendar_reply field is accepted. */
export async function deriveCalendarRsvp({value,source_refs,resource_key,read,check,now=Date.now}){
 exact(value,['record_intent','file_ref','invitation_digest','response']);
 if(value.record_intent!=='calendar_rsvp'||!sha(value.file_ref)||!sha(value.invitation_digest)||!['accepted','tentative','declined'].includes(value.response)||!Array.isArray(source_refs)||source_refs.length!==1)fail('EMAIL_CALENDAR_INTENT_INVALID');
 const ref=source_refs[0];exact(ref,['resource_key','record_id','content_digest']);if(ref.resource_key!==resource_key||!sha(ref.content_digest))fail('EMAIL_CALENDAR_SOURCE_DENIED');
 await check();const source=await read(ref);await check();
 if(source.status!=='available'||!/^[a-f0-9]{64}$/u.test(source.source_digest)||!Array.isArray(source.parts)||source.parts.length>8||!source.receiving_identity?.primary_address)fail('EMAIL_CALENDAR_SOURCE_DENIED');
 const parts=source.parts.filter(part=>'sha256:'+part.file_ref===value.file_ref);if(parts.length!==1)fail('EMAIL_CALENDAR_FILE_DENIED');
 const parsed=parseEmailCalendarInvitations({...parts[0],source_digest:source.source_digest});if(parsed.status!=='parsed')fail('EMAIL_CALENDAR_'+parsed.reason);
 const invitations=parsed.items.filter(i=>'sha256:'+i.content_digest===value.invitation_digest);if(invitations.length!==1)fail('EMAIL_CALENDAR_INVITATION_DENIED');
 const invitation=invitations[0],attendee=selectEmailInvitationAttendee(invitation,[source.receiving_identity.primary_address]);
 if(!attendee||invitation.method!=='REQUEST'||invitation.rrule||invitation.exdates.length)fail('EMAIL_CALENDAR_RECEIVER_DENIED');
 const calendar_reply={method:'REPLY',ics_text:serializeEmailInvitationReply(invitation,[attendee.address],value.response,new Date(now()))};
 const content={mode:'compose',to:invitation.organizer.address,cc:'',bcc:'',subject:value.response+': '+invitation.summary,body:'Calendar response: '+value.response,body_html:'',reply_record_id:'',attachments:[],from_identity:{address:attendee.address}};
 const origin={...ref,source_digest:'sha256:'+source.source_digest,calendar_intent:{...value},calendar_identity:digest([invitation.uid,invitation.sequence,invitation.organizer.address,attendee.address]),notice:'Calendar response draft; Send requires a separate review.'};
 await check();return {value:content,origin,calendar_reply};
}
export async function assertCalendarRsvpCurrent({record,resource_key,read,check}){
 if(!record.calendar_reply)return;
 const origin=record.origin;if(!origin?.calendar_intent||origin.resource_key!==resource_key)fail('EMAIL_CALENDAR_SOURCE_DENIED');
 const current=await deriveCalendarRsvp({value:origin.calendar_intent,source_refs:[{resource_key:origin.resource_key,record_id:origin.record_id,content_digest:origin.content_digest}],resource_key,read,check});
 if(current.origin.source_digest!==origin.source_digest||current.origin.calendar_identity!==origin.calendar_identity||canonical(current.value)!==canonical(record.content))fail('EMAIL_CALENDAR_SOURCE_CHANGED');
 // DTSTAMP is the immutable draft's original stamp, not a new preparation.
 const old=record.calendar_reply.ics_text.replace(/^DTSTAMP:.*\r?$/gmu,'DTSTAMP:'),fresh=current.calendar_reply.ics_text.replace(/^DTSTAMP:.*\r?$/gmu,'DTSTAMP:');if(old!==fresh||record.calendar_reply.method!=='REPLY')fail('EMAIL_CALENDAR_SOURCE_CHANGED');
 await check();
}
