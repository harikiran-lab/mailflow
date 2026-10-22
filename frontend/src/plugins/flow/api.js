import { CSRF_HEADER, CSRF_VALUE } from '../../utils/api.js';
import { useStore } from '../../store/index.js';

export async function flowRequest(path,body,method=body?'POST':'GET',signal) {
  const response=await fetch('/api/'+path,{method,signal,credentials:'include',headers:{'Content-Type':'application/json',[CSRF_HEADER]:CSRF_VALUE},...(body?{body:JSON.stringify(body)}:{})});
  if(response.status===401)window.dispatchEvent(new CustomEvent('mailflow:session_expired'));
  if(response.status===423)window.dispatchEvent(new CustomEvent('mailflow:locked'));
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error||'Request failed. Try again.');
  return result;
}
export function parseFlowEvents(buffer,onEvent) {
  let end;
  while((end=buffer.indexOf('\n\n'))>=0){
    const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);
    const type=frame.split('\n').find(l=>l.startsWith('event:'))?.slice(6).trim();
    const data=frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');
    if(type&&data)onEvent(type,JSON.parse(data));
  }
  return buffer;
}
export async function streamFlow(input,onEvent,signal) {
  const response=await fetch('/api/flow/chat',{method:'POST',credentials:'include',signal,headers:{'Content-Type':'application/json',[CSRF_HEADER]:CSRF_VALUE},body:JSON.stringify(input)});
  if(response.status===401)window.dispatchEvent(new CustomEvent('mailflow:session_expired'));
  if(response.status===423)window.dispatchEvent(new CustomEvent('mailflow:locked'));
  if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.error||'Flow AI is unavailable.');}
  if(!response.body)throw new Error('Streaming is unavailable');
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',done=false;
  try{for(;;){const part=await reader.read();if(part.done)break;buffer=(buffer+decoder.decode(part.value,{stream:true})).replace(/\r\n/g,'\n');buffer=parseFlowEvents(buffer,(type,data)=>{if(type==='done')done=true;if(type==='error')throw new Error(data.error);onEvent(type,data);});if(buffer.length>1024*1024)throw new Error('Flow response exceeded its limit');}if(!done)throw new Error('Response interrupted. Pending previews have not been applied.');}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function openFlowSource(source) {
  const userId=useStore.getState().user?.id;
  const live=await flowRequest(source.source_key?'flow/source?key='+encodeURIComponent(source.source_key):'flow/source?id='+encodeURIComponent(source.id));
  if(useStore.getState().user?.id!==userId)return;
  const state=useStore.getState();state.setSelectedAccount(live.account_id,live.folder||'INBOX');state.setSelectedMessage(live.id);state.setMobileSidebarOpen(false);
}
export function askFlow(prompt,messageId) {window.dispatchEvent(new CustomEvent('mailflow:ask-flow',{detail:{prompt,messageId}}));}
