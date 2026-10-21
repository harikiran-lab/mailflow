import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ query: vi.fn(), fetch: vi.fn() }));
vi.mock('./db.js', () => ({ query: mock.query }));
vi.mock('./safeFetch.js', () => ({ safeFetch: mock.fetch }));
vi.mock('./encryption.js', () => ({ encrypt: t => 'enc:v1:' + t, decrypt: t => t.slice(7), isEncrypted: t => t.startsWith('enc:v1:') }));
import { captureStatus, connectCapture, destinationUrl, sendCapture } from './captureDestination.js';
let config;
beforeEach(() => {
  vi.clearAllMocks(); config = null; delete process.env.NOTETRACE_ALLOWED_PRIVATE_ORIGINS;
  mock.query.mockImplementation(async (sql, args) => { if (sql.startsWith('INSERT')) { config = args[1]; return { rows: [] }; } return { rows: config ? [{ config }] : [] }; });
  mock.fetch.mockImplementation(async () => new Response(JSON.stringify({ version: 1, markdown: true, tasks: true, reminders: true, account: 'alice' }), { status: 200 }));
});
describe('NoteTrace destination connection', () => {
  it('requires secure public origins and explicit approval for private HTTP origins', () => {
    expect(() => destinationUrl('http://10.0.0.2:3004')).toThrow('HTTPS');
    expect(() => destinationUrl('https://name:password@notes.example')).toThrow('without credentials');
    expect(() => destinationUrl('https://notes.example?token=secret')).toThrow();
    process.env.NOTETRACE_ALLOWED_PRIVATE_ORIGINS = 'http://10.0.0.2:3004';
    expect(destinationUrl('http://10.0.0.2:3004/notetrace/')).toEqual({ base: 'http://10.0.0.2:3004/notetrace', allowPrivate: true });
  });
  it('checks capabilities, encrypts credentials, and never exposes the token through status', async () => {
    await connectCapture('u1', { url: 'https://notes.example/subpath/', token: 'note_pat_secret', time_zone: 'America/Chicago' });
    expect(config.token).toBe('enc:v1:note_pat_secret');
    expect(JSON.stringify(await captureStatus('u1'))).not.toContain('secret');
    expect(mock.fetch.mock.calls[0][0]).toBe('https://notes.example/subpath/api/capture/capabilities');
    expect(mock.fetch.mock.calls[0][1].redirect).toBe('error');
    expect(mock.fetch.mock.calls[0][2].allowPrivate).toBe(false);
  });
  it('maps an expired token to a reconnect error rather than a MailFlow session failure', async () => {
    mock.fetch.mockResolvedValue(new Response('{}', { status: 401 }));
    await expect(connectCapture('u1', { url: 'https://notes.example', token: 'note_pat_bad', time_zone: 'UTC' })).rejects.toMatchObject({ status: 409 });
    expect(config).toBeNull();
  });
  it('rejects unsupported servers and malformed responses', async () => {
    mock.fetch.mockResolvedValue(new Response('<html>Sign in</html>'));
    await expect(connectCapture('u1', { url: 'https://notes.example', token: 'note_pat_bad', time_zone: 'UTC' })).rejects.toMatchObject({ status: 502 });
    mock.fetch.mockResolvedValue(new Response(JSON.stringify({ version: 0 })));
    await expect(connectCapture('u1', { url: 'https://notes.example', token: 'note_pat_bad', time_zone: 'UTC' })).rejects.toMatchObject({ status: 409 });
  });
  it('returns bounded connection errors without leaking upstream credentials', async () => {
    mock.fetch.mockRejectedValue(new Error('connection failed: note_pat_secret'));
    await expect(connectCapture('u1', { url: 'https://notes.example', token: 'note_pat_secret', time_zone: 'UTC' })).rejects.toMatchObject({ status: 502, message: expect.not.stringContaining('secret') });
  });
  it('uses the stored token server-side and preserves a subpath in saved-note links', async () => {
    await connectCapture('u1', { url: 'https://notes.example/subpath', token: 'note_pat_secret', time_zone: 'UTC' });
    mock.fetch.mockResolvedValue(new Response(JSON.stringify({ version: 1, entries: [{ key: 'e1', note_id: 42, status: 'created' }] })));
    const result = await sendCapture('u1', { entries: [{ key: 'e1' }] });
    expect(result.entries[0].url).toBe('https://notes.example/subpath/#/?note=42');
    expect(mock.fetch.mock.calls.at(-1)[1].headers.Authorization).toBe('Bearer note_pat_secret');
  });
  it('does not send an open draft to a newly connected account', async () => {
    await connectCapture('u1', { url: 'https://notes.example', token: 'note_pat_secret', time_zone: 'UTC' });
    const before = mock.fetch.mock.calls.length;
    await expect(sendCapture('u1', { entries: [] }, { url: 'https://other.example', account: 'bob' })).rejects.toMatchObject({ status: 409 });
    expect(mock.fetch.mock.calls.length).toBe(before);
  });
});
