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
const CaptureModal = (await import('./CaptureModal.jsx')).default;
let root, calls, failSave;
const task = { key: 'task-1', kind: 'task', title: 'Pay invoice', markdown: '[Source](https://mail.example)', selected: true, due_date: '2099-11-10', reminder_at: '2099-11-10T15:00:00Z', time_zone: 'America/Chicago', labels: ['MailFlow'] };
const preview = entries => ({ draft_id: 'draft-1', source: { subject: 'Invoice' }, entries });
async function open(entries, options = {}) {
  calls = []; failSave = false;
  globalThis.fetch = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : null; calls.push({ url, body, options });
    if (url.endsWith('/captures') && failSave) return { ok: false, status: 502, json: async () => ({ error: 'Connection lost. Retry safely.' }) };
    return { ok: true, status: 200, json: async () => url.endsWith('/preview') ? preview(entries) : { entries: [{ key: 'task-1', note_id: 42, status: 'created', url: 'https://notes.example/#/?note=42' }] } };
  };
  root = createRoot(document.getElementById('root'));
  await React.act(async () => root.render(React.createElement(CaptureModal, { message: { id: 'message-1', subject: 'Invoice' }, mode: 'actions', onClose() {}, ...options })));
}
afterEach(async () => { if (root) await React.act(async () => root.unmount()); root = null; });
const click = async text => {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent === text); assert.ok(button, text);
  await React.act(async () => button.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
};
const select = async (element, value) => { await React.act(async () => { Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set.call(element, value); element.dispatchEvent(new window.Event('change', { bubbles: true })); }); };

test('preview is editable, preserves suggested timezone, and saves only selected tasks', async () => {
  await open([task, { ...task, key: 'other', selected: false, assignee: 'other@example.com' }]);
  await React.act(async () => document.querySelector('.nt-entry-toggle').click());
  assert.equal(calls.length, 1); assert.equal(calls[0].body.scope, 'message');
  assert.equal(document.querySelector('textarea').value, task.markdown);
  assert.equal(document.querySelector('[type="datetime-local"]').value, '2099-11-10T09:00');
  await click('notetrace.save');
  const save = calls.find(c => c.url.endsWith('/captures'));
  assert.equal(save.body.entries.length, 1); assert.equal(save.body.entries[0].reminder_at, '2099-11-10T15:00:00.000Z');
  assert.ok(document.querySelector('a[href="https://notes.example/#/?note=42"]'));
  assert.ok(document.querySelector('a.nt-link[href="https://notes.example/#/?note=42"]'));
  assert.equal(document.activeElement.textContent, 'notetrace.done');
});

test('an urgent task without a date requires a time or an explicit no-reminder choice', async () => {
  await open([{ ...task, due_date: null, reminder_at: null, needs_time: true }]);
  await click('notetrace.save'); assert.equal(calls.length, 1); assert.equal(document.querySelector('[role="alert"]').textContent, 'notetrace.chooseTime');
  assert.equal(document.querySelector('.nt-entry-toggle').getAttribute('aria-expanded'), 'true');
  await select(document.querySelector('select'), 'none');
  await click('notetrace.save'); assert.equal(calls.at(-1).body.entries[0].reminder_at, null);
});

test('failed saves retain the reviewed draft and retry the same payload', async () => {
  await open([task]); failSave = true;
  await click('notetrace.save'); assert.match(document.querySelector('[role="alert"]').textContent, /Connection lost/);
  assert.equal(document.querySelector('textarea').value, task.markdown);
  failSave = false; await click('notetrace.save');
  const saves = calls.filter(c => c.url.endsWith('/captures')); assert.deepEqual(saves[0].body, saves[1].body);
});

test('previously saved items are unchecked and an explicit copy can be selected', async () => {
  await open([{ ...task, selected: false, existing: { url: 'https://notes.example/#/?note=1' } }]);
  assert.equal([...document.querySelectorAll('button')].find(b => b.textContent === 'notetrace.save').disabled, true);
  await React.act(async () => document.querySelector('.nt-entry-toggle').click());
  const copy = document.querySelectorAll('[type="checkbox"]')[1];
  await React.act(async () => copy.dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
  await click('notetrace.save'); assert.equal(calls.at(-1).body.entries[0].copy, true);
});

test('conversation scope is explicit and refreshes the preview', async () => {
  await open([task]); await click('notetrace.conversation');
  assert.equal(calls.at(-1).body.scope, 'conversation');
  assert.equal(document.querySelector('.nt-scope-toggle [aria-pressed="true"]').textContent, 'notetrace.conversation');
  await click('notetrace.conversation');
  assert.equal(calls.length, 2, 'clicking the active scope must not discard edits');
  await click('notetrace.selectedEmail');
  assert.equal(calls.at(-1).body.scope, 'message');
});

test('review starts collapsed, opens only one editor, and preserves changes across collapse', async () => {
  await open([task, { ...task, key: 'other', title: 'Reply to supplier', selected: false }]);
  const toggles = [...document.querySelectorAll('.nt-entry-toggle')];
  assert.ok(toggles.every(b => b.getAttribute('aria-expanded') === 'false'));
  assert.equal(document.querySelectorAll('.nt-entry > div[hidden]').length, 2);
  await React.act(async () => toggles[0].click());
  await select(document.querySelector('select'), 'none');
  await React.act(async () => toggles[1].click());
  assert.equal(toggles[0].getAttribute('aria-expanded'), 'false');
  assert.equal(toggles[1].getAttribute('aria-expanded'), 'true');
  await React.act(async () => toggles[0].click());
  assert.equal(document.querySelector('select').value, 'none');
  await React.act(async () => toggles[0].click());
  assert.ok(toggles.every(b => b.getAttribute('aria-expanded') === 'false'));
  await click('notetrace.save');
  assert.equal(calls.at(-1).body.entries.length, 1);
  assert.equal(calls.at(-1).body.entries[0].reminder_at, null);
});

test('existing AI results keep their source scope locked', async () => {
  await open([task], { result: { status: 'done', text: 'Pay invoice.' } });
  const toggles = [...document.querySelectorAll('.nt-scope-toggle button')];
  assert.ok(toggles.every(b => b.disabled));
  await click('notetrace.conversation');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.result_text, 'Pay invoice.');
});

test('focus wraps between visible controls while entry editors are collapsed', async () => {
  await open([task]);
  const first = document.querySelector('.nt-scope-toggle button');
  const last = [...document.querySelectorAll('button')].find(b => b.textContent === 'notetrace.save');
  first.focus();
  await React.act(async () => first.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
  assert.equal(document.activeElement, last);
  await React.act(async () => last.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
  assert.equal(document.activeElement, first);
});
