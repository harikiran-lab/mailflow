import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { flowRequest,openFlowSource } from './api.js';
import { ACTION_LABELS } from './labels.js';

export default function ProposalCard({proposal,onApplied}) {
  const {t}=useTranslation();
  const [current,setCurrent]=useState(proposal),[selected,setSelected]=useState(proposal.messages.map(m=>m.id)),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [draft,setDraft]=useState({to:proposal.args.to?.join(', ')||'',subject:proposal.args.subject||'',body:proposal.args.body||''});
  const [receipts,setReceipts]=useState(proposal.receipts||[]);
  const apply=async()=>{
    setBusy(true);setError('');
    try{
      let p=current;
      const edited=selected.length!==current.messages.length||current.action==='draft'&&(draft.subject!==current.args.subject||draft.body!==current.args.body||draft.to!==current.args.to.join(', '));
      if(edited){
        p=await flowRequest('flow/proposals',{action:current.action,message_ids:selected,...current.args,...(current.action==='draft'?{account_id:current.args.accountId,to:draft.to.split(',').map(s=>s.trim()).filter(Boolean),subject:draft.subject,body:draft.body}:{})});
        setCurrent(p);return;
      }
      const result=await flowRequest(`flow/proposals/${p.id}/confirm`,{confirm:true});setReceipts(result.receipts);setCurrent({...p,status:'done'});onApplied?.(result);
      window.dispatchEvent(new CustomEvent('mailflow:refresh'));
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  return <section className="flow-proposal" aria-label={t('flow.reviewChanges')}>
    <div className="flow-row"><span className="flow-eyebrow">{t('flow.preview')}</span><span className="flow-pill">{t(ACTION_LABELS[current.action])}</span></div>
    <h4>{t('flow.reviewChanges')}</h4>
    <p className="flow-muted">{current.action==='snooze'?t('flow.snoozeConversation'):t('flow.previewHelp')}</p>
    {current.messages.map(m=><label className="flow-preview-email" key={m.id}><input type="checkbox" disabled={busy||current.status==='done'||['draft','capture','snooze'].includes(current.action)} checked={selected.includes(m.id)} onChange={e=>setSelected(e.target.checked?[...selected,m.id]:selected.filter(id=>id!==m.id))}/><span><strong>{m.subject}</strong><small>{m.from_email}</small></span><button className="flow-link" onClick={e=>{e.preventDefault();openFlowSource(m).catch(e=>setError(e.message));}}>{t('flow.view')}</button></label>)}
    {current.action==='draft'&&<div className="flow-fields"><label>{t('flow.to')}<input disabled={current.status==='done'} value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></label><label>{t('flow.subject')}<input disabled={current.status==='done'} value={draft.subject} onChange={e=>setDraft({...draft,subject:e.target.value})}/></label><label>{t('flow.draftBody')}<textarea rows={5} disabled={current.status==='done'} value={draft.body} onChange={e=>setDraft({...draft,body:e.target.value})}/></label></div>}
    {current.args.folder&&<p>{t('flow.destination')}: <strong>{current.args.folder}</strong></p>}
    {current.args.until&&<p>{t('flow.until')}: {new Date(current.args.until).toLocaleString()}</p>}
    {current.args.category&&<p>{t('flow.category')}: {current.args.category}</p>}
    {['read','star'].includes(current.action)&&<p>{current.action==='read'?(current.args.read?t('flow.markRead'):t('flow.markUnread')):(current.args.starred?t('flow.star'):t('flow.unstar'))}</p>}
    {current.action==='capture'&&current.args.entries?.map((e,i)=><div className="flow-preview-email" key={i}><span><strong>{e.title}</strong><small>{e.markdown?.slice(0,400)}{e.due_date&&` · ${e.due_date}`}{e.reminder_at&&` · ${e.reminder_at}`}</small></span></div>)}
    {error&&<p className="flow-error" role="alert">{error}</p>}
    {receipts.map((r,i)=><p className={r.status==='applied'?'flow-success':'flow-error'} key={i}>{r.status==='applied'?t('flow.applied'):r.error}</p>)}
    {current.status!=='done'&&<button className="flow-button flow-primary" disabled={busy||(!selected.length&&current.action!=='draft')} onClick={apply}>{busy?t('flow.working'):t('flow.applyPreview')}</button>}
    <small className="flow-muted">{t('flow.previewExpiry')}</small>
  </section>;
}
