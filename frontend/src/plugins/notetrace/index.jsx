import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { registerSlot, registerCollector, registerRuntime, registerPluginMeta } from '../registry.js';
import { useStore } from '../../store/index.js';
import { api } from '../../utils/api.js';
import { resolveContextMenuMessage } from '../../utils/contextMenuPolicy.js';
import { captureRequest, openCapture } from './api.js';
import NoteTraceSettings from './NoteTraceSettings.jsx';
import CaptureModal from './CaptureModal.jsx';
import { button } from './styles.js';

function CaptureRuntime() {
  const userId = useStore(s => s.user?.id);
  const [opening, setOpening] = useState(null);
  useEffect(() => {
    const listener = event => setOpening({ ...event.detail, id: crypto.randomUUID(), userId });
    window.addEventListener('mailflow:notetrace-capture', listener);
    return () => window.removeEventListener('mailflow:notetrace-capture', listener);
  }, [userId]);
  return opening && opening.userId === userId ? <CaptureModal key={opening.id} {...opening} onClose={() => setOpening(null)} /> : null;
}

function MessageActions({ message }) {
  const { t } = useTranslation();
  const [ai, setAi] = useState(false);
  const [connected, setConnected] = useState(false);
  const [links, setLinks] = useState([]);
  useEffect(() => {
    let active = true;
    api.ai.status().then(s => { if (active) setAi(s.enabled && s.features?.summarize); }).catch(() => {});
    captureRequest('/status').then(s => { if (active) setConnected(s.connected); }).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    const refresh = () => captureRequest(`/messages/${encodeURIComponent(message.id)}`).then(data => {
      if (active) setLinks(data.entries.filter(e => e.status !== 'removed').map(e => e.url));
    }).catch(() => {});
    refresh();
    window.addEventListener('mailflow:notetrace-saved', refresh);
    return () => { active = false; window.removeEventListener('mailflow:notetrace-saved', refresh); };
  }, [message.id]);
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '10px 0' }}>
    <button style={button} onClick={() => openCapture(message, 'note')}>{t('notetrace.saveEmail')}</button>
    <button style={button} onClick={() => openCapture(message, 'task')}>{t('notetrace.createTask')}</button>
    {ai && connected && <button style={button} onClick={() => openCapture(message, 'combined')}>{t('notetrace.prepareBoth')}</button>}
    {!connected && <small>{t('notetrace.connectFirst')}</small>}
    {links.map(link => <a key={link} href={link} target="_blank" rel="noopener noreferrer">{t('notetrace.alreadySaved')}</a>)}
  </div>;
}

function AiActions({ message, result, actionId }) {
  const { t } = useTranslation();
  if (result.status !== 'done' || !result.text) return null;
  return <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
    <button style={button} onClick={() => openCapture(message, 'summary', result)}>{t('notetrace.saveResult')}</button>
    {actionId !== 'summarize' && <button style={button} onClick={() => openCapture(message, 'actions', result)}>{t('notetrace.saveActions')}</button>}
  </div>;
}

registerPluginMeta('notetrace', { settingsLocation: { tab: 'integrations', subtab: 'apps', labelKey: 'notetrace.settings' } });
registerRuntime({ pluginId: 'notetrace', component: CaptureRuntime });
registerSlot('settings-apps', { pluginId: 'notetrace', render: () => <NoteTraceSettings /> });
registerSlot('message-capture-actions', { pluginId: 'notetrace', render: ctx => <MessageActions key={ctx.message.id} {...ctx} /> });
registerSlot('ai-result-actions', { pluginId: 'notetrace', render: ctx => <AiActions {...ctx} /> });
registerCollector('context-menu-actions', { pluginId: 'notetrace', build: ({ message, variant, t }) => [
  { label: t('notetrace.saveEmail'), action: async () => openCapture(await resolveContextMenuMessage(message, variant, api.resolveMessage), 'note') },
  { label: t('notetrace.createTask'), action: async () => openCapture(await resolveContextMenuMessage(message, variant, api.resolveMessage), 'task') },
] });
