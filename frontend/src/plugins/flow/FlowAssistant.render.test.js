import { afterEach,test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { transform } from 'sucrase';
registerHooks({load(url,context,nextLoad){
  if(url.endsWith('/store/index.js'))return {format:'module',shortCircuit:true,source:'export const useStore=selector=>selector(globalThis.__flowAssistantState);useStore.getState=()=>globalThis.__flowAssistantState;'};
  if(url.endsWith('react-i18next/dist/es/index.js')||url.endsWith('/react-i18next'))return {format:'module',shortCircuit:true,source:'export const useTranslation=()=>({t:key=>key});'};
  if(url.endsWith('/notificationSounds.js'))return {format:'module',shortCircuit:true,source:'export const unlockNotificationSound=()=>{};export const playNotificationSound=()=>{globalThis.__flowSoundCount=(globalThis.__flowSoundCount||0)+1;};'};
  if(url.endsWith('.jsx'))return {format:'module',shortCircuit:true,source:transform(readFileSync(new URL(url),'utf8'),{transforms:['jsx'],jsxRuntime:'automatic',filePath:url}).code};
  return nextLoad(url,context);
}});
const dom=new JSDOM('<div id="root"></div>',{url:'https://mail.example',pretendToBeVisual:true});
Object.assign(globalThis,{window:dom.window,document:dom.window.document,localStorage:dom.window.localStorage,CustomEvent:dom.window.CustomEvent,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
const React=await import('react'),{createRoot}=await import('react-dom/client');
const Assistant=(await import('./FlowAssistant.jsx')).default;
let root,calls;
async function open(userId='owner'){
  globalThis.__flowAssistantState={user:{id:userId},selectedAccountId:null,selectedMessageId:null,enabledPlugins:[],fontSize:100};
  calls=[];globalThis.fetch=async url=>{calls.push(url);return Response.json(url.includes('/status')?{allowed:true,features:{flow:true},accounts:[{id:'personal',name:'Personal'},{id:'work',name:'Work'}]}:{conversations:[]});};
  root=createRoot(document.getElementById('root'));await React.act(async()=>root.render(React.createElement(Assistant)));
  await React.act(async()=>document.querySelector('.flow-fab').click());
}
afterEach(async()=>{if(root)await React.act(async()=>root.unmount());root=null;localStorage.clear();});
test('maximizes and restores without losing the draft or refetching the conversation',async()=>{
  await open();
  await React.act(async()=>window.dispatchEvent(new CustomEvent('mailflow:ask-flow',{detail:{prompt:'Keep this draft'}})));
  const textarea=document.querySelector('textarea');assert.equal(textarea.value,'Keep this draft');
  await React.act(async()=>document.querySelector('[aria-label="flow.maximizeAssistant"]').click());
  assert.ok(document.querySelector('.flow-chat-maximized'));assert.equal(document.querySelector('[aria-label="flow.restoreAssistant"]').getAttribute('aria-pressed'),'true');
  assert.equal(document.querySelector('textarea'),textarea);assert.equal(textarea.value,'Keep this draft');
  await React.act(async()=>document.querySelector('[aria-label="flow.restoreAssistant"]').click());
  assert.equal(document.querySelector('.flow-chat-maximized'),null);assert.equal(calls.filter(url=>url.includes('/status')).length,1);
});

test('follows the active mailbox and automatically uses its selected email',async()=>{
  await open();
  globalThis.__flowAssistantState={...globalThis.__flowAssistantState,selectedAccountId:'work',selectedMessageId:'message'};
  await React.act(async()=>root.render(React.createElement(Assistant)));
  assert.match(document.querySelector('[role=combobox]').textContent,/Work/);assert.equal(document.querySelector('input[type=checkbox]'),null);assert.match(document.querySelector('.flow-context').textContent,/flow.automaticEmailContext/);
  assert.equal(localStorage.getItem('mailflow_flow_scope:owner:assistant'),null);
});
test('follows live AI Inbox selection and does not include stale email context there',async()=>{
  localStorage.setItem('mailflow_flow_scope:owner:inbox','work');await open();
  globalThis.__flowAssistantState={...globalThis.__flowAssistantState,pluginView:'flow-inbox',selectedMessageId:'stale'};
  await React.act(async()=>root.render(React.createElement(Assistant)));
  assert.match(document.querySelector('[role=combobox]').textContent,/Work/);assert.equal(document.querySelector('.flow-context-auto'),null);
  await React.act(async()=>window.dispatchEvent(new CustomEvent('mailflow:flow-scope',{detail:{view:'inbox',userId:'owner',value:'personal'}})));
  assert.match(document.querySelector('[role=combobox]').textContent,/Personal/);
  const ids=[...document.querySelectorAll('.ecb-root [id]')].map(e=>e.id);assert.equal(new Set(ids).size,ids.length);
});

test('keeps generating when closed or navigating, notifies once, and restores saved output',async()=>{
  await open();let finished=false;const requests=[];globalThis.__flowSoundCount=0;
  const snapshot=()=>({id:'run',status:finished?'done':'running',conversation_id:'conversation',account_ids:['personal'],prompt:'Review mail',output:{text:finished?'## ✅ Ready\n\n**Complete response**':'Partial response',tools:[],proposals:[],captures:[],sources:[],questions:[]}});
  globalThis.fetch=async(url,options={})=>{requests.push([url,options.method]);return Response.json(url.endsWith('/runs')?(options.method==='POST'?{id:'run',conversation_id:'conversation',status:'pending'}:{runs:[snapshot()]}):url.endsWith('/runs/run')?snapshot():url.includes('/status')?{allowed:true,features:{flow:true},accounts:[{id:'personal',name:'Personal'},{id:'work',name:'Work'}]}:{conversations:[]});};
  await React.act(async()=>window.dispatchEvent(new CustomEvent('mailflow:ask-flow',{detail:{prompt:'Review mail'}})));
  await React.act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
  assert.match(document.querySelector('.flow-chat-body').textContent,/Partial response/);
  await React.act(async()=>document.querySelector('.flow-overlay').dispatchEvent(new window.MouseEvent('mousedown',{bubbles:true})));
  assert.equal(document.querySelector('[role=dialog]'),null);assert.ok(document.querySelector('.flow-fab .state-typing'));
  globalThis.__flowAssistantState.selectedAccountId='work';await React.act(async()=>root.render(React.createElement(Assistant)));
  finished=true;await React.act(async()=>new Promise(resolve=>setTimeout(resolve,1100)));
  assert.equal(globalThis.__flowSoundCount,1);assert.ok(document.querySelector('.flow-unread-badge'));assert.ok(requests.every(([url])=>!url.endsWith('/stop')));
  await React.act(async()=>document.querySelector('.flow-fab').click());assert.match(document.querySelector('.flow-message-assistant .flow-markdown').textContent,/Complete response/);assert.ok(document.querySelector('.flow-markdown h2'));assert.ok(document.querySelector('.flow-markdown strong'));
  await React.act(async()=>root.unmount());root=createRoot(document.getElementById('root'));await React.act(async()=>root.render(React.createElement(Assistant)));
  await React.act(async()=>document.querySelector('.flow-fab').click());assert.match(document.querySelector('.flow-message-assistant .flow-markdown').textContent,/Complete response/);assert.equal(globalThis.__flowSoundCount,1);
});

test('themed picker supports keyboard selection and Escape only closes its menu',async()=>{
 await open();const picker=document.querySelector('[role=combobox]');
 await React.act(async()=>picker.click());assert.equal(picker.getAttribute('aria-expanded'),'true');
 await React.act(async()=>picker.dispatchEvent(new window.KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true})));
 await React.act(async()=>picker.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
 assert.match(picker.textContent,/Personal/);assert.equal(picker.getAttribute('aria-expanded'),'false');
 await React.act(async()=>picker.click());await React.act(async()=>picker.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 assert.ok(document.querySelector('[role=dialog]'));assert.equal(picker.getAttribute('aria-expanded'),'false');
});
