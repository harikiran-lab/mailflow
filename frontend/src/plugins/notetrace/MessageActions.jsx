import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../utils/api.js';
import { captureRequest, openCapture } from './api.js';
import { AiIcon, Chevron, NoteIcon } from './Icons.jsx';

export default function MessageActions({ message }) {
  const { t } = useTranslation();
  const [ai, setAi] = useState(false);
  const [connected, setConnected] = useState(false);
  const [links, setLinks] = useState([]);
  const [open, setOpen] = useState(false);
  const container = useRef(null);
  const trigger = useRef(null);
  const menuId = useId();
  useEffect(() => {
    let active = true;
    api.ai.status().then(s => { if (active) setAi(s.enabled && s.features?.summarize); }).catch(() => {});
    captureRequest('/status').then(s => { if (active) setConnected(s.connected); }).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = event => {
      if (event?.detail?.messageId && event.detail.messageId !== message.id) return;
      captureRequest(`/messages/${encodeURIComponent(message.id)}`).then(data => {
        if (active) setLinks([...new Set(data.entries.filter(e => e.status !== 'removed').map(e => e.url))]);
      }).catch(() => {});
    };
    refresh();
    window.addEventListener('mailflow:notetrace-saved', refresh);
    return () => { active = false; window.removeEventListener('mailflow:notetrace-saved', refresh); };
  }, [message.id]);
  useEffect(() => {
    if (!open) return;
    container.current?.querySelector('[role="menuitem"]')?.focus();
    const outside = event => { if (!container.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const capture = mode => { close(); openCapture(message, mode); };
  const navigate = event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === 'Tab') setOpen(false);
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [...container.current.querySelectorAll('[role="menuitem"]')];
    const current = items.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };
  return <div className="notetrace-ui nt-menu-anchor" ref={container} onKeyDown={navigate}>
    <button ref={trigger} type="button" className="nt-menu-trigger btn-press" aria-label={t('notetrace.name')}
      title={links.length ? `${t('notetrace.name')} · ${t('notetrace.alreadySaved')}` : t('notetrace.name')}
      aria-haspopup="menu" aria-controls={open ? menuId : undefined} aria-expanded={open}
      onClick={() => setOpen(v => !v)} onKeyDown={event => {
        if (['ArrowDown', 'ArrowUp'].includes(event.key) && !open) { event.preventDefault(); event.stopPropagation(); setOpen(true); }
      }}>
      <NoteIcon /><Chevron expanded={open} />
      {links.length > 0 && <span className="nt-saved-dot" role="img" aria-label={t('notetrace.alreadySaved')} />}
    </button>
    {open && <div id={menuId} role="menu" aria-label={t('notetrace.name')} className="nt-menu">
      <button type="button" role="menuitem" onClick={() => capture('note')}><NoteIcon />{t('notetrace.saveEmail')}</button>
      <button type="button" role="menuitem" onClick={() => capture('task')}><NoteIcon task />{t('notetrace.createTask')}</button>
      {ai && connected && <button type="button" role="menuitem" className="nt-ai-action" onClick={() => capture('combined')}><AiIcon />{t('notetrace.prepareBoth')}</button>}
      {!connected && <p className="nt-menu-hint">{t('notetrace.connectFirst')}</p>}
      {links.length > 0 && <div className="nt-menu-saved">
        <p className="nt-menu-hint">{t('notetrace.alreadySaved')}</p>
        {links.map((link, index) => <a role="menuitem" key={link} href={link} target="_blank" rel="noopener noreferrer" onClick={close}>
          <NoteIcon />{t('notetrace.open')}{links.length > 1 ? ` (${index + 1})` : ''}
        </a>)}
      </div>}
    </div>}
  </div>;
}
