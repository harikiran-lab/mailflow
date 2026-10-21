import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { registerSlot, registerCollector, registerRuntime, registerPluginMeta } from '../registry.js';
import { useStore } from '../../store/index.js';
import { api } from '../../utils/api.js';
import { resolveContextMenuMessage } from '../../utils/contextMenuPolicy.js';
import { openCapture } from './api.js';
import NoteTraceSettings from './NoteTraceSettings.jsx';
import CaptureModal from './CaptureModal.jsx';
import MessageActions from './MessageActions.jsx';
import { AiIcon } from './Icons.jsx';
import './styles.css';

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

export function AiActions({ message, result, actionId }) {
  const { t } = useTranslation();
  if (result.status !== 'done' || !result.text) return null;
  return <div className="notetrace-ui nt-ai-actions">
    <button className="nt-button nt-ai-button" onClick={() => openCapture(message, 'summary', result)}><AiIcon />{t('notetrace.saveResult')}</button>
    {actionId !== 'summarize' && <button className="nt-button nt-ai-button" onClick={() => openCapture(message, 'actions', result)}><AiIcon />{t('notetrace.saveActions')}</button>}
  </div>;
}

registerPluginMeta('notetrace', { settingsLocation: { tab: 'integrations', subtab: 'apps', labelKey: 'notetrace.settings' } });
registerRuntime({ pluginId: 'notetrace', component: CaptureRuntime });
registerSlot('settings-apps', { pluginId: 'notetrace', render: () => <NoteTraceSettings /> });
registerSlot('message-toolbar-actions', { pluginId: 'notetrace', render: ctx => <MessageActions key={ctx.message.id} {...ctx} /> });
registerSlot('ai-result-actions', { pluginId: 'notetrace', render: ctx => <AiActions {...ctx} /> });
registerCollector('context-menu-actions', { pluginId: 'notetrace', build: ({ message, variant, t }) => [
  { label: t('notetrace.saveEmail'), action: async () => openCapture(await resolveContextMenuMessage(message, variant, api.resolveMessage), 'note') },
  { label: t('notetrace.createTask'), action: async () => openCapture(await resolveContextMenuMessage(message, variant, api.resolveMessage), 'task') },
] });
