import { query } from './db.js';
import { encrypt, decrypt, isEncrypted } from './encryption.js';
import { safeFetch } from './safeFetch.js';
import { validZone } from '../../../shared/captureTime.js';

export const captureError = (message, status = 400) => Object.assign(new Error(message), { status });

export function destinationUrl(value) {
  let u;
  try { u = new URL(value); } catch { throw captureError('Enter a valid NoteTrace server URL.'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw captureError('Use a NoteTrace HTTP(S) server URL without credentials, query, or fragment.');
  const allowed = (process.env.NOTETRACE_ALLOWED_PRIVATE_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
  const allowPrivate = allowed.includes(u.origin);
  if (u.protocol !== 'https:' && !allowPrivate) throw captureError('Use HTTPS. Private HTTP servers must be approved by your administrator.');
  return { base: u.href.replace(/\/+$/, ''), allowPrivate };
}

async function remote(config, path, body) {
  const { base, allowPrivate } = destinationUrl(config.url);
  let response;
  try {
    response = await safeFetch(base + '/api/capture' + path, { method: body ? 'POST' : 'GET', redirect: 'error',
      signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) }, { allowPrivate });
  } catch { throw captureError('Cannot reach NoteTrace. Check the server address, private-host policy, and connection, then retry.', 502); }
  if (response.status === 401 || response.status === 403) { await response.body?.cancel(); throw captureError('NoteTrace rejected this token. Reconnect with a valid capture:write token.', 409); }
  const reader = response.body?.getReader();
  let raw = '', total = 0;
  try {
    const decoder = new TextDecoder();
    if (reader) for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > 1048576) { await reader.cancel(); throw Error('response too large'); }
      raw += decoder.decode(value, { stream: true });
    }
  } catch { throw captureError('NoteTrace returned an unreadable response. Retry this save safely.', 502); }
  let data;
  try { data = JSON.parse(raw); } catch { throw captureError('The address did not return a NoteTrace capture API response.', 502); }
  if (!response.ok) throw captureError(typeof data.error === 'string' ? data.error.slice(0, 300) : 'NoteTrace refused the capture.', response.status === 429 ? 429 : 409);
  return data;
}

async function connection(userId) {
  const { rows } = await query("SELECT config FROM user_integrations WHERE user_id = $1 AND provider = 'notetrace'", [userId]);
  return rows[0]?.config || null;
}
export async function captureStatus(userId) {
  const config = await connection(userId);
  return config ? { connected: true, url: config.url, time_zone: config.time_zone, account: config.account, notifications: config.notifications } : { connected: false };
}
export async function connectCapture(userId, { url, token, time_zone }) {
  const { base } = destinationUrl(url);
  if (typeof token !== 'string' || !token.trim().startsWith('note_pat_') || token.length > 300 || !validZone(time_zone)) throw captureError('Enter a capture token and a valid IANA time zone.');
  const capabilities = await remote({ url: base, token: token.trim() }, '/capabilities');
  if (capabilities.version !== 1 || !capabilities.markdown || !capabilities.tasks || !capabilities.reminders) throw captureError('Upgrade NoteTrace to a version supporting capture API v1.', 409);
  const encrypted = encrypt(token.trim());
  if (!isEncrypted(encrypted)) throw captureError('Credential encryption is not configured on MailFlow.', 503);
  const config = { url: base, token: encrypted, time_zone, account: capabilities.account, notifications: capabilities.notifications };
  await query("INSERT INTO user_integrations (user_id, provider, config) VALUES ($1, 'notetrace', $2) ON CONFLICT (user_id, provider) DO UPDATE SET config = EXCLUDED.config, updated_at = NOW()", [userId, config]);
  return captureStatus(userId);
}
export async function disconnectCapture(userId) { await query("DELETE FROM user_integrations WHERE user_id = $1 AND provider = 'notetrace'", [userId]); return { connected: false }; }
export async function sendCapture(userId, payload, expected) {
  const config = await connection(userId);
  if (!config) throw captureError('Connect NoteTrace in Settings → Integrations → Apps first.', 409);
  if (expected && (config.url !== expected.url || config.account !== expected.account)) throw captureError('The NoteTrace connection changed. Close this preview and prepare it again for the connected account.', 409);
  const result = await remote({ ...config, token: decrypt(config.token) }, '', payload);
  if (result.version !== 1 || !Array.isArray(result.entries) || result.entries.length !== payload.entries.length) throw captureError('NoteTrace returned an incomplete save response. Retry safely.', 502);
  return { ...result, entries: result.entries.map(e => ({ ...e, url: `${config.url}/#/?note=${encodeURIComponent(e.note_id)}` })) };
}
