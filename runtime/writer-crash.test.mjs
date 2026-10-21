import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDurableStore} from './durable-store.mjs';

test('hard crash releases exclusive writer and retains the last atomic commit',async t=>{
 const root=await mkdtemp(join(tmpdir(),'email-writer-crash-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const options={root,encryption_key:new Uint8Array(32).fill(1),key_id:'test',allow_windows_fixture:true};
 for(const boundary of ['after_lock','before_read','after_read','after_commit']){
  const source=`import {createDurableStore} from ${JSON.stringify(new URL('./durable-store.mjs',import.meta.url).href)};
   const {acquireWriterLifetimeLock}=await import(${JSON.stringify(new URL('./writer-lifetime-lock.mjs',import.meta.url).href)});
   const s=${JSON.stringify(boundary)}==='after_lock'?await acquireWriterLifetimeLock(${JSON.stringify(root)}):await createDurableStore({...${JSON.stringify({...options,encryption_key:undefined})},encryption_key:new Uint8Array(32).fill(1)});
   if(!['before_read','after_lock'].includes(${JSON.stringify(boundary)}))await s.withLock({key:'row'},async tx=>{await tx.read();if(${JSON.stringify(boundary)}==='after_commit'){const row=await tx.read();await tx.compareAndSwap({expected_revision:row?.revision??null,value:{committed:true}});}});
   process.stdout.write('ready\\n');setInterval(()=>{},1000);`;
  const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',x=>stderr+=x);
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('exit',code=>reject(Error('child exited '+code+': '+stderr)));});
  await assert.rejects(createDurableStore(options),{code:'EMAIL_RUNTIME_WRITER_LOCKED'});
  const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;
  const reopened=await createDurableStore(options);
  if(boundary==='after_commit')assert.deepEqual((await reopened.withLock({key:'row'},tx=>tx.read())).value,{committed:true});
  await reopened.close();
 }
});
