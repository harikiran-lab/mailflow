import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { transform } from 'sucrase';

registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith('react-i18next/dist/es/index.js') || url.endsWith('/react-i18next')) return { format: 'module', shortCircuit: true, source: 'export const useTranslation = () => ({ t: key => key });' };
  if (url.endsWith('.jsx')) return { format: 'module', shortCircuit: true, source: transform(readFileSync(new URL(url), 'utf8'), { transforms: ['jsx'], jsxRuntime: 'automatic', filePath: url }).code };
  return nextLoad(url, context);
} });
const dom = new JSDOM('<div id="root"></div>', { url: 'https://mail.example', pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, CustomEvent: dom.window.CustomEvent, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const Settings = (await import('./NoteTraceSettings.jsx')).default;
let root, calls;
const connected = { connected: true, account: 'admin', url: 'https://notes.example', time_zone: 'America/Chicago', notifications: { message: 'Existing notification channels' } };
async function open(isConnected) {
  calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => url.endsWith('/disconnect') ? { connected: false } : url.endsWith('/connect') || isConnected ? connected : { connected: false } };
  };
  root = createRoot(document.getElementById('root'));
  await React.act(async () => root.render(React.createElement(Settings)));
}
afterEach(async () => { if (root) await React.act(async () => root.unmount()); root = null; });

test('connected card exposes an accessible collapsible header and working connection actions', async () => {
  await open(true);
  const header = document.querySelector('[aria-expanded]'), panel = document.getElementById(header.getAttribute('aria-controls'));
  assert.match(header.textContent, /notetrace.name/);
  assert.equal(document.querySelector('[role="status"]').textContent, 'admin.integrations.carddav.connected');
  assert.equal(header.getAttribute('aria-expanded'), 'true');
  await React.act(async () => header.click());
  assert.equal(panel.hidden, true);
  await React.act(async () => header.click());
  assert.equal(panel.hidden, false);
  assert.equal(panel.querySelector('a').href, 'https://notes.example/');
  assert.match(panel.textContent, /America\/Chicago/);
  const disconnect = [...panel.querySelectorAll('button')].find(b => b.textContent === 'notetrace.disconnect');
  await React.act(async () => disconnect.click());
  assert.equal(calls.at(-1).options.method, 'DELETE');
  assert.equal(document.querySelector('[role="status"]').textContent, 'admin.integrations.carddav.notConnected');
  assert.ok(document.querySelector('form'));
});

test('disconnected card keeps credentials editable and submits with CSRF protection', async () => {
  await open(false);
  const inputs = [...document.querySelectorAll('input')];
  const type = async (input, value) => React.act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new window.Event('input', { bubbles: true })); });
  await type(inputs[0], 'https://notes.example');await type(inputs[1], 'test-token');
  assert.equal(inputs[1].autocomplete, 'new-password');
  await React.act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(calls.at(-1).url, '/api/notetrace/connect');
  assert.equal(calls.at(-1).options.headers['X-Requested-With'], 'MailFlow');
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { url: 'https://notes.example', token: 'test-token', time_zone: inputs[2].value });
  assert.equal(document.querySelector('[role="status"]').textContent, 'admin.integrations.carddav.connected');
});
