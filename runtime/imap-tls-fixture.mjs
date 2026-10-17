/** Local synthetic protocol only. Test certificate/port/loopback overrides
 * exist exclusively in this fixture, never in the production connector. */
import net from 'node:net';
import tls from 'node:tls';
import {readFile} from 'node:fs/promises';
const root=new URL('./test-fixtures/',import.meta.url);
export const ca=await readFile(new URL('ca.pem',root));
const options={key:await readFile(new URL('server-key.pem',root)),cert:await readFile(new URL('server.pem',root)),minVersion:'TLSv1.2'};
export async function protocolServer({protocol='imap',starttls=false,preauth=false,rejectLogin=false,omitStarttls=false,dropDataAck=false}={}){
 const counters={auth:0,plaintext_auth:0,mail:0,rcpt:0,data:0,connections:0},sockets=new Set(),commands=[];
 const messages=[];
 function attach(socket,secure,greet=true){sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));let buffer='',dataBytes=null;
  if(greet)socket.write(protocol==='imap'?(preauth?'* PREAUTH fixture\r\n':'* OK fixture\r\n'):'220 smtp.example.test fixture\r\n');
  const onData=data=>{if(dataBytes!==null){dataBytes=Buffer.concat([dataBytes,data]);if(dataBytes.length>36*1024*1024){socket.destroy();return;}const end=dataBytes.indexOf('\r\n.\r\n');if(end<0)return;messages.push(Buffer.from(dataBytes.subarray(0,end+2).toString().replace(/^\.\./gmu,'.')));dataBytes=null;if(dropDataAck){socket.destroy();return;}socket.write('250 queued fixture\r\n');return;}
   buffer+=data.toString('utf8');while(buffer.includes('\r\n')){const at=buffer.indexOf('\r\n'),line=buffer.slice(0,at);buffer=buffer.slice(at+2);const [tag,verb]=line.split(' '),op=(protocol==='imap'?verb:tag)?.toUpperCase();commands.push({op,secure});
   const reply=text=>socket.write(protocol==='imap'?`${tag} ${text}\r\n`:text+'\r\n');
   if(op==='STARTTLS'){if(!starttls||omitStarttls){reply(protocol==='imap'?'NO TLS unavailable':'454 TLS unavailable');continue;}
    reply(protocol==='imap'?'OK begin TLS':'220 begin TLS');socket.removeListener('data',onData);const upgraded=new tls.TLSSocket(socket,{isServer:true,secureContext:tls.createSecureContext(options)});attach(upgraded,true,false);return;}
   if(protocol==='imap'){
    if(op==='CAPABILITY'){socket.write('* CAPABILITY IMAP4rev1'+(!secure&&starttls&&!omitStarttls?' STARTTLS':'')+'\r\n');reply('OK capability');}
    else if(op==='LOGIN'||op==='AUTHENTICATE'){counters.auth++;if(!secure)counters.plaintext_auth++;reply(rejectLogin?'NO authentication rejected':'OK authenticated');}
    else if(op==='LIST'||op==='LSUB'){socket.write('* LIST (\\HasNoChildren) "/" "INBOX"\r\n');reply('OK list');}
    else if(op==='NAMESPACE'){reply('BAD not supported');}
    else if(op==='LOGOUT'){socket.write('* BYE fixture\r\n');reply('OK logout');socket.end();}
    else reply('OK fixture');
   }else{
    if(op==='EHLO')socket.write('250-smtp.example.test\r\n'+(!secure&&starttls&&!omitStarttls?'250-STARTTLS\r\n':'')+'250 AUTH PLAIN\r\n');
    else if(op==='AUTH'){counters.auth++;if(!secure)counters.plaintext_auth++;reply(rejectLogin?'535 Authentication rejected':'235 Authenticated');}
    else if(op==='QUIT'){reply('221 Bye');socket.end();}
    else{if(op==='MAIL')counters.mail++;if(op==='RCPT')counters.rcpt++;if(op==='DATA'){counters.data++;dataBytes=Buffer.from(buffer);buffer='';reply('354 send exact synthetic bytes');return;}reply('250 fixture');}
   }
  }};socket.on('data',onData);
 }
 const server=starttls?net.createServer(socket=>{counters.connections++;attach(socket,false);}):tls.createServer(options,socket=>{counters.connections++;attach(socket,true);});server.on('tlsClientError',()=>{});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {port:server.address().port,counters,commands,messages,async close(){for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
