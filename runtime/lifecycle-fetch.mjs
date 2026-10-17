/** Give every SDK channel request a process-lifetime cancellation boundary,
 * including response bodies. Older Kit claim methods ignore per-call signals.
 * Cancellation never retries an effect or manufactures a successful receipt. */
export function createLifecycleFetch(signal,fetcher=globalThis.fetch){
 return async(url,options={})=>{
  const active=AbortSignal.any([signal,options.signal].filter(Boolean));active.throwIfAborted();
  const response=await fetcher(url,{...options,signal:active});
  if(active.aborted){void response.body?.cancel(active.reason).catch(()=>{});active.throwIfAborted();}
  if(!response.body)return response;
  const reader=response.body.getReader();let controller,finished=false;
  const clean=()=>{finished=true;active.removeEventListener('abort',abort);};
  const abort=()=>{if(finished)return;clean();controller.error(active.reason);void reader.cancel(active.reason).catch(()=>{});};
  const body=new ReadableStream({
   start(value){controller=value;active.addEventListener('abort',abort,{once:true});if(active.aborted)abort();},
   async pull(){try{active.throwIfAborted();const next=await reader.read();active.throwIfAborted();if(next.done){clean();controller.close();}else controller.enqueue(next.value);}catch(error){if(!finished){clean();controller.error(error);}void reader.cancel(error).catch(()=>{});}},
   async cancel(reason){clean();await reader.cancel(reason);}
  });
  return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
 };
}
