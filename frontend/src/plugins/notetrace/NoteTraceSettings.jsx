import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { captureRequest } from './api.js';

export default function NoteTraceSettings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState(null);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [zone, setZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
    <h3 style={{ marginTop: 0 }}>{t('notetrace.name')}</h3>
    <p>{t('notetrace.settingsDescription')}</p>
    {error && <p role="alert" style={{ color: 'var(--red)' }}>{error}</p>}
    {status?.connected ? <>
      <p>{t('notetrace.connected', { account: status.account })} · {status.time_zone}</p>
      <a className="nt-link" href={status.url} target="_blank" rel="noopener noreferrer">{t('notetrace.open')}</a>{' '}
      <button className="nt-button" type="button" disabled={busy} onClick={disconnect}>{t('notetrace.disconnect')}</button>
      <p style={{ fontSize: 12 }}>{status.notifications?.message}</p>
    </> : <form onSubmit={connect} className="nt-settings-form">
      <p style={{ fontSize: 12 }}>{t('notetrace.setup')}</p>
      <label className="nt-label">{t('notetrace.server')}<input className="nt-field" required type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://notes.example.com" /></label>
      <label className="nt-label">{t('notetrace.token')}<input className="nt-field" required type="password" autoComplete="new-password" value={token} onChange={e => setToken(e.target.value)} /></label>
      <label className="nt-label">{t('notetrace.timeZone')}<input className="nt-field" required value={zone} onChange={e => setZone(e.target.value)} /></label>
      <button className="nt-button nt-primary-button" disabled={busy || !status} type="submit">{busy ? t('notetrace.working') : t('notetrace.connect')}</button>
    </form>}
  </section>;
}
