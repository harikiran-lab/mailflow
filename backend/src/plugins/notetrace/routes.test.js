import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import 'express-async-errors';
import express from 'express';
const m = vi.hoisted(() => ({ active: vi.fn(), status: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), preview: vi.fn(), save: vi.fn(), links: vi.fn() }));
vi.mock('../api.js', () => ({ requireAuth: (req, _res, next) => { req.session = { userId: 'u1' }; next(); }, isPluginActivated: m.active,
  captureStatus: m.status, connectCapture: m.connect, disconnectCapture: m.disconnect, prepareEmailCapture: m.preview, saveEmailCapture: m.save, emailCaptureStatus: m.links }));
import routes from './routes.js';
let server, base;
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use('/api/notetrace', routes);
  server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); }); base = `http://127.0.0.1:${server.address().port}/api/notetrace`;
});
afterAll(() => new Promise(resolve => server.close(resolve)));
beforeEach(() => { vi.clearAllMocks(); m.active.mockResolvedValue(true); m.status.mockResolvedValue({ connected: false }); m.links.mockResolvedValue({ entries: [] }); });
describe('NoteTrace plugin routes', () => {
  it('requires per-user activation', async () => {
    m.active.mockResolvedValue(false); expect((await fetch(base + '/status')).status).toBe(409); expect(m.status).not.toHaveBeenCalled();
  });
  it('passes only the authenticated owner to status and saved-message lookups', async () => {
    expect((await fetch(base + '/status')).status).toBe(200); expect(m.status).toHaveBeenCalledWith('u1', {}, expect.anything());
    expect((await fetch(base + '/messages/message-1')).status).toBe(200); expect(m.links).toHaveBeenCalledWith('u1', 'message-1');
  });
  it('keeps capture previews separate from writes', async () => {
    m.preview.mockResolvedValue({ draft_id: 'draft-1', entries: [] });
    const res = await fetch(base + '/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'note', message_id: 'message-1' }) });
    expect(res.status).toBe(200); expect(m.save).not.toHaveBeenCalled(); expect(m.preview).toHaveBeenCalledWith('u1', { mode: 'note', message_id: 'message-1' }, expect.anything());
  });
  it('returns a reconnect error without invalidating the MailFlow session', async () => {
    m.save.mockRejectedValue(Object.assign(new Error('Reconnect NoteTrace'), { status: 409 }));
    const res = await fetch(base + '/captures', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(409); expect((await res.json()).error).toBe('Reconnect NoteTrace');
  });
});
