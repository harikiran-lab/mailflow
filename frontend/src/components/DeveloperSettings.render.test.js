import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { transform } from 'sucrase';

registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith('/store/index.js')) return { format: 'module', shortCircuit: true, source: 'export const useStore = selector => selector(globalThis.__developerTestState);' };
  if (url.endsWith('react-i18next/dist/es/index.js') || url.endsWith('/react-i18next')) return { format: 'module', shortCircuit: true, source: 'export const useTranslation = () => ({ t: key => key });' };
  if (url.endsWith('.jsx')) return { format: 'module', shortCircuit: true, source: transform(readFileSync(new URL(url), 'utf8'), { transforms: ['jsx'], jsxRuntime: 'automatic', filePath: url }).code };
  return nextLoad(url, context);
} });
const dom = new JSDOM('<div id="root"></div>', { url: 'https://mail.example', pretendToBeVisual: true });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, CustomEvent: dom.window.CustomEvent, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const React = await import('react');
const { createRoot } = await import('react-dom/client');
const DeveloperSettings = (await import('./DeveloperSettings.jsx')).default;
let root, calls;
async function open(user) {
  globalThis.__developerTestState = { user, accounts: [] };
  calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
    const config = { policy: { api: false, mcp: false, webhooks: false }, features: { flow: false, inbox: false }, embeddings: { enabled: false } };
    return { ok: true, status: 200, json: async () => url.endsWith('/settings') ? config : url.endsWith('/tokens') ? { tokens: [] } : url.endsWith('/webhooks') ? { subscriptions: [], deliveries: [] } : { policy: config.policy } };
  };
  root = createRoot(document.getElementById('root'));
  await React.act(async () => root.render(React.createElement(DeveloperSettings)));
}
afterEach(async () => { if (root) await React.act(async () => root.unmount()); root = null; });

test('an authenticated isAdmin user sees administrator controls and can save AI Inbox activation', async () => {
  await open({ id: 'admin', isAdmin: true });
  assert.ok(calls.some(c => c.url === '/api/developer/settings'));
  assert.ok([...document.querySelectorAll('summary')].some(s => s.textContent === 'flow.adminControls'));
  const label = [...document.querySelectorAll('label')].find(l => l.textContent === 'flow.enable.inbox');
  assert.ok(label);
  await React.act(async () => label.querySelector('input').click());
  const save = [...document.querySelectorAll('button')].find(b => b.textContent === 'flow.saveSettings');
  await React.act(async () => save.click());
  const request = calls.find(c => c.options.method === 'PATCH');
  assert.equal(request.url, '/api/developer/settings');
  assert.equal(request.body.features.inbox, true);
  assert.equal(request.options.headers['X-Requested-With'], 'MailFlow');
});

test('regular users never load or render administrator controls', async () => {
  await open({ id: 'regular', isAdmin: false });
  assert.equal(calls.some(c => c.url === '/api/developer/settings'), false);
  assert.equal([...document.querySelectorAll('summary')].some(s => s.textContent === 'flow.adminControls'), false);
});

test('administrator controls disappear when the authenticated role changes', async () => {
  await open({ id: 'admin', isAdmin: true });
  assert.ok([...document.querySelectorAll('summary')].some(s => s.textContent === 'flow.adminControls'));
  globalThis.__developerTestState = { user: { id: 'admin', isAdmin: false }, accounts: [] };
  await React.act(async () => root.render(React.createElement(DeveloperSettings)));
  assert.equal([...document.querySelectorAll('summary')].some(s => s.textContent === 'flow.adminControls'), false);
});
