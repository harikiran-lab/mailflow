import { query } from './db.js';
import { isUuid } from '../utils/uuid.js';

export const fail = (message, status = 400) => Object.assign(new Error(message), { status });
export const SCOPES = ['mail:read', 'mail:organize', 'drafts:write', 'notetrace:capture'];
const handlers = new Map();

// Core binds the same reviewed handlers used by the normal UI; plugins never receive them.
export function bindMailCapability(name, handler) { handlers.set(name, handler); }
export async function invokeMailCapability(name, principal, { body = {}, params = {}, query: qs = {} } = {}) {
  const handler = handlers.get(name);
  if (!handler) throw fail('Mail capability is unavailable', 503);
  let status = 200;
  let result;
  const res = { status(code) { status = code; return this; }, json(value) { result = value; return this; } };
  await handler({ session: { userId: principal.userId }, body, params, query: qs }, res);
  if (status >= 400) throw fail(result?.error || 'Mail operation failed', status);
  return result;
}

export function requireScope(principal, scope) {
  if (!principal?.userId || (principal.tokenId && !principal.scopes?.includes(scope))) throw fail('Permission denied: ' + scope, 403);
}

export async function ownedAccounts(principal, requested) {
  const { rows } = await query('SELECT id, name, email_address, enabled, include_in_unified_inbox FROM email_accounts WHERE user_id = $1 AND enabled = true ORDER BY sort_order, created_at', [principal.userId]);
  const allowed = rows.filter(a => !principal.tokenId || principal.accountIds.includes(a.id));
  if (requested !== undefined && requested !== null && requested !== '') {
    const ids = Array.isArray(requested) ? requested : [requested];
    if (!ids.length || ids.length > 50 || ids.some(id => !isUuid(id) || !allowed.some(a => a.id === id))) throw fail('Account is unavailable or outside the permitted scope', 403);
    return allowed.filter(a => ids.includes(a.id));
  }
  return principal.tokenId ? allowed : allowed.filter(a => a.include_in_unified_inbox !== false);
}

export async function ownedMessage(principal, id) {
  if (!isUuid(id)) throw fail('Invalid message ID');
  const { rows } = await query(`SELECT m.*, f.uid_validity FROM messages m JOIN email_accounts a ON a.id=m.account_id
    LEFT JOIN folders f ON f.account_id=m.account_id AND f.path=m.folder
    WHERE m.id=$1 AND a.user_id=$2 AND a.enabled=true AND m.is_deleted=false`, [id, principal.userId]);
  const m = rows[0];
  if (!m || (principal.tokenId && !principal.accountIds.includes(m.account_id))) throw fail('Email not found', 404);
  return m;
}

export function sourceKey(m) { return `${m.account_id}:${m.message_id || `row:${m.id}`}`; }
export function publicMessage(m, body = false) {
  return { id: m.id, account_id: m.account_id, subject: m.subject || '(No subject)', from_email: m.from_email,
    from_name: m.from_name, date: m.date, folder: m.folder, is_read: m.is_read, is_starred: m.is_starred,
    snippet: m.snippet, source_key: sourceKey(m), url: `/?m=${m.id}`,
    ...(body ? { content: (m.body_text || m.snippet || '').slice(0, 16000), partial: !m.body_text || m.body_text.length > 16000 } : {}) };
}

export async function searchMail(principal, input = {}) {
  requireScope(principal, 'mail:read');
  const accounts = await ownedAccounts(principal, input.account_ids || input.account_id);
  if (!accounts.length) return { messages: [], partial: false };
  const limit = Math.max(1, Math.min(Number(input.limit) || 30, 100));
  const q = typeof input.query === 'string' ? input.query.trim().slice(0, 500) : '';
  // Existing advanced search operators and FTS are shared with the mailbox UI.
  if (q) {
    const messages = [];
    for (const a of accounts) {
      const result = await invokeMailCapability('search', principal, { query: { q, accountId: a.id, limit, offset: Math.max(0, Math.min(Number(input.offset) || 0, 10000)) } });
      messages.push(...result.messages);
    }
    const unique = [...new Map(messages.sort((a,b) => new Date(b.date)-new Date(a.date)).map(m => [sourceKey(m), m])).values()];
    return { messages: unique.slice(0, limit).map(m => publicMessage(m)), partial: messages.length >= limit, coverage: 'Keyword/metadata candidates; not an exhaustive semantic search.' };
  }
  const { rows } = await query(`SELECT * FROM (SELECT DISTINCT ON (account_id, COALESCE(message_id,id::text)) m.*
    FROM messages m WHERE account_id=ANY($1::uuid[]) AND is_deleted=false
    AND folder !~* '(^|/)(trash|junk|spam|deleted items|deleted messages)$'
    ORDER BY account_id, COALESCE(message_id,id::text), date DESC) m ORDER BY date DESC LIMIT $2`, [accounts.map(a=>a.id), limit + 1]);
  return { messages: rows.slice(0,limit).map(m => publicMessage(m)), partial: rows.length > limit, coverage: 'Most recent cached mail.' };
}

export async function readMail(principal, input) {
  requireScope(principal, 'mail:read');
  const m = await ownedMessage(principal, input.message_id);
  if (!input.conversation || !m.thread_key) return { messages: [publicMessage(m, true)] };
  const { rows } = await query(`SELECT * FROM messages WHERE account_id=$1 AND thread_key=$2 AND is_deleted=false ORDER BY date DESC LIMIT 21`, [m.account_id, m.thread_key]);
  const unique = [...new Map(rows.map(r=>[sourceKey(r),r])).values()].slice(0,20).reverse();
  return { messages: unique.map(r=>publicMessage(r,true)), partial: rows.length > 20 };
}
