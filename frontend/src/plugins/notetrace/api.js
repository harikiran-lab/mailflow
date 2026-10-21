import { CSRF_HEADER, CSRF_VALUE } from '../../utils/api.js';

export async function captureRequest(path, body, method = body ? 'POST' : 'GET') {
  const response = await fetch('/api/notetrace' + path, { method, credentials: 'include',
    headers: { [CSRF_HEADER]: CSRF_VALUE, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  if (response.status === 401) window.dispatchEvent(new CustomEvent('mailflow:session_expired'));
  if (response.status === 423) window.dispatchEvent(new CustomEvent('mailflow:locked'));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'NoteTrace request failed.');
  return data;
}

export function openCapture(message, mode, result = null) {
  window.dispatchEvent(new CustomEvent('mailflow:notetrace-capture', { detail: { message, mode, result } }));
}
