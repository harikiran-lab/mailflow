import { useEffect,useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/index.js';
import { flowRequest,openFlowSource,askFlow } from './api.js';
import { openCapture } from '../notetrace/api.js';
import FlowIcon from './FlowIcon.jsx';

export default function AIInbox() {
  const {t}=useTranslation();
  const user=useStore(s=>s.user),selected=useStore(s=>s.selectedAccountId),plugins=useStore(s=>s.enabledPlugins);
  const [scope,setScope]=useState(selected||''),[status,setStatus]=useState(null),[inbox,setInbox]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{
    const abort=new AbortController();
    const load=async()=>{try{const s=await flowRequest('flow/status',null,'GET',abort.signal);setStatus(s);if(s.allowed&&s.features.inbox){const data=await flowRequest('flow/inbox'+(scope?'?account_id='+scope:''),null,'GET',abort.signal);setInbox(data);}setError('');}catch(e){if(e.name!=='AbortError')setError(e.message);}};
    load();const timer=setInterval(load,15000);return ()=>{abort.abort();clearInterval(timer);};
  },[scope]);
  const selectedAccounts=status?.accounts.filter(a=>scope?a.id===scope:a.include_in_unified_inbox!==false)||[];
  const enabled=selectedAccounts.filter(a=>a.config.enabled);
  const items=inbox?.items||[];
  const actionItems=items.filter(i=>i.kind==='action'),topics=items.filter(i=>i.kind==='topic'),followups=items.filter(i=>i.kind==='followup');
  const jobs=selectedAccounts.filter(a=>['pending','running'].includes(a.job?.status));
  const updated=inbox?.accounts.map(a=>a.updated_at).filter(Boolean).sort().at(-1);
  const refresh=async()=>{setBusy(true);try{await flowRequest('flow/refresh',{account_ids:selectedAccounts.map(a=>a.id)});setStatus({...status,accounts:status.accounts.map(a=>enabled.some(e=>e.id===a.id)?{...a,job:{status:'pending'}}:a)});setError('');}catch(e){setError(e.message);}finally{setBusy(false);}};
  const toggle=async(a,value)=>{setBusy(true);try{await flowRequest('flow/accounts',{account_id:a.id,enabled:value},'PATCH');setStatus(await flowRequest('flow/status'));}catch(e){setError(e.message);}finally{setBusy(false);}};
  const dismiss=async(item,snooze=false)=>{try{await flowRequest('flow/dismiss',{id:item.id,...(snooze?{until:new Date(Date.now()+86400000).toISOString()}:{})});setInbox({...inbox,items:items.filter(i=>i.id!==item.id)});}catch(e){setError(e.message);}};
  const view=item=>openFlowSource(item).catch(e=>setError(e.message));
  const capture=async item=>{try{const live=await flowRequest('flow/source?key='+encodeURIComponent(item.source_key));openCapture(live,'task');}catch(e){setError(e.message);}};
  const section=(title,description,entries,icon)=><section className="flow-inbox-section"><div className="flow-section-title"><span className="flow-section-icon">{icon}</span><div><h2>{title}</h2><p>{description}</p></div><span className="flow-count">{entries.length}</span></div>{entries.length?<div className="flow-card-grid">{entries.map(item=><article className={`flow-inbox-card flow-card-${item.kind}`} key={item.id}><div className="flow-row"><span className="flow-eyebrow">{item.from_email}</span><span className="flow-muted">{item.date?new Date(item.date).toLocaleDateString():''}</span></div><h3>{item.title}</h3><p>{item.summary}</p><details className="flow-evidence"><summary>{t('flow.showEvidence')}</summary><blockquote>{item.quote}</blockquote></details><div className="flow-card-actions"><button className="flow-button" onClick={()=>view(item)}>↗ {t('flow.viewEmail')}</button>{item.kind==='action'&&plugins.includes('notetrace')&&<button className="flow-link" onClick={()=>capture(item)}>＋ {t('flow.createTask')}</button>}<button className="flow-icon-button" title={t('flow.snoozeSuggestion')} aria-label={t('flow.snoozeSuggestion')} onClick={()=>dismiss(item,true)}>◷</button><button className="flow-icon-button" title={t('flow.dismiss')} aria-label={t('flow.dismiss')} onClick={()=>dismiss(item)}>✓</button></div></article>)}</div>:<div className="flow-section-empty">{t('flow.noneHere')}</div>}</section>;
  return <main className="flow-ui flow-inbox">
    <div className="flow-inbox-topbar"><span className="flow-label"><FlowIcon size={17}/> {t('flow.aiInbox')}</span><select aria-label={t('flow.accountScope')} value={scope} onChange={e=>{setScope(e.target.value);setInbox(null);}}><option value="">{t('flow.unifiedAccounts')}</option>{status?.accounts.map(a=><option key={a.id} value={a.id}>{a.name||a.email_address}</option>)}</select><button className="flow-button" disabled={busy||!enabled.length||jobs.length>0} onClick={refresh}>↻ {t('flow.refresh')}</button></div>
    <div className="flow-inbox-content"><header className="flow-briefing"><div className="flow-eyebrow"><span className="flow-live-dot"/>{t('flow.yourBriefing')}</div><h1>{t('flow.greeting',{name:user?.display_name||user?.username||''})}<br/>{t('flow.focusOnWhatMatters')}</h1><p>{t('flow.briefingHelp')}</p><div className="flow-briefing-bottom"><span className="flow-pill">{jobs.length?t('flow.analyzing'):updated?t('flow.updated',{time:new Date(updated).toLocaleString()}):t('flow.readyWhenYouAre')}</span><button className="flow-button flow-primary" onClick={()=>askFlow(t('flow.briefingPrompt'))}><FlowIcon size={16}/>{t('flow.askAboutInbox')}</button></div><div className="flow-briefing-orbit" aria-hidden="true"><FlowIcon size={90}/></div></header>
      {error&&<p className="flow-error" role="alert">{error}</p>}
      {status&&(!status.allowed||!status.features.inbox)&&<div className="flow-setup"><h2>{t('flow.enableAI')}</h2><p>{t('flow.enableAIHelp')}</p></div>}
      {status?.allowed&&status.features.inbox&&<>
        {!enabled.length&&<div className="flow-setup"><div className="flow-brand-icon"><FlowIcon/></div><h2>{t('flow.makeRoom')}</h2><p>{t('flow.optInHelp')}</p></div>}
        <details className="flow-account-settings" open={!enabled.length}><summary>{t('flow.analysisAccounts')}</summary><p className="flow-muted">{t('flow.analysisDisclosure')}</p>{selectedAccounts.map(a=><div className="flow-account-row" key={a.id}><label><input type="checkbox" checked={!!a.config.enabled} disabled={busy} onChange={e=>toggle(a,e.target.checked)}/><span><strong>{a.name||a.email_address}</strong><small>{a.email_address}</small></span></label><span className="flow-pill">{a.job?.status||t('flow.off')}</span>{a.job?.error&&<p className="flow-error">{a.job.error}</p>}</div>)}</details>
        {jobs.length>0&&<div className="flow-progress" role="status"><span className="flow-live-dot"/>{t('flow.analyzingHelp')}{inbox?.accounts.map(a=><span key={a.account_id}>{a.scanned||0} / {a.total||'…'}</span>)}</div>}
        {enabled.length>0&&<><div className="flow-metrics"><div><strong>{actionItems.length}</strong><span>{t('flow.suggestedActions')}</span></div><div><strong>{followups.length}</strong><span>{t('flow.possibleFollowups')}</span></div><div><strong>{topics.length}</strong><span>{t('flow.catchUpTopics')}</span></div></div>{section(t('flow.suggestedActions'),t('flow.actionsHelp'),actionItems,'↗')}{section(t('flow.possibleFollowups'),t('flow.followupsHelp'),followups,'◷')}{section(t('flow.catchUpTopics'),t('flow.topicsHelp'),topics,'◇')}<p className="flow-inbox-disclaimer">{t('flow.coverageHelp')}</p></>}
      </>}
    </div>
  </main>;
}
