import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { captureRequest } from './api.js';
import { localDateTime, validZone, zonedInstant } from '../../../../shared/captureTime.js';
import { Chevron, NoteIcon } from './Icons.jsx';

export default function CaptureModal({ message, mode, result, onClose }) {
  const { t } = useTranslation();
  const [scope, setScope] = useState('message');
  const [draft, setDraft] = useState(null);
  const [entries, setEntries] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const dialogId = useId();
  const generation = useRef(0);
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => previous?.focus?.();
  }, []);
  useEffect(() => {
    if (saved) dialog.current?.querySelector('.nt-dialog-footer button')?.focus();
  }, [saved]);
  useEffect(() => {
    const ref = generation;
    ref.current++;
    return () => { ref.current++; };
  }, []);
  const prepare = useCallback(async selectedScope => {
    const gen = ++generation.current;
    setBusy(true); setError(''); setDraft(null); setEntries([]); setSaved(null); setExpanded(null);
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
      const invalid = key => { setExpanded(entries.indexOf(e)); setError(t(key)); };
      if (!validZone(e.time_zone) || !e.title.trim()) { invalid('notetrace.checkFields'); return; }
      if (e.reminder_choice === 'choose') { invalid('notetrace.chooseTime'); return; }
      const reminder = e.reminder_choice === 'set' ? zonedInstant(e.reminder_local, e.time_zone) : null;
      if (e.reminder_choice === 'set' && !reminder) { invalid('notetrace.ambiguousTime'); return; }
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
    const focusable = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]')]
      .filter(element => !element.closest('[hidden]'));
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { last?.focus(); event.preventDefault(); }
    if (!event.shiftKey && document.activeElement === last) { first?.focus(); event.preventDefault(); }
  };
  return <div className="notetrace-ui nt-overlay">
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby={`${dialogId}-title`} tabIndex={-1} onKeyDown={trapFocus} className="nt-dialog">
      <header className="nt-dialog-header">
        <h2 id={`${dialogId}-title`}>{t('notetrace.review')}</h2>
        <p className="nt-subject">{message.subject}</p>
        {!saved && <div className="nt-scope-row">
          <span id={`${dialogId}-scope`}>{t('notetrace.include')}</span>
          <div role="group" aria-labelledby={`${dialogId}-scope`} className="nt-scope-toggle">
            {['message', 'conversation'].map(value => <button key={value} type="button" aria-pressed={scope === value}
              disabled={busy || mode === 'summary' || !!result}
              onClick={() => { if (scope !== value) { setScope(value); prepare(value); } }}>
              {t(value === 'message' ? 'notetrace.selectedEmail' : 'notetrace.conversation')}
            </button>)}
          </div>
        </div>}
        {error && <p role="alert" className="nt-error">{error}</p>}
      </header>
      <div className="nt-dialog-body">
      {busy && <p role="status">{t('notetrace.working')}</p>}
      {!busy && !draft && <button className="nt-button" onClick={() => prepare(scope)}>{t('notetrace.retry')}</button>}
      {draft?.truncated && <p>{t('notetrace.partial')}</p>}
      {saved ? <>
        <p role="status">{t('notetrace.saved')}</p>
        <ul className="nt-saved-links">{saved.entries.map(e => <li key={e.key}>{e.status === 'removed' ? t('notetrace.removed') : <a className="nt-link" href={e.url} target="_blank" rel="noopener noreferrer">{t('notetrace.open')}</a>}</li>)}</ul>
      </> : <>
        {draft && !entries.length && <p>{t('notetrace.noActions')}</p>}
        {entries.map((e, i) => <div key={e.key + i} className={`nt-entry${expanded === i ? ' nt-entry-open' : ''}`}>
          <div className="nt-entry-header">
            <input type="checkbox" aria-label={`${e.kind === 'task' ? t('notetrace.task') : t('notetrace.note')}: ${e.title}`}
              disabled={busy} checked={!!e.selected} onChange={event => change(i, { selected: event.target.checked })} />
            <button type="button" className="nt-entry-toggle" aria-expanded={expanded === i} aria-controls={`${dialogId}-entry-${i}`} onClick={() => setExpanded(expanded === i ? null : i)}>
              <span className="nt-entry-icon"><NoteIcon task={e.kind === 'task'} /></span>
              <span className="nt-entry-heading">
                <span className="nt-entry-kind">{e.kind === 'task' ? t('notetrace.task') : t('notetrace.note')}</span>
                <span className="nt-entry-title">{e.title || t('notetrace.title')}</span>
                {(e.existing || e.due_date || e.reminder_choice === 'choose' || e.reminder_choice === 'set' || e.warning) && <span className="nt-entry-meta">
                  {e.existing && <span>{t('notetrace.alreadySaved')}</span>}
                  {e.due_date && <span>{t('notetrace.dueDate')}: {e.due_date}</span>}
                  {e.reminder_choice === 'set' && <span>{t('notetrace.reminder')}: {e.reminder_local.replace('T', ' ')} · {e.time_zone}</span>}
                  {e.reminder_choice === 'choose' && <span className="nt-warning">{t('notetrace.chooseTime')}</span>}
                  {e.warning && <span className="nt-warning">{e.warning}</span>}
                </span>}
              </span>
              <Chevron expanded={expanded === i} />
            </button>
          </div>
          <div id={`${dialogId}-entry-${i}`} hidden={expanded !== i}>
          <fieldset disabled={busy} className="nt-entry-fields">
          <legend className="nt-sr-only">{e.title || t('notetrace.title')}</legend>
          {e.existing && <div className="nt-existing">
            <a className="nt-link" href={e.existing.url} target="_blank" rel="noopener noreferrer">{t('notetrace.open')}</a>
            <label className="nt-checkbox-label"><input type="checkbox" checked={!!e.copy} onChange={event => change(i, { copy: event.target.checked, selected: event.target.checked })} />{t('notetrace.createCopy')}</label>
          </div>}
          {e.assignee !== undefined && <p className="nt-hint">{t('notetrace.assignee')}: {e.assignee || t('notetrace.unclear')}</p>}
          <label className="nt-label">{t('notetrace.title')}<input className="nt-field" value={e.title} onChange={event => change(i, { title: event.target.value })} /></label>
          <label className="nt-label">{t('notetrace.markdown')}<textarea className={`nt-field nt-markdown${e.kind === 'note' ? ' nt-markdown-note' : ''}`} value={e.markdown} onChange={event => change(i, { markdown: event.target.value })} /></label>
          <label className="nt-label">{t('notetrace.labels')}<input className="nt-field" value={e.labels.join(', ')} onChange={event => change(i, { labels: event.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></label>
          {e.kind === 'task' && <>
            {e.deadline_quote && <blockquote className="nt-deadline">{e.deadline_quote}</blockquote>}
            <div className="nt-field-grid">
            <label className="nt-label">{t('notetrace.dueDate')}<input className="nt-field" type="date" value={e.due_date || ''} onChange={event => change(i, { due_date: event.target.value, reminder_local: '', reminder_choice: e.reminder_choice === 'none' ? 'none' : 'choose' })} /></label>
            <label className="nt-label">{t('notetrace.timeZone')}<input className="nt-field" value={e.time_zone} onChange={event => change(i, { time_zone: event.target.value })} /></label>
            </div>
            <label className="nt-label">{t('notetrace.reminder')}<span className="nt-select"><select className="nt-field" value={e.reminder_choice} onChange={event => change(i, { reminder_choice: event.target.value })}>
              <option value="choose">{t('notetrace.chooseTime')}</option><option value="none">{t('notetrace.noReminder')}</option><option value="set">{t('notetrace.setReminder')}</option>
            </select><Chevron /></span></label>
            {e.reminder_choice === 'set' && <input className="nt-field" aria-label={t('notetrace.reminder')} type="datetime-local" value={e.reminder_local} onChange={event => change(i, { reminder_local: event.target.value })} />}
          </>}
          </fieldset>
          </div>
        </div>)}
        {draft && <p className="nt-hint nt-notifications">{draft.notifications?.message}</p>}
      </>}
      </div>
      <footer className="nt-dialog-footer">
        <button className="nt-button" disabled={busy} onClick={onClose}>{saved ? t('notetrace.done') : t('notetrace.cancel')}</button>
        {!saved && <button className="nt-button nt-primary-button" disabled={busy || !entries.some(e => e.selected)} onClick={save}>{t('notetrace.save')}</button>}
      </footer>
    </section>
  </div>;
}
