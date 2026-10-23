import { useEffect,useRef,useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/index.js';
import { api } from '../../utils/api.js';
import { openReplyFromMessage } from '../../utils/composeFromMessage.js';
import { renderMarkdown } from '../../utils/renderMarkdown.js';
import { resolveFlowMessage } from './api.js';

export async function prepareFlowDraft(proposal) {
  const state=useStore.getState(),owner=state.user?.id;
  const source=proposal.messages?.[0];
  let compose={accountId:proposal.args.accountId,to:proposal.args.to.map(email=>({email})),subject:proposal.args.subject,body:renderMarkdown(proposal.args.body)};
  let message;
  if(source){
    message=await resolveFlowMessage(source);if(!message)return null;
    await openReplyFromMessage(message,{accounts:state.accounts,openCompose:data=>{compose={...data,body:renderMarkdown(proposal.args.body),subject:proposal.args.subject||data.subject};},getMessageBody:id=>api.getMessageBody(id)});
  }
  if(useStore.getState().user?.id!==owner)return null;
  return {compose,message,owner,multiple:!!compose.allRecipients?.length};
}
export async function openFlowDraft(prepared,replyAll=false) {
  const state=useStore.getState();if(state.user?.id!==prepared.owner)return false;
  const compose={...prepared.compose,cc:replyAll?prepared.compose.allRecipients||[]:[],isReplyAll:replyAll,source:'flowAI'};
  const opened=await state.openCompose(compose);
  if(opened&&useStore.getState().user?.id===prepared.owner&&prepared.message&&window.innerWidth>=768){useStore.getState().setThreadMessages(`__dl_${prepared.message.id}`,[prepared.message]);useStore.getState().openMessageWindow(prepared.message.id);}
  return opened;
}
export default function FlowDraftCard({proposal,autoOpen=false,onOpen}) {
  const {t}=useTranslation();
  const [prepared,setPrepared]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),attempted=useRef(false);
  const serialized=JSON.stringify(proposal);
  useEffect(()=>{let cancelled=false;prepareFlowDraft(JSON.parse(serialized)).then(value=>{if(!cancelled)setPrepared(value);}).catch(e=>{if(!cancelled)setError(e.message);});return ()=>{cancelled=true;};},[serialized]);
  useEffect(()=>{
    if(!autoOpen||!prepared||prepared.multiple||attempted.current||useStore.getState().composing)return;
    attempted.current=true;openFlowDraft(prepared).then(ok=>{if(ok)onOpen?.();else setError(t('flow.keepComposer'));}).catch(e=>setError(e.message));
  },[autoOpen,prepared,onOpen,t]);
  const open=async all=>{setBusy(true);try{if(await openFlowDraft(prepared,all)){onOpen?.();}else setError(t('flow.keepComposer'));}catch(e){setError(e.message);}finally{setBusy(false);}};
  return <section className="flow-draft-card"><div className="flow-row"><strong>✍️ {t('flow.draftReady')}</strong><span className="flow-pill">{t('flow.editBeforeSending')}</span></div><h4>{proposal.args.subject}</h4><p>{prepared?.multiple?t('flow.replyChoice'):t('flow.draftReadyHelp')}</p><div className="flow-card-actions">{prepared?.multiple?<><button className="flow-button" disabled={busy} onClick={()=>open(false)}>{t('flow.replySender')}</button><button className="flow-button flow-primary" disabled={busy} onClick={()=>open(true)}>{t('compose.replyAll')}</button></>:<button className="flow-button flow-primary" disabled={!prepared||busy} onClick={()=>open(false)}>{t('flow.openDraft')}</button>}</div>{error&&<p role="alert" className="flow-error">{error}</p>}</section>;
}
