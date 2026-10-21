import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {transform} from '../app/node_modules/esbuild/lib/main.js';
const root=new URL('../runtime/domain/',import.meta.url);
for(const [input,output] of [['source/',''],['test-source/','test/']]){
 await mkdir(new URL(output,root),{recursive:true});
 for(const name of await readdir(new URL(input,root))){
  if(!name.endsWith('.ts'))continue;
  const source=await readFile(new URL(input+name,root),'utf8');
  const {code}=await transform(source,{loader:'ts',target:'es2022',format:'esm'});
  await writeFile(new URL(output+name.replace(/\.ts$/u,'.mjs'),root),code.replaceAll("./mailbox-list.js","./mailbox-list.mjs").replace(/\r?\n/gu,"\r\n"));
 }
}
