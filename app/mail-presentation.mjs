// Inbox summaries identify the sender once; the reader keeps the full headers.
// This formats an already loaded string and does not resolve mailbox identities.
export function senderDisplay(value){
 const source=String(value??'').trim();
 const mailbox=/^(.*?)\s*<([^<>]+)>$/.exec(source);
 if(!mailbox)return source;
 const address=mailbox[2].trim();
 const name=mailbox[1].trim().replace(/^"((?:[^"\\]|\\.)*)"$/,(_match,text)=>text.replace(/\\(["\\])/g,'$1')).trim();
 return name&&name.toLowerCase()!==address.toLowerCase()?name:address;
}
