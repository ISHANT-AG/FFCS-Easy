// Own the worker lifecycle so progress, failure and cancellation cannot leave
// the interface in an endless loading state.
export function startGeneration(payload,{onResult,onProgress=()=>{},timeoutMs=10000,createWorker=()=>new Worker(new URL('./worker.js',import.meta.url),{type:'module'})}={}) {
 let actual=null,finished=false,timer;
 function terminate(){if(finished)return;finished=true;clearTimeout(timer);actual?.terminate();}
 function finish(data){if(finished)return;terminate();onResult(data);}
 try{
  actual=createWorker();
  actual.onmessage=({data})=>{
   if(finished||data.id!==payload.id)return;
   if(data.progress){onProgress(data.progress);return;}
   if(Array.isArray(data.results))finish(data);
  };
  actual.onerror=()=>finish({id:payload.id,results:[],reason:'Could not finish generating. Please try again. Your uploaded lists are saved.'});
  actual.onmessageerror=()=>finish({id:payload.id,results:[],reason:'Could not read the result. Please try again. Your uploaded lists are saved.'});
  timer=setTimeout(()=>finish({id:payload.id,results:[],reason:'Generation took too long. Please try again or adjust your preferences. Your uploaded lists are saved.'}),timeoutMs);
  actual.postMessage(payload);
 }catch{finish({id:payload.id,results:[],reason:'Could not start generation. Please try again. Your uploaded lists are saved.'});}
 return {terminate};
}
