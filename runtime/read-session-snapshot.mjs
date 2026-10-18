import {canonical,fail} from './contract.mjs';

/** Read-only optimistic work. Short locked checks and commits retain the exact
 * original row/revision; no Host or custody authorization is stored here. */
export async function createReadSessionSnapshot({withLock,check,code='EMAIL_DATA_CONNECTION_DENIED'}){
 const original=await withLock(async tx=>{await check();const row=await tx.read();await check();if(!row)fail(code);return structuredClone(row);});
 let held=0;
 const same=async tx=>{await check();const row=await tx.read();if(!row||row.revision!==original.revision||canonical(row.value)!==canonical(original.value))fail(code);await check();};
 const withLocked=async work=>{
  if(held)return work();
  return withLock(async tx=>{await same(tx);held++;try{const value=await work();await same(tx);return value;}finally{held--;}});
 };
 return Object.freeze({read:async()=>structuredClone(original),assertCurrent:()=>withLocked(async()=>{}),withLocked});
}
