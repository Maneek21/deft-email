import tls from 'node:tls';
import {readFile} from 'node:fs/promises';
export const ca=await readFile(new URL('./test-fixtures/ca.pem',import.meta.url));
export async function moveServer(){
 const sockets=new Set(),state={flags:[],modseq:1,uidvalidity:'1',condstore:true,enable:true,nomodseq:false,readonly:false,dropAck:false,stores:0,reads:0,commands:[],move:true,uidplus:true,moves:0,dropMoveAck:false,missingArchive:false,ambiguousArchive:false,destinationValidity:'2',location:'INBOX',uid:1};
 const server=tls.createServer({key:await readFile(new URL('./test-fixtures/server-key.pem',import.meta.url)),cert:await readFile(new URL('./test-fixtures/server.pem',import.meta.url))},socket=>{
  sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));let selected='INBOX';socket.write('* OK flags fixture\r\n');let buffer='';
  socket.on('data',bytes=>{buffer+=bytes.toString();while(buffer.includes('\r\n')){const at=buffer.indexOf('\r\n'),line=buffer.slice(0,at);buffer=buffer.slice(at+2);state.commands.push(line.replace(/LOGIN.*/i,'LOGIN redacted'));const tag=line.split(' ')[0],op=line.split(' ')[1]?.toUpperCase(),reply=value=>socket.write(tag+' '+value+'\r\n');
   if(op==='CAPABILITY'){socket.write('* CAPABILITY IMAP4rev1 NAMESPACE'+(state.condstore?' CONDSTORE'+(state.enable?' ENABLE':''):'')+(state.move?' MOVE':'')+(state.uidplus?' UIDPLUS':'')+'\r\n');reply('OK capability');}
   else if(op==='ENABLE'){socket.write('* ENABLED CONDSTORE\r\n');reply('OK enable');}
   else if(op==='LOGIN'||op==='AUTHENTICATE')reply('OK authenticated');
   else if(op==='LIST'||op==='LSUB'){socket.write('* LIST () "/" "INBOX"\r\n'+(state.missingArchive?'':'* LIST (\\Archive) "/" "Archive Local"\r\n')+'* LIST (\\Trash) "/" "Trash Local"\r\n'+(state.ambiguousArchive?'* LIST (\\Archive) "/" "Other Archive"\r\n':''));reply('OK list');}
   else if(op==='SELECT'||op==='EXAMINE'){selected=/"([^"]+)"/.exec(line)?.[1]??line.split(' ')[2];socket.write('* FLAGS (\\Seen \\Flagged)\r\n* OK [PERMANENTFLAGS (\\Seen \\Flagged)] flags\r\n* '+(selected===state.location?1:0)+' EXISTS\r\n* OK [UIDVALIDITY '+(selected==='INBOX'?state.uidvalidity:state.destinationValidity)+'] validity\r\n* OK [UIDNEXT 100] next\r\n'+(state.nomodseq?'* OK [NOMODSEQ] none\r\n':state.condstore?'* OK [HIGHESTMODSEQ '+state.modseq+'] modseq\r\n':''));reply('OK ['+(state.readonly?'READ-ONLY':'READ-WRITE')+'] selected');}
   else if(op==='UID'&&/\bFETCH\b/i.test(line)){state.reads++;if(selected!==state.location||Number(/FETCH (\d+)/i.exec(line)?.[1])!==state.uid){reply('OK absent');continue;}socket.write('* 1 FETCH (UID '+state.uid+' FLAGS ('+state.flags.join(' ')+')'+(state.nomodseq?'':' MODSEQ ('+state.modseq+')')+')\r\n');reply('OK fetch');}
   else if(op==='UID'&&/\bMOVE\b/i.test(line)){state.moves++;const from=state.uid,dest=/MOVE \d+ \"([^\"]+)\"/i.exec(line)?.[1];if(!dest){reply('NO destination');continue;}state.location=dest;state.uid=99;if(state.dropMoveAck){socket.destroy();continue;}reply('OK [COPYUID '+state.destinationValidity+' '+from+' 99] moved');}
   else if(op==='UID'&&/\bSTORE\b/i.test(line)){state.stores++;const match=/UNCHANGEDSINCE (\d+)/i.exec(line);if(!match||Number(match[1])!==state.modseq){reply('OK [MODIFIED 1] conflict');continue;}state.flags=[...new Set(line.match(/\\Seen|\\Flagged/g)??[])];state.modseq++;if(state.dropAck){socket.destroy();continue;}socket.write('* 1 FETCH (UID 1 FLAGS ('+state.flags.join(' ')+')'+(state.nomodseq?'':' MODSEQ ('+state.modseq+')')+')\r\n');reply('OK store');}
   else if(op==='LOGOUT'){socket.write('* BYE fixture\r\n');reply('OK logout');socket.end();}
   else if(op==='NAMESPACE'){socket.write('* NAMESPACE (("" "/")) NIL NIL\r\n');reply('OK namespace');}else reply('OK fixture');
  }});
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {port:server.address().port,state,async close(){for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
