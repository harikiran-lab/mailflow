import { afterEach,test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { transform } from 'sucrase';
registerHooks({load(url,context,nextLoad){
  if(url.endsWith('/store/index.js'))return {format:'module',shortCircuit:true,source:'export const useStore=selector=>selector(globalThis.__flowAssistantState);'};
  if(url.endsWith('react-i18next/dist/es/index.js')||url.endsWith('/react-i18next'))return {format:'module',shortCircuit:true,source:'export const useTranslation=()=>({t:key=>key});'};
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
test('remembers assistant scope across remounts and isolates it from AI Inbox and other users',async()=>{
  await open();
  await React.act(async()=>{const select=document.querySelector('select');select.value='work';select.dispatchEvent(new window.Event('change',{bubbles:true}));});
  assert.equal(localStorage.getItem('mailflow_flow_scope:owner:assistant'),'work');
  assert.equal(localStorage.getItem('mailflow_flow_scope:owner:inbox'),null);
  await React.act(async()=>root.unmount());await open();assert.equal(document.querySelector('select').value,'work');
  await React.act(async()=>root.unmount());await open('another');assert.equal(document.querySelector('select').value,'');
});
test('falls back to unified accounts when a saved account is unavailable',async()=>{
  localStorage.setItem('mailflow_flow_scope:owner:assistant','removed-account');await open();
  assert.equal(document.querySelector('select').value,'');assert.equal(localStorage.getItem('mailflow_flow_scope:owner:assistant'),'');
});
