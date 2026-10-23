import { useCallback,useEffect,useRef,useState } from 'react';
import { flowRequest } from './api.js';

const active=run=>['pending','running'].includes(run?.status);
const storageKey=userId=>`mailflow_flow_run:${userId}`;
export default function useFlowRun(userId,onComplete) {
  const [run,setRun]=useState(null),[starting,setStarting]=useState(false),[error,setError]=useState('');
  const complete=useRef(onComplete),seen=useRef(new Set()),current=useRef(null),generation=useRef(0);
  useEffect(()=>{complete.current=onComplete;},[onComplete]);
  const accept=useCallback(value=>{
    if(!value?.id)return;
    const previous=current.current;
    current.current=value;setRun(value);
    try{localStorage.setItem(storageKey(userId),value.id);}catch{/* Server history remains available. */}
    if(previous?.id===value.id&&active(previous)&&!active(value)&&!seen.current.has(value.id)){
      seen.current.add(value.id);complete.current?.(value);
    }
  },[userId]);
  useEffect(()=>{
    const abort=new AbortController();const version=generation.current;
    const restore=async()=>{try{
      const list=await flowRequest('flow/runs',null,'GET',abort.signal);
      let saved;try{saved=localStorage.getItem(storageKey(userId));}catch{/* Optional browser storage. */}
      const targetId=list.runs?.find(active)?.id||saved;
      if(targetId){const value=await flowRequest('flow/runs/'+targetId,null,'GET',abort.signal);if(version===generation.current)accept(value);}
    }catch(e){if(e.name!=='AbortError'&&version===generation.current)setError(e.message);}};
    restore();return ()=>abort.abort();
  },[userId,accept]);
  const id=run?.id,running=active(run);
  useEffect(()=>{
    if(!id||!running)return;
    const abort=new AbortController();let timer,version=generation.current;
    const poll=async()=>{try{const value=await flowRequest('flow/runs/'+id,null,'GET',abort.signal);if(version!==generation.current)return;accept(value);setError('');if(!active(value))return;}catch(e){if(e.name==='AbortError')return;setError(e.message);}if(!abort.signal.aborted)timer=setTimeout(poll,1000);};
    poll();return ()=>{abort.abort();clearTimeout(timer);};
  },[id,running,accept]);
  const start=async input=>{
    setStarting(true);setError('');generation.current++;
    try{const created=await flowRequest('flow/runs',input);accept({...created,prompt:input.prompt,account_ids:input.account_ids,output:{text:'',tools:[],sources:[],proposals:[],captures:[],questions:[]}});return created;}
    catch(e){setError(e.message);throw e;}finally{setStarting(false);}
  };
  const stop=async()=>{if(!run?.id)return;try{await flowRequest(`flow/runs/${run.id}/stop`,{});}catch(e){setError(e.message);}};
  const clear=useCallback(()=>{if(running||starting)return;generation.current++;current.current=null;setRun(null);setError('');try{localStorage.removeItem(storageKey(userId));}catch{/* Optional browser storage. */}},[running,starting,userId]);
  return {run,busy:running||starting,start,stop,clear,error};
}
