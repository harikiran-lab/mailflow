export const FLOW_EXCLUSIONS = ['shopping','marketing','surveys','promotions','social'];
export const FLOW_CATEGORIES = ['human','bill','charge','invoice',...FLOW_EXCLUSIONS,'other'];
export const DEFAULT_FLOW_PREFERENCES = {days:7,excluded_categories:FLOW_EXCLUSIONS,open_mode:'navigate'};

// Legacy suggestions have no classification. Keep the fallback conservative:
// a sale is not a bill, and a generic notification is not a personal message.
export function classifyFlowItem(item) {
  if(FLOW_CATEGORIES.includes(item.category))return item.category;
  const text=[item.subject,item.title,item.summary,item.quote].filter(Boolean).join(' ').toLowerCase();
  if(/\b(invoice|payment due|bill due|amount due|receipt|payment received|charged|transaction|billing statement)\b/.test(text))return /invoice/.test(text)?'invoice':'bill';
  if(/\b(survey|feedback questionnaire)\b/.test(text))return 'surveys';
  if(/\b(sale|discount|coupon|promo code|special offer|off your|shop now)\b/.test(text))return 'promotions';
  if(/\b(newsletter|unsubscribe|marketing)\b/.test(text))return 'marketing';
  if(/\b(followers?|liked your|friend request|social digest)\b/.test(text))return 'social';
  if(/\b(shopping|product recommendations|new arrivals)\b/.test(text))return 'shopping';
  if(/^(re|fw):/i.test(item.subject||''))return 'human';
  return 'other';
}
export function flowItemVisible(item,preferences=DEFAULT_FLOW_PREFERENCES,now=Date.now()) {
  const date=Date.parse(item.activity_at||item.date);
  return Number.isFinite(date)&&date>=now-preferences.days*86400000&&!preferences.excluded_categories.includes(classifyFlowItem(item));
}
export function flowBriefing(items) {
  const eligible=items.filter(i=>{
    const category=classifyFlowItem(i);
    return !FLOW_EXCLUSIONS.includes(category)&&(['human','bill','charge','invoice'].includes(category)||i.attention==='high');
  });
  const rank=i=>(i.attention==='high'?8:0)+(i.kind==='action'?4:i.kind==='followup'?2:0)+(['bill','charge','invoice'].includes(classifyFlowItem(i))?3:0);
  return eligible.sort((a,b)=>rank(b)-rank(a)||(Date.parse(b.activity_at||b.date)||0)-(Date.parse(a.activity_at||a.date)||0)).slice(0,10);
}
export function flowCardColor(id='') {
  let hash=0;for(const c of id)hash=(hash*31+c.charCodeAt(0))|0;
  return ['#a9c7ff','#c3b3f0','#a5dcc9','#f1ca9d','#eab4cf','#e4d88e'][Math.abs(hash)%6];
}
