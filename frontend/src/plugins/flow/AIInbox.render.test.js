import { afterEach,test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { transform } from 'sucrase';
registerHooks({load(url,context,nextLoad){
  if(url.endsWith('/store/index.js'))return {format:'module',shortCircuit:true,source:'export const useStore=selector=>selector(globalThis.__flowInboxState);'};
  if(url.endsWith('react-i18next/dist/es/index.js')||url.endsWith('/react-i18next'))return {format:'module',shortCircuit:true,source:'export const useTranslation=()=>({t:(key,args)=>key==="flow.greeting"?"Hi "+args.name:key});'};
  if(url.endsWith('.jsx'))return {format:'module',shortCircuit:true,source:transform(readFileSync(new URL(url),'utf8'),{transforms:['jsx'],jsxRuntime:'automatic',filePath:url}).code};
  return nextLoad(url,context);
}});
const dom=new JSDOM('<div id="root"></div>',{url:'https://mail.example',pretendToBeVisual:true});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,CustomEvent:dom.window.CustomEvent,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
const React=await import('react'),{createRoot}=await import('react-dom/client');
const AIInbox=(await import('./AIInbox.jsx')).default;
let root;
const items=Array.from({length:12},(_,i)=>({id:'item-'+i,source_key:'source-'+i,kind:'topic',title:'Topic '+i,summary:'Short summary '+i,quote:'Evidence',date:'2026-10-22',from_email:'sender@example.com'}));
async function open(job){
  globalThis.__flowInboxState={user:{id:'owner',displayName:'Harikiran Kandula',username:'login@example.com'},selectedAccountId:null,enabledPlugins:[]};
  globalThis.fetch=async url=>Response.json(url.includes('/status')?{allowed:true,features:{inbox:true},accounts:[{id:'account',name:'Personal',config:{enabled:true},job}]}:url.includes('/inbox')?{items,accounts:[]}:{});
  root=createRoot(document.getElementById('root'));await React.act(async()=>root.render(React.createElement(AIInbox)));
}
afterEach(async()=>{if(root)await React.act(async()=>root.unmount());root=null;localStorage.clear();});
test('greets the profile display name and fills the top ten summaries as entries are checked off',async()=>{
  await open({status:'done'});
  assert.match(document.querySelector('h1').textContent,/Hi Harikiran Kandula/);assert.doesNotMatch(document.querySelector('h1').textContent,/login@example/);
  const briefing=document.querySelector('.flow-briefing-summary');assert.equal(briefing.querySelectorAll('li').length,10);
  assert.ok(briefing.closest('.flow-briefing'));
  assert.match(briefing.textContent,/Short summary 0/);assert.doesNotMatch(briefing.textContent,/Short summary 10/);
  await React.act(async()=>briefing.querySelector('button[aria-label="flow.dismiss"]').click());
  assert.equal(briefing.querySelectorAll('li').length,10);assert.doesNotMatch(briefing.textContent,/Short summary 0/);assert.match(briefing.textContent,/Short summary 10/);
});
test('remembers the AI Inbox account selection across reloads',async()=>{
  await open({status:'done'});
  await React.act(async()=>{const select=document.querySelector('select');select.value='account';select.dispatchEvent(new window.Event('change',{bubbles:true}));});
  assert.equal(localStorage.getItem('mailflow_flow_scope:owner:inbox'),'account');
  await React.act(async()=>root.unmount());await open({status:'done'});
  assert.equal(document.querySelector('select').value,'account');
});
test('shows scheduled retries as paused work and allows manual retry without a stale red error',async()=>{
  await open({status:'pending',error:'Earlier failure',next_retry_at:'2026-10-22T18:00:00Z'});
  assert.match(document.querySelector('.flow-account-settings').textContent,/flow.retryQueued/);
  assert.ok(document.querySelector('.flow-retry'));assert.equal(document.querySelector('.flow-account-settings .flow-error'),null);
  const details=document.querySelector('.flow-retry-details');assert.ok(details);assert.equal(details.querySelector('summary').textContent,'flow.errorDetails');assert.match(details.textContent,/Earlier failure/);
  assert.equal(document.querySelector('.flow-inbox-topbar button').disabled,false);
});
