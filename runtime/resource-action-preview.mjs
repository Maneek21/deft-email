import {fail} from './contract.mjs';
const status=(read,starred,folder='Current folder')=>`${folder}; ${read?'read':'unread'}; ${starred?'starred':'not starred'}`;
/** Human review uses closed provider state, never opaque folder IDs/ETags/UIDs. */
export function providerActionPreview(before,operation){
 const kind=before?.locator?.kind;
 if(!['microsoft','imap_smtp'].includes(kind))return null;
 let read,starred;
 if(kind==='microsoft'){if(typeof before.seen!=='boolean'||!['notFlagged','flagged','complete'].includes(before.flag?.flagStatus))fail('EMAIL_RESOURCE_PLAN_DENIED');read=before.seen;starred=before.flag.flagStatus==='flagged';}
 else{if(!Array.isArray(before.flags))fail('EMAIL_RESOURCE_PLAN_DENIED');read=before.flags.includes('\\Seen');starred=before.flags.includes('\\Flagged');}
 const from=status(read,starred,kind==='imap_smtp'?'Current mailbox':'Current folder');
 if(operation==='mark_read')read=true;if(operation==='mark_unread')read=false;if(operation==='star')starred=true;if(operation==='unstar')starred=false;
 const folder=operation==='archive'?'Archive':operation==='trash'?'Trash':kind==='imap_smtp'?'Current mailbox':'Current folder';
 return {before:from,after:status(read,starred,folder)};
}
