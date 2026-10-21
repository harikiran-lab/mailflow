import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { captureRequest } from './api.js';
import { localDateTime, validZone, zonedInstant } from '../../../../shared/captureTime.js';
import { button, primaryButton, field } from './styles.js';

export default function CaptureModal({ message, mode, result, onClose }) {
  const { t } = useTranslation();
  const [scope, setScope] = useState('message');
  const [draft, setDraft] = useState(null);
  const [entries, setEntries] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(null);
  const generation = useRef(0);
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => previous?.focus?.();
  }, []);
  useEffect(() => {
    const ref = generation;
    ref.current++;
    return () => { ref.current++; };
  }, []);
  const prepare = useCallback(async selectedScope => {
    const gen = ++generation.current;
    setBusy(true); setError(''); setDraft(null); setEntries([]); setSaved(null);
    try {
      const data = await captureRequest('/preview', { message_id: message.id, mode, scope: selectedScope,
        result_text: result?.text, truncated: result?.truncated || null });
      if (gen !== generation.current) return;
      setDraft(data);
      setEntries(data.entries.map(e => ({ ...e, reminder_local: e.reminder_at ? localDateTime(e.reminder_at, e.time_zone) : '',
        reminder_choice: e.reminder_at ? 'set' : e.needs_time ? 'choose' : 'none' })));
    } catch (e) { if (gen === generation.current) setError(e.message); }
    finally { if (gen === generation.current) setBusy(false); }
  }, [message.id, mode, result]);
  useEffect(() => { prepare('message'); }, [prepare]);
  const change = (index, patch) => setEntries(es => es.map((e, i) => i === index ? { ...e, ...patch } : e));
  const save = async () => {
    setError('');
    const selected = entries.filter(e => e.selected);
    if (!selected.length) { setError(t('notetrace.chooseItems')); return; }
    const payload = [];
    for (const e of selected) {
      if (!validZone(e.time_zone) || !e.title.trim()) { setError(t('notetrace.checkFields')); return; }
      if (e.reminder_choice === 'choose') { setError(t('notetrace.chooseTime')); return; }
      const reminder = e.reminder_choice === 'set' ? zonedInstant(e.reminder_local, e.time_zone) : null;
      if (e.reminder_choice === 'set' && !reminder) { setError(t('notetrace.ambiguousTime')); return; }
      payload.push({ key: e.key, title: e.title, markdown: e.markdown, time_zone: e.time_zone, labels: e.labels,
        due_date: e.kind === 'task' ? e.due_date || null : null, reminder_at: reminder, copy: !!e.copy });
    }
    const gen = generation.current;
    setBusy(true);
    try {
      const data = await captureRequest('/captures', { draft_id: draft.draft_id, entries: payload });
      if (gen === generation.current) {
        setSaved(data);
        window.dispatchEvent(new CustomEvent('mailflow:notetrace-saved', { detail: { messageId: message.id } }));
      }
    }
    catch (e) { if (gen === generation.current) setError(e.message); }
    finally { if (gen === generation.current) setBusy(false); }
  };
  const trapFocus = event => {
    if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose(); }
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')];
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { last?.focus(); event.preventDefault(); }
    if (!event.shiftKey && document.activeElement === last) { first?.focus(); event.preventDefault(); }
  };
  return <div style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="capture-title" tabIndex={-1} onKeyDown={trapFocus}
      style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', borderRadius: 12, padding: 22, width: 760, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box' }}>
      <h2 id="capture-title">{t('notetrace.review')}</h2>
      <p>{message.subject}</p>
      {!saved && <label>{t('notetrace.include')}{' '}<select style={field} value={scope} disabled={busy || mode === 'summary' || !!result} onChange={e => { setScope(e.target.value); prepare(e.target.value); }}>
        <option value="message">{t('notetrace.selectedEmail')}</option><option value="conversation">{t('notetrace.conversation')}</option>
      </select></label>}
      {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}
      {busy && <p role="status">{t('notetrace.working')}</p>}
      {!busy && !draft && <button style={button} onClick={() => prepare(scope)}>{t('notetrace.retry')}</button>}
      {draft?.truncated && <p>{t('notetrace.partial')}</p>}
      {saved ? <>
        <p role="status">{t('notetrace.saved')}</p>
        <ul>{saved.entries.map(e => <li key={e.key}>{e.status === 'removed' ? t('notetrace.removed') : <a href={e.url} target="_blank" rel="noopener noreferrer">{t('notetrace.open')}</a>}</li>)}</ul>
      </> : <>
        {draft && !entries.length && <p>{t('notetrace.noActions')}</p>}
        {entries.map((e, i) => <fieldset key={e.key + i} disabled={busy} style={{ margin: '16px 0', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
          <legend><label><input type="checkbox" checked={!!e.selected} onChange={event => change(i, { selected: event.target.checked })} /> {e.kind === 'task' ? t('notetrace.task') : t('notetrace.note')}</label></legend>
          {e.existing && <p>{t('notetrace.alreadySaved')} <a href={e.existing.url} target="_blank" rel="noopener noreferrer">{t('notetrace.open')}</a>{' '}
            <label><input type="checkbox" checked={!!e.copy} onChange={event => change(i, { copy: event.target.checked, selected: event.target.checked })} />{t('notetrace.createCopy')}</label></p>}
          {e.assignee !== undefined && <p>{t('notetrace.assignee')}: {e.assignee || t('notetrace.unclear')}</p>}
          <label>{t('notetrace.title')}<input style={field} value={e.title} onChange={event => change(i, { title: event.target.value })} /></label>
          <label>{t('notetrace.markdown')}<textarea style={{ ...field, minHeight: e.kind === 'note' ? 180 : 60, fontFamily: 'monospace' }} value={e.markdown} onChange={event => change(i, { markdown: event.target.value })} /></label>
          <label>{t('notetrace.labels')}<input style={field} value={e.labels.join(', ')} onChange={event => change(i, { labels: event.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></label>
          {e.kind === 'task' && <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            {e.deadline_quote && <blockquote>{e.deadline_quote}</blockquote>}
            {e.warning && <p>{e.warning}</p>}
            <label>{t('notetrace.dueDate')}<input style={field} type="date" value={e.due_date || ''} onChange={event => change(i, { due_date: event.target.value, reminder_local: '', reminder_choice: e.reminder_choice === 'none' ? 'none' : 'choose' })} /></label>
            <label>{t('notetrace.timeZone')}<input style={field} value={e.time_zone} onChange={event => change(i, { time_zone: event.target.value })} /></label>
            <label>{t('notetrace.reminder')}<select style={field} value={e.reminder_choice} onChange={event => change(i, { reminder_choice: event.target.value })}>
              <option value="choose">{t('notetrace.chooseTime')}</option><option value="none">{t('notetrace.noReminder')}</option><option value="set">{t('notetrace.setReminder')}</option>
            </select></label>
            {e.reminder_choice === 'set' && <input style={field} aria-label={t('notetrace.reminder')} type="datetime-local" value={e.reminder_local} onChange={event => change(i, { reminder_local: event.target.value })} />}
          </div>}
        </fieldset>)}
        {draft && <p style={{ fontSize: 12 }}>{draft.notifications?.message}</p>}
      </>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
        <button style={button} disabled={busy} onClick={onClose}>{saved ? t('notetrace.done') : t('notetrace.cancel')}</button>
        {!saved && <button style={{ ...primaryButton, opacity: busy || !entries.some(e => e.selected) ? 0.5 : 1 }} disabled={busy || !entries.some(e => e.selected)} onClick={save}>{t('notetrace.save')}</button>}
      </div>
    </section>
  </div>;
}
