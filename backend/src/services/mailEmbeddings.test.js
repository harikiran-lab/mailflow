import { describe,it,expect,vi,beforeEach } from 'vitest';
const state=vi.hoisted(()=>({fetch:vi.fn()}));
vi.mock('./safeFetch.js',()=>({safeFetch:state.fetch}));
vi.mock('./connectionPolicy.js',()=>({getConnectionPolicy:async()=>({allowPrivateHosts:true})}));
import { embeddingChunks,embedMailTexts,normalizedVector } from './mailEmbeddings.js';
const config={base_url:'http://local.example/v1',model:'short-context'};
beforeEach(()=>{state.fetch.mockReset();});
describe('short-context compatible embeddings',()=>{
  it('chunks Unicode by UTF-8 bytes without splitting characters',()=>{
    const text='Hello 世界 🌱 '.repeat(70),chunks=embeddingChunks(text);
    expect(chunks.join('')).toBe(text);expect(chunks.every(s=>Buffer.byteLength(s)<=384)).toBe(true);
    expect(chunks.some(s=>s.includes('\uFFFD'))).toBe(false);
  });
  it('indexes long mail with sequential bounded requests and pooled normalized vectors',async()=>{
    let active=0,maxActive=0;
    state.fetch.mockImplementation(async(_url,options)=>{
      active++;maxActive=Math.max(maxActive,active);const input=JSON.parse(options.body).input;
      expect(input.length).toBeLessThanOrEqual(8);expect(input.every(t=>Buffer.byteLength(t)<=384)).toBe(true);
      await Promise.resolve();active--;return Response.json({data:input.map((_,index)=>({index,embedding:[3,4]}))});
    });
    const vectors=await embedMailTexts(config,['x'.repeat(6000),'短いメール'.repeat(400)]);
    expect(vectors).toHaveLength(2);for(const v of vectors){expect(v[0]).toBeCloseTo(0.6);expect(v[1]).toBeCloseTo(0.8);}
    expect(maxActive).toBe(1);expect(state.fetch.mock.calls.length).toBeGreaterThan(1);
  });
  it('adapts to a smaller provider token limit and bounds retries without exposing provider text',async()=>{
    const c={...config,model:'tiny-context'};
    state.fetch.mockImplementation(async(_url,options)=>{
      const input=JSON.parse(options.body).input;
      if(input.some(t=>Buffer.byteLength(t)>100))return Response.json({error:{message:"'input' exceeds the 100-token limit. private content"}},{status:400});
      return Response.json({data:input.map((_,index)=>({index,embedding:[1,0]}))});
    });
    expect(await embedMailTexts(c,['x'.repeat(500)])).toEqual([[1,0]]);
    expect(state.fetch.mock.calls.length).toBe(3);
    state.fetch.mockImplementation(async()=>Response.json({error:'input exceeds the 10-token limit; SECRET'},{status:400}));
    await expect(embedMailTexts({...c,model:'unusable-context'},['long '.repeat(100)])).rejects.toThrow(/^Embeddings provider request failed$/);
    expect(state.fetch.mock.calls.length).toBeLessThan(10);
  });
  it('does not retry authentication errors and rejects invalid or changing vector dimensions',async()=>{
    state.fetch.mockResolvedValueOnce(Response.json({error:'Unauthorized'},{status:401}));
    await expect(embedMailTexts(config,['text'])).rejects.toThrow('Embeddings provider request failed');expect(state.fetch).toHaveBeenCalledTimes(1);
    state.fetch.mockImplementation(async(_u,o)=>Response.json({data:JSON.parse(o.body).input.map((_,index)=>({index,embedding:index%2?[1]:[1,0]}))}));
    await expect(embedMailTexts(config,['x'.repeat(500)])).rejects.toThrow('dimensions changed');
    expect(()=>normalizedVector([Number.MAX_VALUE,Number.MAX_VALUE])).toThrow();
  });
});
