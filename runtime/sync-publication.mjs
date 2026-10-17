import {randomUUID} from 'node:crypto';
import {canonical,digest,fail} from './contract.mjs';
import {nativeAdoptionKey} from './native-adoption-identity.mjs';

/** Publication has its own acknowledged cursor. Native provider cursors never
 * come from the host scan checkpoint, which can lag foreground native reads. */
export function createSyncPublication({store,mailbox,repairContinuity}){
 return Object.freeze({async page({scope,consumer,producer,input_cursor,limit,check,localCheck,readNative,onBootstrap}){
  if(input_cursor!==null&&(typeof input_cursor!=='string'||input_cursor.length>4096)||!Number.isInteger(limit)||limit<1||limit>25)fail('EMAIL_SYNC_PUBLICATION_PAGE_LIMIT');
  const transition=repairContinuity?await repairContinuity.resolve({scope,consumer,producer,check}):null;
  const activeProducer=producer;
  if(transition){consumer=transition.consumer;producer=transition.producer;}
  const handoffProducers=transition?.current_producer?[producer,activeProducer]:undefined;
  const consumer_id=digest(consumer),key='email.data.sync_publication.'+digest([scope,consumer_id]),prefix='email-publication-v1:'+consumer_id+':';
  return store.withLock({key},async tx=>{
   await check();const row=await tx.read(),saved=row?.value;
   if(transition?.current_producer&&!saved)fail('EMAIL_REPAIR_CONTINUITY_DENIED');
   if(saved&&(Object.keys(saved).sort().join(',')!=='bootstrap_after,bootstrap_boundary,consumer,input_cursor,producer,result,result_digest,schema_version,scope,sequence'||saved.schema_version!=='email.sync_publication.v1'||canonical(saved.scope)!==canonical(scope)||canonical(saved.consumer)!==canonical(consumer)||canonical(saved.producer)!==canonical(producer)||!Number.isSafeInteger(saved.sequence)||saved.sequence<0||saved.input_cursor!==null&&(typeof saved.input_cursor!=='string'||saved.input_cursor.length>4096)||saved.bootstrap_after!==null&&typeof saved.bootstrap_after!=='string'||saved.bootstrap_boundary!==null&&(!Number.isSafeInteger(saved.bootstrap_boundary)||saved.bootstrap_boundary<0)||!saved.result?.next_cursor?.startsWith(prefix)||saved.result.account_id!==scope.account_id||saved.result.items.length>limit||saved.result.tombstones.length>limit||saved.result_digest!=='sha256:'+digest(saved.result)))fail('EMAIL_SYNC_PUBLICATION_SCOPE_CHANGED');
   // A new leased Run can publish the same immutable read result. It never
   // repeats the uncertain Run or its provider reads.
   if(saved&&input_cursor===saved.input_cursor){await check();return structuredClone(saved.result);}
   if(saved&&input_cursor!==saved.result.next_cursor)fail('EMAIL_SYNC_PUBLICATION_REBASELINE_REQUIRED');
   const head=await mailbox.syncHead(scope,localCheck);let selected,after=null,boundary=head.last,bootstrap=false,cacheAfter=null;
   if(saved){after=saved.sequence;boundary=saved.bootstrap_boundary??head.last;bootstrap=saved.bootstrap_after!==null;cacheAfter=saved.bootstrap_after;}
   else if(input_cursor===null){
    if(head.last&&head.oldest===1){try{selected=await mailbox.syncNext(scope,0,producer,localCheck);}catch(error){if(error.code!=='EMAIL_SYNC_PUBLICATION_SCOPE_CHANGED')throw error;bootstrap=true;}}
    else if(await mailbox.cursor(scope,localCheck)!==null)bootstrap=true;
    else {
     const imported=(await store.withLock({key:nativeAdoptionKey(scope)},tx=>tx.read()))?.value;
     if(imported){
      if(imported.state!=='staged_verified'||canonical(imported.scope)!==canonical(scope))fail('EMAIL_NATIVE_ADOPTION_NOT_VERIFIED');
      await check();bootstrap=true;
     }else after=0;
    }
   }else{
    // A versioned cursor belongs to an existing consumer row. Missing state is
    // corruption/overflow, never permission to reset its scan checkpoint.
    if(input_cursor.startsWith('email-publication-v1:'))fail('EMAIL_SYNC_PUBLICATION_REBASELINE_REQUIRED');
    if(!/^(gmail|microsoft)-native-v1:[0-9a-f-]{36}$/u.test(input_cursor))fail('EMAIL_SYNC_PUBLICATION_REBASELINE_REQUIRED');
    bootstrap=true;
   }
   let page,sequence,bootstrap_after=null,bootstrap_boundary=null;
   if(bootstrap){
    await onBootstrap?.();const cached=await mailbox.publicationCachePage(scope,{after:cacheAfter,limit},localCheck);page=cached.page;bootstrap_after=cached.after;bootstrap_boundary=boundary;sequence=boundary;
    page.next_cursor=bootstrap_after===null?prefix+'n:'+boundary:prefix+'b:'+randomUUID();
    // A cached scan never establishes absence or complete native coverage.
    page.tombstones=[];page.complete=false;page.has_more=true;
   }else{
    if(!selected)selected=await mailbox.syncNext(scope,after??0,producer,localCheck,handoffProducers);
    if(!selected){await readNative();selected=await mailbox.syncNext(scope,after??0,producer,localCheck,handoffProducers);if(!selected)fail('EMAIL_SYNC_HANDOFF_INVALID');}
    if(selected.page.items.length>limit||selected.page.tombstones.length>limit)fail('EMAIL_SYNC_PUBLICATION_PAGE_LIMIT');
    page=structuredClone(selected.page);sequence=selected.sequence;page.next_cursor=prefix+'n:'+sequence;
    const currentHead=await mailbox.syncHead(scope,localCheck);page.has_more=page.has_more||sequence<currentHead.last;if(sequence<currentHead.last)page.complete=false;
   }
   const result={...page,state_updates:[]};
   await check();const value={schema_version:'email.sync_publication.v1',scope,consumer,producer,input_cursor,sequence,bootstrap_after,bootstrap_boundary,result,result_digest:'sha256:'+digest(result)};
   if(!await tx.compareAndSwap({expected_revision:row?.revision??null,value}))fail('EMAIL_DATA_CONFLICT');await check();return structuredClone(result);
  });
 }});
}
