import { readSseData, readLimited, createRequestSignal } from './aiHttp.js';
import { CODEX_RESPONSES_URL } from './openaiCodexResponses.js';

export function codexToolInput(messages) {
  return messages.flatMap(m=>{
    if(m.role==='tool')return [{type:'function_call_output',call_id:m.tool_call_id,output:m.content}];
    const items=[];
    if(m.content)items.push({type:'message',role:m.role==='system'?'developer':m.role,content:[{type:m.role==='assistant'?'output_text':'input_text',text:m.content}]});
    for(const call of m.tool_calls||[])items.push({type:'function_call',call_id:call.id,name:call.function.name,arguments:call.function.arguments});
    return items;
  });
}
export async function consumeToolStream(response,{signal,onDelta=()=>{},codex=false}={}) {
  let content='',ended=false;
  const calls=new Map();
  for await(const data of readSseData(response,{signal,maxEventBytes:256*1024,createError:()=>Error('AI stream was interrupted or too large')})){
    if(data.trim()==='[DONE]'){ended=true;break;}
    let e;try{e=JSON.parse(data);}catch{throw Error('Malformed AI stream');}
    if(e.error||['response.failed','response.incomplete','error'].includes(e.type))throw Error('AI provider could not complete the response');
    if(codex){
      if(e.type==='response.output_text.delta'){content+=e.delta||'';onDelta(e.delta||'');}
      if(e.type==='response.output_item.done'&&e.item?.type==='function_call')calls.set(e.item.call_id,{id:e.item.call_id,type:'function',function:{name:e.item.name,arguments:e.item.arguments}});
      if(e.type==='response.completed'){ended=true;break;}
    }else{
      const choice=e.choices?.[0];
      if(choice?.finish_reason==='length')throw Error('AI response reached its output limit. Narrow the request.');
      const d=choice?.delta;
      if(typeof d?.content==='string'){content+=d.content;onDelta(d.content);}
      for(const call of d?.tool_calls||[]){
        const previous=calls.get(call.index)||{id:'',type:'function',function:{name:'',arguments:''}};
        if(call.id)previous.id=call.id;
        previous.function.name+=call.function?.name||'';
        previous.function.arguments+=call.function?.arguments||'';
        calls.set(call.index,previous);
      }
      if(choice?.finish_reason)ended=true;
    }
    if(content.length>64000||JSON.stringify([...calls.values()]).length>64000||calls.size>12)throw Error('AI response exceeded safe limits');
  }
  if(!ended)throw Error('AI response ended before completion');
  return {role:'assistant',content,tool_calls:[...calls.values()]};
}
export async function codexToolTurn({credentials,model,messages,tools,signal,onDelta,fetchFn=fetch}) {
  const request=createRequestSignal(signal,120000,'AI request timed out');
  try{
    const response=await fetchFn(CODEX_RESPONSES_URL,{method:'POST',signal:request.signal,redirect:'error',headers:{Authorization:`Bearer ${credentials.accessToken}`,'chatgpt-account-id':credentials.accountId,'OpenAI-Beta':'responses=experimental',originator:'mailflow',Accept:'text/event-stream','Content-Type':'application/json'},body:JSON.stringify({model,instructions:'You are Flow AI, a grounded email assistant.',store:false,stream:true,input:codexToolInput(messages),tools:tools.map(t=>({type:'function',name:t.function.name,description:t.function.description,parameters:t.function.parameters,strict:false}))})});
    if(!response.ok){await readLimited(response,8192);throw Object.assign(Error(`ChatGPT request failed (${response.status})`),{status:response.status===401?401:502});}
    return await consumeToolStream(response,{signal:request.signal,onDelta,codex:true});
  }finally{request.cleanup();}
}
