import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { captureRequest } from './api.js';
import { NoteIcon, Chevron } from './Icons.jsx';

export default function NoteTraceSettings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [zone, setZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(true);
  const panelId = useId();
  useEffect(() => {
    let active = true;
    captureRequest('/status').then(data => { if (active) { setStatus(data); setUrl(data.url || ''); setZone(data.time_zone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'); } }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  const connect = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try { setStatus(await captureRequest('/connect', { url, token, time_zone: zone })); setToken(''); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const disconnect = async () => {
    setBusy(true); setError('');
    try { setStatus(await captureRequest('/disconnect', null, 'DELETE')); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <section className="notetrace-ui nt-settings">
    <button type="button" className="nt-settings-header" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(!expanded)}>
      <span className="nt-settings-icon"><NoteIcon /></span>
      <span className="nt-settings-heading"><span className="nt-settings-title-row"><strong>{t('notetrace.name')}</strong><span className={`nt-connection-badge ${status?.connected ? 'nt-connected' : ''}`} role="status">{!status ? t('common.loading') : status.connected ? t('admin.integrations.carddav.connected') : t('admin.integrations.carddav.notConnected')}</span></span><span className="nt-settings-description">{t('notetrace.settingsDescription')}</span></span>
      <Chevron expanded={expanded} />
    </button>
    <div id={panelId} className="nt-settings-body" hidden={!expanded}>
    {error && <p className="nt-settings-error" role="alert">{error}</p>}
    {status?.connected ? <>
      <p className="nt-settings-account">{t('notetrace.connected', { account: status.account })} · {status.time_zone}</p>
      <div className="nt-settings-actions"><a className="nt-button" href={status.url} target="_blank" rel="noopener noreferrer">{t('notetrace.open')} ↗</a>
      <button className="nt-button" type="button" disabled={busy} onClick={disconnect}>{busy ? t('notetrace.working') : t('notetrace.disconnect')}</button></div>
      {status.notifications?.message && <p className="nt-settings-help">{status.notifications.message}</p>}
    </> : <form onSubmit={connect} className="nt-settings-form">
      <p className="nt-settings-help">{t('notetrace.setup')}</p>
      <label className="nt-label">{t('notetrace.server')}<input className="nt-field" required type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://notes.example.com" /></label>
      <label className="nt-label">{t('notetrace.token')}<input className="nt-field" required type="password" autoComplete="new-password" value={token} onChange={e => setToken(e.target.value)} /></label>
      <label className="nt-label">{t('notetrace.timeZone')}<input className="nt-field" required value={zone} onChange={e => setZone(e.target.value)} /></label>
      <button className="nt-button nt-primary-button" disabled={busy || !status} type="submit">{busy ? t('notetrace.working') : t('notetrace.connect')}</button>
    </form>}
    </div>
  </section>;
}
