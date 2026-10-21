import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ query: vi.fn(), message: vi.fn(), account: vi.fn(), addresses: vi.fn(), ai: vi.fn(), access: vi.fn(), status: vi.fn(), send: vi.fn(), get: vi.fn(), put: vi.fn(), body: vi.fn() }));
vi.mock('./db.js', () => ({ query: mock.query }));
vi.mock('./mailAccess.js', () => ({ loadOwnedMessage: mock.message, getOwnedAccount: mock.account, getAccountAddresses: mock.addresses }));
vi.mock('../plugins/mailEngine.js', () => ({ getMailEngine: () => ({ fetchMessageBody: mock.body }) }));
vi.mock('../plugins/storage.js', () => ({ getValue: mock.get, put: mock.put }));
vi.mock('./aiProvider.js', () => ({ completeText: mock.ai }));
vi.mock('./aiAccess.js', () => ({ getUserAiAccess: mock.access, aiFeatureEnabled: s => !!s.enabled }));
vi.mock('./captureDestination.js', () => ({ captureError: (message, status = 400) => Object.assign(new Error(message), { status }), captureStatus: mock.status, sendCapture: mock.send }));
import { parseActionCapture, prepareEmailCapture, saveEmailCapture } from './emailCapture.js';
import { emailToMarkdown } from './emailMarkdown.js';
import { localDateTime, suggestedReminder, zonedInstant } from '../../../shared/captureTime.js';
const messageId = '11111111-1111-4111-8111-111111111111';
let records;
beforeEach(() => {
  vi.clearAllMocks(); records = new Map();
  mock.get.mockImplementation(async (_, key) => records.get(key) || null);
  mock.put.mockImplementation(async (_, key, data) => records.set(key, { owner_id: data.ownerId, value: data.value }));
  mock.status.mockResolvedValue({ connected: true, url: 'https://notes.example', account: 'me', time_zone: 'America/Chicago' });
  mock.message.mockResolvedValue({ id: messageId, account_id: 'a1', message_id: '<mail1@example>', subject: 'Invoice', from_email: 'sender@example.com', date: '2026-10-21T10:00:00Z', body_html: '<p>Please pay <strong>invoice</strong> by November 10.</p>' });
  mock.addresses.mockResolvedValue(['me@example.com']);
  mock.query.mockResolvedValue({ rows: [{ preferences: { language: 'en' } }] });
  mock.access.mockResolvedValue({ allowed: true, status: { enabled: true } });
  mock.send.mockImplementation(async (_, p) => ({ version: 1, entries: p.entries.map((e, i) => ({ key: e.key, note_id: i + 1, status: 'created', url: `https://notes.example/#/?note=${i + 1}` })) }));
});

describe('Markdown email capture', () => {
  it('preserves formatting and excludes trackers, script, hidden content and unsafe links', () => {
    const md = emailToMarkdown({ html: '<h2>Hello</h2><p><strong>Bold</strong> <a href="https://example.com">Link</a></p><ul><li>First</li><li>Second</li></ul><blockquote>Reply</blockquote><script>bad()</script><p hidden>secret</p><img src="https://tracker.example/pixel"><a href="javascript:alert(1)">Click</a>' });
    expect(md).toContain('## Hello'); expect(md).toContain('**Bold**'); expect(md).toContain('[Link](https://example.com/)'); expect(md).toContain('- First'); expect(md).toContain('> Reply');
    expect(md).not.toMatch(/<|tracker|secret|javascript|bad\(\)/);
  });
  it('keeps tables as Markdown and escapes plain text that resembles HTML', () => {
    expect(emailToMarkdown({ html: '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>' })).toContain('| --- | --- |');
    expect(emailToMarkdown({ text: '<script>literal</script>\n# literal title' })).toContain('\\<script\\>');
    expect(emailToMarkdown({ html: '<ul><li>Parent<ul><li>Child</li></ul></li></ul>' })).toContain('  - Child');
    expect(emailToMarkdown({ html: '<pre>line 1\n  line 2</pre>' })).toContain('line 1\n  line 2');
  });
  it('never calls AI for manual capture or saving an existing summary', async () => {
    const note = await prepareEmailCapture('u1', { message_id: messageId, mode: 'note' });
    expect(note.entries[0].markdown).toContain('**invoice**');
    const summary = await prepareEmailCapture('u1', { message_id: messageId, mode: 'summary', result_text: '## Already generated' });
    expect(summary.entries[0].markdown).toBe('## Already generated'); expect(mock.ai).not.toHaveBeenCalled(); expect(mock.access).not.toHaveBeenCalled();
  });
  it('fetches the complete body rather than silently saving the snippet', async () => {
    const m = await mock.message(); mock.message.mockResolvedValue({ ...m, body_html: null, body_text: null, snippet: 'partial' });
    mock.account.mockResolvedValue({ id: 'a1' }); mock.body.mockResolvedValue({ text: 'Complete body' });
    const note = await prepareEmailCapture('u1', { message_id: messageId, mode: 'note' });
    expect(note.entries[0].markdown).toContain('Complete body'); expect(mock.body).toHaveBeenCalledOnce();
  });
  it('enforces ownership and AI access on the server', async () => {
    mock.message.mockResolvedValue(null);
    await expect(prepareEmailCapture('other', { message_id: messageId, mode: 'note' })).rejects.toMatchObject({ status: 404 });
    mock.message.mockResolvedValue({ id: messageId, account_id: 'a1', body_text: 'text' });
    mock.access.mockResolvedValue({ allowed: false, status: { enabled: true } });
    await expect(prepareEmailCapture('u1', { message_id: messageId, mode: 'actions' })).rejects.toMatchObject({ status: 403 }); expect(mock.ai).not.toHaveBeenCalled();
  });
  it('uses stable capture identifiers on retry and marks previously saved tasks', async () => {
    const preview = await prepareEmailCapture('u1', { message_id: messageId, mode: 'task' });
    const entry = preview.entries[0];
    const body = { draft_id: preview.draft_id, entries: [entry] };
    await saveEmailCapture('u1', body); await saveEmailCapture('u1', body);
    expect(mock.send.mock.calls[0][1].request_id).toBe(mock.send.mock.calls[1][1].request_id);
    const repeated = await prepareEmailCapture('u1', { message_id: messageId, mode: 'task' });
    expect(repeated.entries[0].existing.note_id).toBe(1); expect(repeated.entries[0].selected).toBe(false);
  });
  it('does not expose another user’s draft', async () => {
    const p = await prepareEmailCapture('u1', { message_id: messageId, mode: 'task' });
    await expect(saveEmailCapture('u2', { draft_id: p.draft_id, entries: p.entries })).rejects.toMatchObject({ status: 404 });
  });
});

describe('action extraction and dates', () => {
  const context = { content: 'Please pay by November 10.', addresses: ['Me@example.com'], timeZone: 'America/Chicago', now: Date.parse('2026-10-21T00:00:00Z') };
  const action = { text: 'Pay invoice', assignee_email: 'me@example.com', due_date: '2026-11-10', due_time: '15:00', time_zone: 'America/Chicago', deadline_quote: 'by November 10.', time_sensitive: true };
  it('selects only clearly assigned personal actions and preserves deadline evidence', () => {
    const result = parseActionCapture(JSON.stringify({ summary_md: '**Summary**', actions: [action, { ...action, text: 'Review invoice', assignee_email: 'someone@example.com' }, { ...action, text: 'Approve invoice', assignee_email: null }] }), context);
    expect(result.tasks.map(t => t.selected)).toEqual([true, false, false]);
    expect(result.tasks[0].reminder_at).toBe('2026-11-10T20:00:00.000Z');
  });
  it('does not invent reminders for urgency, unsupported deadlines, or invalid dates', () => {
    const result = parseActionCapture(JSON.stringify({ summary_md: '', actions: [{ ...action, deadline_quote: 'not in email' }, { ...action, due_date: '2026-02-30' }] }), context);
    expect(result.tasks.every(t => !t.due_date && !t.reminder_at && t.needs_time)).toBe(true);
  });
  it('rejects malformed provider output without writes', () => {
    expect(() => parseActionCapture('not json', context)).toThrow('usable tasks'); expect(mock.put).not.toHaveBeenCalled();
    expect(() => parseActionCapture('null', context)).toThrow('invalid summary');
  });
  it('requires clarification for unsupported time zones and invalid exact times', () => {
    const result = parseActionCapture(JSON.stringify({ summary_md: '', actions: [{ ...action, time_zone: 'PST?' }, { ...action, text: 'Second task', due_time: '25:00' }] }), context);
    expect(result.tasks.every(t => t.reminder_at === null && t.needs_time)).toBe(true);
  });
  it('deduplicates repeated action wording and keeps a clearly personal assignment', () => {
    const result = parseActionCapture(JSON.stringify({ summary_md: '', actions: [{ ...action, assignee_email: null }, action] }), context);
    expect(result.tasks).toHaveLength(1); expect(result.tasks[0].selected).toBe(true);
  });
  it('handles daylight-saving changes and refuses nonexistent or repeated times', () => {
    expect(zonedInstant('2026-03-08T02:30', 'America/Chicago')).toBeNull();
    expect(zonedInstant('2026-11-01T01:30', 'America/Chicago')).toBeNull();
    expect(zonedInstant('2026-07-01T09:00', 'America/Chicago')).toBe('2026-07-01T14:00:00.000Z');
    expect(localDateTime('2026-07-01T14:00:00Z', 'America/Chicago')).toBe('2026-07-01T09:00');
    expect(suggestedReminder('2026-11-10', null, 'America/Chicago', context.now)).toBe('2026-11-10T15:00:00.000Z');
    expect(suggestedReminder('2000-01-01', '12:00', 'UTC', context.now)).toBeNull();
  });
});
