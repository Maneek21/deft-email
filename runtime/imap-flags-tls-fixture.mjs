import tls from 'node:tls';
import {readFile} from 'node:fs/promises';
export const ca=await readFile(new URL('./test-fixtures/ca.pem',import.meta.url));
export async function flagsServer(){
 const sockets=new Set(),state={flags:[],modseq:1,uidvalidity:'1',condstore:true,enable:true,nomodseq:false,readonly:false,dropAck:false,stores:0,reads:0,commands:[]};
 const server=tls.createServer({key:await readFile(new URL('./test-fixtures/server-key.pem',import.meta.url)),cert:await readFile(new URL('./test-fixtures/server.pem',import.meta.url))},socket=>{
  sockets.add(socket);socket.on('error',()=>{});socket.on('close',()=>sockets.delete(socket));socket.write('* OK flags fixture\r\n');let buffer='';
  socket.on('data',bytes=>{buffer+=bytes.toString();while(buffer.includes('\r\n')){const at=buffer.indexOf('\r\n'),line=buffer.slice(0,at);buffer=buffer.slice(at+2);state.commands.push(line.replace(/LOGIN.*/i,'LOGIN redacted'));const tag=line.split(' ')[0],op=line.split(' ')[1]?.toUpperCase(),reply=value=>socket.write(tag+' '+value+'\r\n');
   if(op==='CAPABILITY'){socket.write('* CAPABILITY IMAP4rev1'+(state.condstore?' CONDSTORE'+(state.enable?' ENABLE':''):'')+'\r\n');reply('OK capability');}
   else if(op==='ENABLE'){socket.write('* ENABLED CONDSTORE\r\n');reply('OK enable');}
   else if(op==='LOGIN'||op==='AUTHENTICATE')reply('OK authenticated');
   else if(op==='LIST'||op==='LSUB'){socket.write('* LIST () "/" "INBOX"\r\n');reply('OK list');}
   else if(op==='SELECT'||op==='EXAMINE'){socket.write('* FLAGS (\\Seen \\Flagged)\r\n* OK [PERMANENTFLAGS (\\Seen \\Flagged)] flags\r\n* 1 EXISTS\r\n* OK [UIDVALIDITY '+state.uidvalidity+'] validity\r\n* OK [UIDNEXT 2] next\r\n'+(state.nomodseq?'* OK [NOMODSEQ] none\r\n':state.condstore?'* OK [HIGHESTMODSEQ '+state.modseq+'] modseq\r\n':''));reply('OK ['+(state.readonly?'READ-ONLY':'READ-WRITE')+'] selected');}
   else if(op==='UID'&&/\bFETCH\b/i.test(line)){state.reads++;socket.write('* 1 FETCH (UID 1 FLAGS ('+state.flags.join(' ')+')'+(state.nomodseq?'':' MODSEQ ('+state.modseq+')')+')\r\n');reply('OK fetch');}
   else if(op==='UID'&&/\bSTORE\b/i.test(line)){state.stores++;const match=/UNCHANGEDSINCE (\d+)/i.exec(line);if(!match||Number(match[1])!==state.modseq){reply('OK [MODIFIED 1] conflict');continue;}state.flags=[...new Set(line.match(/\\Seen|\\Flagged/g)??[])];state.modseq++;if(state.dropAck){socket.destroy();continue;}socket.write('* 1 FETCH (UID 1 FLAGS ('+state.flags.join(' ')+')'+(state.nomodseq?'':' MODSEQ ('+state.modseq+')')+')\r\n');reply('OK store');}
   else if(op==='LOGOUT'){socket.write('* BYE fixture\r\n');reply('OK logout');socket.end();}
   else if(op==='NAMESPACE')reply('BAD unsupported');else reply('OK fixture');
  }});
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {port:server.address().port,state,async close(){for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
