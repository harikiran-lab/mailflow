import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith('/store/index.js')) return { format: 'module', shortCircuit: true, source: 'export const useStore = {getState: () => globalThis.__flowSourceState || ({user: {id: "test"}})};' };
  return nextLoad(url, context);
} });
const { parseFlowEvents, streamFlow, openFlowSource } = await import('./api.js');

test('opens an email outside the loaded page by fetching and caching its metadata after account navigation', async () => {
  const calls=[];
  const message={id:'moved-row',account_id:'account',folder:'Archive',subject:'An older email'};
  const state={user:{id:'owner'},threadMessages:{},messages:[],
    setSelectedAccount(account,folder){this.threadMessages={};this.account=account;this.folder=folder;},
    setThreadMessages(key,rows){this.threadMessages[key]=rows;},setSelectedMessage(id){this.selectedMessageId=id;},setMobileSidebarOpen(){}};
  globalThis.__flowSourceState=state;
  globalThis.fetch=async url=>{calls.push(url);return Response.json(url.startsWith('/api/flow/source')?{id:message.id}:message);};
  await openFlowSource({id:'suggestion-id',message_id:'legacy-row'});
  assert.deepEqual(calls,['/api/flow/source?id=legacy-row','/api/mail/messages/moved-row']);
  assert.equal(state.folder,'Archive');assert.equal(state.selectedMessageId,message.id);
  assert.deepEqual(Object.values(state.threadMessages).flat().find(m=>m.id===state.selectedMessageId),message);
  delete globalThis.__flowSourceState;
});

test('stable source links use the current row and never navigate after the signed-in user changes', async () => {
  let navigated=false;
  globalThis.__flowSourceState={user:{id:'owner'},setSelectedAccount(){navigated=true;}};
  globalThis.fetch=async url=>{if(url.startsWith('/api/flow/source')){assert.match(url,/key=account%3A/);return Response.json({id:'current'});}globalThis.__flowSourceState.user={id:'different'};return Response.json({id:'current'});};
  await openFlowSource({source_key:'account:<stable@example.com>'});assert.equal(navigated,false);
  delete globalThis.__flowSourceState;
});

test('SSE frames remain buffered until their JSON is complete', () => {
  const events = [];
  const first = parseFlowEvents('event: proposal\ndata: {"id":"p', (...e) => events.push(e));
  assert.equal(events.length, 0);
  assert.equal(parseFlowEvents(first + '1"}\n\nevent: done\ndata: {}\n\n', (...e) => events.push(e)), '');
  assert.deepEqual(events, [['proposal', { id: 'p1' }], ['done', {}]]);
});

test('streaming handles split CRLF and Unicode, and sends CSRF protection', async () => {
  let request;
  const wire = new TextEncoder().encode('event: text\r\ndata: {"delta":"你好"}\r\n\r\nevent: done\r\ndata: {}\r\n\r\n');
  globalThis.fetch = async (_url, options) => {
    request = options;
    return new Response(new ReadableStream({ start(controller) { for (const byte of wire) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }));
  };
  const events = [];
  await streamFlow({ prompt: 'Hello' }, (...e) => events.push(e));
  assert.deepEqual(events, [['text', { delta: '你好' }], ['done', {}]]);
  assert.equal(request.credentials, 'include');
  assert.equal(request.headers['X-Requested-With'], 'MailFlow');
});

test('an interrupted stream reports failure without making a confirmation request', async () => {
  const urls = [];
  globalThis.fetch = async url => { urls.push(url); return new Response('event: proposal\ndata: {"id":"preview"}\n\n'); };
  await assert.rejects(streamFlow({ prompt: 'Organize mail' }, () => {}), /interrupted/);
  assert.deepEqual(urls, ['/api/flow/chat']);
});

test('provider error events surface as errors', async () => {
  globalThis.fetch = async () => new Response('event: error\ndata: {"error":"Provider unavailable"}\n\n');
  await assert.rejects(streamFlow({ prompt: 'Hello' }, () => {}), /Provider unavailable/);
});

test('popup mode caches the email and opens a window without changing the mailbox',async()=>{
 const calls=[],message={id:'popup-mail',account_id:'account',folder:'INBOX'};globalThis.window={innerWidth:1200};globalThis.__flowSourceState={user:{id:'owner'},setThreadMessages(key,rows){calls.push(['cache',key,rows]);},openMessageWindow(id){calls.push(['popup',id]);},setSelectedAccount(){throw Error('Unexpected navigation');}};
 globalThis.fetch=async url=>Response.json(url.includes('/flow/source')?{id:'popup-mail'}:message);
 await openFlowSource({id:'popup-mail'},{mode:'popup'});assert.deepEqual(calls[1],['popup','popup-mail']);assert.equal(calls[0][2][0].id,'popup-mail');delete globalThis.window;delete globalThis.__flowSourceState;
});
