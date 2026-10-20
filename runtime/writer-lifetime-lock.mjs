import {DatabaseSync} from 'node:sqlite';
import {constants as C} from 'node:fs';
import {open,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {fail} from './contract.mjs';

/** SQLite holds the OS file lock for this connection's whole lifetime. A crash
 * releases it without TTL, PID reuse, network-namespace or takeover races.
 * This database holds no application state and is never removed or replaced. */
export async function acquireWriterLifetimeLock(root){
 const path=join(root,'.writer-lock.sqlite');
 try{const file=await open(path,C.O_CREAT|C.O_EXCL|C.O_WRONLY|(C.O_NOFOLLOW??0),0o600);await file.close();}
 catch(error){if(error.code!=='EEXIST')throw error;}
 const identity=await lstat(path);
 if(!identity.isFile()||identity.isSymbolicLink()||identity.nlink!==1||identity.size>65536||process.platform!=='win32'&&(identity.uid!==process.getuid()||(identity.mode&0o077)!==0))fail('EMAIL_RUNTIME_WRITER_FENCE_LOST');
 let database;
 try{database=new DatabaseSync(path);database.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE');}
 catch(error){database?.close();if(error.errcode===5||error.errcode===6)fail('EMAIL_RUNTIME_WRITER_LOCKED');throw error;}
 let held=true;
 return {async held(){const current=await lstat(path);return held&&current.dev===identity.dev&&current.ino===identity.ino;},
  async close(){if(held){held=false;database.close();}}};
}
