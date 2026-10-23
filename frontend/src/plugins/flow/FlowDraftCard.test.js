import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { transform } from 'sucrase';
import { JSDOM } from 'jsdom';
registerHooks({load(url,context,next){
  if(url.endsWith('/store/index.js'))return {format:'module',shortCircuit:true,source:'export const useStore={getState:()=>globalThis.__flowDraftState};'};
  if(url.endsWith('.jsx'))return {format:'module',shortCircuit:true,source:transform(readFileSync(new URL(url),'utf8'),{transforms:['jsx'],jsxRuntime:'automatic',filePath:url}).code};
  return next(url,context);
}});
const dom=new JSDOM('',{url:'https://mail.example'});
Object.assign(globalThis,{window:dom.window,document:dom.window.document});
const {prepareFlowDraft,openFlowDraft}=await import('./FlowDraftCard.jsx');
test('asks about extra recipients, opens the reply with generated body and preserves threading',async()=>{
  const calls=[],composes=[],windows=[];
  const message={id:'email',account_id:'account',subject:'Project update',from_email:'sender@example.com',message_id:'<original>',thread_id:'thread',to_addresses:[{email:'me@example.com'},{email:'colleague@example.com'}],cc_addresses:[]};
  globalThis.__flowDraftState={user:{id:'owner'},accounts:[{id:'account',email_address:'me@example.com',aliases:[]}],setThreadMessages(){},openCompose(data){composes.push(data);return true;},openMessageWindow(id){windows.push(id);}};
  globalThis.fetch=async url=>{calls.push(url);return Response.json(url.includes('flow/source')?{id:'email'}:url.includes('/body')?{text:'Original email body'}:message);};
  const prepared=await prepareFlowDraft({id:'proposal',args:{accountId:'account',to:['sender@example.com'],subject:'Re: Project update',body:'Thanks! **I will review it.**'},messages:[{id:'email'}]});
  assert.equal(prepared.multiple,true);assert.equal(composes.length,0);
  await openFlowDraft(prepared,false);assert.deepEqual(composes[0].cc,[]);assert.equal(composes[0].inReplyTo,'<original>');assert.equal(composes[0].threadId,'thread');assert.match(composes[0].body,/<strong>I will review it\.<\/strong>/);
  await openFlowDraft(prepared,true);assert.deepEqual(composes[1].cc,[{email:'colleague@example.com'}]);assert.equal(composes[1].isReplyAll,true);assert.deepEqual(windows,['email','email']);
  assert.ok(calls.every(url=>!url.includes('/confirm')&&!url.includes('/send')));
});
test('does not open a prepared draft after the signed-in user changes',async()=>{
  let opened=false;globalThis.__flowDraftState={user:{id:'new-owner'},openCompose(){opened=true;}};
  assert.equal(await openFlowDraft({owner:'old-owner',compose:{}}),false);assert.equal(opened,false);
});
