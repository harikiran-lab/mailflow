import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { transform } from 'sucrase';

registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith('react-i18next/dist/es/index.js') || url.endsWith('/react-i18next')) return { format: 'module', shortCircuit: true, source: 'export const useTranslation = () => ({ t: k => k });' };
  if (url.endsWith('.jsx')) return { format: 'module', shortCircuit: true, source: transform(readFileSync(new URL(url), 'utf8'), { transforms: ['jsx'], jsxRuntime: 'automatic', filePath: url }).code };
  return nextLoad(url, context);
} });
const dom = new JSDOM('<div id="root"></div>', { url: 'https://mail.example', pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, CustomEvent: dom.window.CustomEvent, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const MessageActions = (await import('./MessageActions.jsx')).default;
let root, savedEntries, calls, captures, captureListener;
async function open({ enabled = true, connected = true, entries = [] } = {}) {
  savedEntries = entries; calls = []; captures = [];
  globalThis.fetch = async url => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => url === '/api/ai/status' ? { enabled, features: { summarize: enabled } }
      : url.endsWith('/status') ? { connected } : { entries: savedEntries } };
  };
  captureListener = event => captures.push(event.detail);
  window.addEventListener('mailflow:notetrace-capture', captureListener);
  root = createRoot(document.getElementById('root'));
  await React.act(async () => root.render(React.createElement(MessageActions, { message: { id: 'message-1' } })));
}
afterEach(async () => {
  if (root) await React.act(async () => root.unmount());
  root = null;
  window.removeEventListener('mailflow:notetrace-capture', captureListener);
});
const click = async element => { await React.act(async () => element.click()); };
const trigger = () => document.querySelector('[aria-haspopup="menu"]');
const key = async (element, value) => { await React.act(async () => element.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }))); };

test('saved captures show one header dot and deduplicated links only inside the menu', async () => {
  await open({ entries: Array.from({ length: 6 }, () => ({ status: 'created', url: 'https://notes.example/#/?note=42' })) });
  assert.equal(document.querySelectorAll('.nt-saved-dot').length, 1);
  assert.equal(document.querySelectorAll('a').length, 0);
  assert.equal(document.querySelector('[role="menu"]'), null);
  assert.equal(document.getElementById('root').textContent, '');
  await click(trigger());
  assert.equal(document.querySelectorAll('[role="menu"] a').length, 1);
  assert.equal(document.querySelector('[role="menu"] a').href, 'https://notes.example/#/?note=42');
});

test('menu supports keyboard navigation, Escape, and focus restoration', async () => {
  await open();
  await key(trigger(), 'ArrowDown');
  const items = [...document.querySelectorAll('[role="menuitem"]')];
  assert.equal(document.activeElement, items[0]);
  await key(items[0], 'ArrowDown');
  assert.equal(document.activeElement, items[1]);
  await key(items[1], 'End');
  assert.equal(document.activeElement, items.at(-1));
  await key(items.at(-1), 'Escape');
  assert.equal(document.querySelector('[role="menu"]'), null);
  assert.equal(document.activeElement, trigger());
});

test('manual actions remain available without AI and open the correct capture mode', async () => {
  await open({ enabled: false });
  await click(trigger());
  assert.equal(document.querySelectorAll('[role="menuitem"]').length, 2);
  await click([...document.querySelectorAll('[role="menuitem"]')][1]);
  assert.equal(captures[0].mode, 'task');
  assert.equal(captures[0].message.id, 'message-1');
  assert.equal(document.querySelector('[role="menu"]'), null);
});

test('AI capture is gated and has an AI icon', async () => {
  await open();
  await click(trigger());
  const action = [...document.querySelectorAll('[role="menuitem"]')].find(b => b.textContent === 'notetrace.prepareBoth');
  assert.ok(action.querySelector('svg'));
  await click(action);
  assert.equal(captures[0].mode, 'combined');
});

test('saved events refresh only their own message and removed captures clear the dot', async () => {
  await open({ entries: [{ status: 'created', url: 'https://notes.example/#/?note=42' }] });
  const count = calls.length;
  await React.act(async () => window.dispatchEvent(new CustomEvent('mailflow:notetrace-saved', { detail: { messageId: 'another' } })));
  assert.equal(calls.length, count);
  savedEntries = [{ status: 'removed', url: 'https://notes.example/#/?note=42' }];
  await React.act(async () => window.dispatchEvent(new CustomEvent('mailflow:notetrace-saved', { detail: { messageId: 'message-1' } })));
  assert.equal(document.querySelector('.nt-saved-dot'), null);
});

test('clicking outside closes the menu', async () => {
  await open();
  await click(trigger());
  await React.act(async () => document.body.dispatchEvent(new window.Event('pointerdown', { bubbles: true })));
  assert.equal(document.querySelector('[role="menu"]'), null);
});
