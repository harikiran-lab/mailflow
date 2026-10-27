import { useCallback,useState } from 'react';

const key=(view,userId)=>`mailflow_flow_scope:${userId}:${view}`;
export function readFlowScope(view,userId,fallback='') {
  if(!userId)return fallback;
  try{return localStorage.getItem(key(view,userId))??fallback;}catch{return fallback;}
}
export function useFlowScope(view,userId,fallback='') {
  const [choice,setChoice]=useState(()=>({userId,value:readFlowScope(view,userId,fallback)}));
  const scope=choice.userId===userId?choice.value:readFlowScope(view,userId,fallback);
  const setScope=useCallback(value=>{
    if(userId)try{localStorage.setItem(key(view,userId),value);}catch{/* Storage may be disabled. */}
    setChoice({userId,value});
    window.dispatchEvent(new CustomEvent('mailflow:flow-scope',{detail:{view,userId,value}}));
  },[view,userId]);
  return [scope,setScope];
}
