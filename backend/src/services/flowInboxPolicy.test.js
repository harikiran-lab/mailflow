import { describe,it,expect } from 'vitest';
import { DEFAULT_FLOW_PREFERENCES,flowItemVisible,flowBriefing,classifyFlowItem } from '../../../shared/flowInboxPolicy.js';
describe('Inbox priority policy',()=>{
  const now=Date.parse('2026-10-22T12:00:00Z');
  it('uses activity time and excludes bulk categories without hiding financial records',()=>{
    const item={date:'2026-10-10',activity_at:'2026-10-21',category:'invoice'};
    expect(flowItemVisible(item,DEFAULT_FLOW_PREFERENCES,now)).toBe(true);
    expect(flowItemVisible({...item,activity_at:null},DEFAULT_FLOW_PREFERENCES,now)).toBe(false);
    expect(flowItemVisible({...item,category:'promotions'},DEFAULT_FLOW_PREFERENCES,now)).toBe(false);
    expect(classifyFlowItem({subject:'Your receipt from our shop'})).toBe('bill');
    expect(classifyFlowItem({subject:'Shop now: special offer'})).toBe('promotions');
  });
  it('limits the briefing to ten relevant items even with bulk exclusions disabled',()=>{
    const personal=Array.from({length:12},(_,id)=>({id,category:'human',kind:'topic'}));
    const important={id:'bill',category:'invoice',kind:'action',attention:'high'};
    const result=flowBriefing([{category:'promotions',attention:'high',kind:'action'},...personal,important]);
    expect(result).toHaveLength(10);expect(result[0]).toBe(important);expect(result.some(i=>i.category==='promotions')).toBe(false);
  });
});
