import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith('/store/index.js')) return { format: 'module', shortCircuit: true, source: 'export const useStore = {getState: () => ({user: {id: "test"}})};' };
  return nextLoad(url, context);
} });
const { parseFlowEvents, streamFlow } = await import('./api.js');

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
