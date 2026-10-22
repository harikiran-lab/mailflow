import { describe,it,expect } from 'vitest';
import { consumeToolStream,codexToolInput } from './aiToolTransport.js';
import { normalizedVector,cosine } from './mailEmbeddings.js';

function sse(events){return new Response(events.map(e=>'data: '+(typeof e==='string'?e:JSON.stringify(e))+'\n\n').join(''),{headers:{'Content-Type':'text/event-stream'}});}
describe('tool transport',()=>{
  it('reassembles fragmented compatible function calls before execution',async()=>{
    const r=await consumeToolStream(sse([{choices:[{delta:{tool_calls:[{index:0,id:'call-1',function:{name:'read_mail',arguments:'{"message_'}}]}}]},{choices:[{delta:{tool_calls:[{index:0,function:{arguments:'id":"m1"}'}}]},finish_reason:'tool_calls'}]},'[DONE]']));
    expect(r.tool_calls[0]).toMatchObject({id:'call-1',function:{name:'read_mail',arguments:'{"message_id":"m1"}'}});
  });
  it('streams text and fails a truncated output explicitly',async()=>{
    const deltas=[];await expect(consumeToolStream(sse([{choices:[{delta:{content:'Partial'},finish_reason:'length'}]}]),{onDelta:d=>deltas.push(d)})).rejects.toThrow(/output limit/);
    await expect(consumeToolStream(sse([{choices:[{delta:{content:'Hi'}}]}]))).rejects.toThrow(/before completion/);
  });
  it('maps Codex function calls and results to the correct call identity',async()=>{
    const r=await consumeToolStream(sse([{type:'response.output_item.done',item:{type:'function_call',call_id:'abc',name:'search_mail',arguments:'{}'}},{type:'response.completed'}]),{codex:true});
    expect(codexToolInput([r,{role:'tool',tool_call_id:'abc',content:'{"messages":[]}'}])).toEqual([{type:'function_call',call_id:'abc',name:'search_mail',arguments:'{}'},{type:'function_call_output',call_id:'abc',output:'{"messages":[]}'}]);
  });
  it('rejects invalid embeddings and compares normalized vectors',()=>{
    expect(cosine(normalizedVector([3,4]),normalizedVector([3,4]))).toBeCloseTo(1);
    expect(()=>normalizedVector([0,0])).toThrow();expect(()=>normalizedVector([Infinity])).toThrow();expect(cosine([1],[1,0])).toBe(null);
  });
});
