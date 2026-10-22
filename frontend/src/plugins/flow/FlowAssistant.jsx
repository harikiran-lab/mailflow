import { useEffect,useRef,useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/index.js';
import { renderMarkdown } from '../../utils/renderMarkdown.js';
import { flowRequest,streamFlow,openFlowSource } from './api.js';
import { openCapture } from '../notetrace/api.js';
import FlowIcon from './FlowIcon.jsx';
import ProposalCard from './ProposalCard.jsx';
import { STARTER_PROMPTS } from './labels.js';

export default function FlowAssistant() {
  const {t}=useTranslation();
  const userId=useStore(s=>s.user?.id),selectedAccount=useStore(s=>s.selectedAccountId),messageId=useStore(s=>s.selectedMessageId),plugins=useStore(s=>s.enabledPlugins),scale=useStore(s=>s.fontSize)/100;
  const [open,setOpen]=useState(false),[status,setStatus]=useState(null),[scope,setScope]=useState(selectedAccount||''),[prompt,setPrompt]=useState(''),[messages,setMessages]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[conversation,setConversation]=useState(null),[history,setHistory]=useState([]),[includeMessage,setIncludeMessage]=useState(true),[position,setPosition]=useState(null);
  const controller=useRef(null),dialog=useRef(null),input=useRef(null),bottom=useRef(null),drag=useRef(null),openRef=useRef(false);
  const eligible=status?.accounts?.filter(a=>scope?a.id===scope:a.include_in_unified_inbox!==false)||[];
  const scopeIds=eligible.map(a=>a.id);
  useEffect(()=>{openRef.current=open;},[open]);
  useEffect(()=>()=>controller.current?.abort(),[]);
  useEffect(()=>{
    try{const saved=JSON.parse(localStorage.getItem(`mailflow_flow_position:${userId}`));if(saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y))setPosition(saved);}catch{/* Position is optional. */}
  },[userId]);
  useEffect(()=>{
    const clamp=()=>setPosition(p=>p?{x:Math.max(8,Math.min(p.x,window.innerWidth/scale-68)),y:Math.max(8,Math.min(p.y,window.innerHeight/scale-68))}:null);
    window.addEventListener('resize',clamp);clamp();return ()=>window.removeEventListener('resize',clamp);
  },[scale]);
  useEffect(()=>{
    if(!open)return;
    const abort=new AbortController();
    Promise.all([flowRequest('flow/status',null,'GET',abort.signal),flowRequest('flow/conversations',null,'GET',abort.signal)]).then(([s,h])=>{setStatus(s);setHistory(h.conversations);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
    const previous=document.activeElement;dialog.current?.focus();
    return ()=>{abort.abort();previous?.focus?.();};
  },[open]);
  useEffect(()=>{bottom.current?.scrollIntoView?.({block:'nearest'});},[messages]);
  useEffect(()=>{
    const handler=e=>{setOpen(true);setPrompt(e.detail?.prompt||'');if(e.detail?.messageId)setIncludeMessage(true);};
    window.addEventListener('mailflow:ask-flow',handler);return ()=>window.removeEventListener('mailflow:ask-flow',handler);
  },[]);
  useEffect(()=>{
    const handler=e=>{if(openRef.current){e.stopImmediatePropagation();setOpen(false);controller.current?.abort();}};
    window.addEventListener('popstate',handler,{capture:true});return ()=>window.removeEventListener('popstate',handler,{capture:true});
  },[]);
  useEffect(()=>{
    const handler=e=>{if(openRef.current){e.preventDefault();setOpen(false);controller.current?.abort();}};
    window.addEventListener('mailflow:before-back',handler);return ()=>window.removeEventListener('mailflow:before-back',handler);
  },[]);
  const close=()=>{controller.current?.abort();setOpen(false);};
  const patch=(id,fn)=>setMessages(ms=>ms.map(m=>m.id===id?fn(m):m));
  const send=async text=>{
    if(busy||!text.trim())return;
    setError('');setPrompt('');setBusy(true);
    const id=crypto.randomUUID();setMessages(ms=>[...ms,{id:crypto.randomUUID(),role:'user',text},{id,role:'assistant',text:'',tools:[],proposals:[],sources:[],captures:[]}]);
    const abort=new AbortController();controller.current=abort;
    try{
      await streamFlow({prompt:text,account_ids:scopeIds,...(conversation?{conversation_id:conversation}:{}),...(includeMessage&&messageId?{message_id:messageId}:{})},(type,data)=>{
        if(type==='conversation')setConversation(data.id);
        if(type==='text')patch(id,m=>({...m,text:m.text+data.delta}));
        if(type==='tool')patch(id,m=>({...m,tools:[...m.tools.filter(x=>x.name!==data.name),data]}));
        if(type==='proposal')patch(id,m=>({...m,proposals:[...m.proposals,data]}));
        if(type==='sources')patch(id,m=>({...m,sources:data.messages}));
        if(type==='capture')patch(id,m=>({...m,captures:[...m.captures,data]}));
      },abort.signal);
    }catch(e){if(e.name!=='AbortError')setError(e.message);else patch(id,m=>({...m,stopped:true}));}
    finally{setBusy(false);controller.current=null;input.current?.focus();}
  };
  const changeScope=value=>{controller.current?.abort();setScope(value);setConversation(null);setMessages([]);};
  const loadHistory=async id=>{try{const c=await flowRequest(`flow/conversations/${id}`);setConversation(id);setScope(c.account_ids.length===1?c.account_ids[0]:'');setMessages(c.messages.map(m=>({id:crypto.randomUUID(),role:m.role,text:m.content,proposals:[],tools:[],sources:[],captures:[]})));}catch(e){setError(e.message);}};
  const trap=e=>{
    e.stopPropagation();
    if(e.key==='Escape'){e.stopPropagation();close();return;}
    if(e.key==='Tab'){
      const controls=[...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')];const first=controls[0],last=controls.at(-1);
      if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }
  };
  const suggestions=STARTER_PROMPTS;
  return <div className="flow-ui">
    <button className="flow-fab" title={t('flow.openAssistant')} aria-label={t('flow.openAssistant')} style={position?{left:position.x,top:position.y,right:'auto',bottom:'auto'}:{}} onPointerDown={e=>{drag.current={x:e.clientX,y:e.clientY,origin:e.currentTarget.getBoundingClientRect(),moved:false};e.currentTarget.setPointerCapture?.(e.pointerId);}} onPointerMove={e=>{const d=drag.current;if(!d)return;if(Math.abs(e.clientX-d.x)+Math.abs(e.clientY-d.y)>8){d.moved=true;setPosition({x:Math.max(8,Math.min((d.origin.left+e.clientX-d.x)/scale,window.innerWidth/scale-68)),y:Math.max(8,Math.min((d.origin.top+e.clientY-d.y)/scale,window.innerHeight/scale-68))});}}} onPointerUp={()=>{if(drag.current?.moved&&position)localStorage.setItem(`mailflow_flow_position:${userId}`,JSON.stringify(position));else setOpen(true);drag.current=null;}} onClick={e=>{if(e.detail===0)setOpen(true);}}><FlowIcon size={28}/></button>
    {open&&<div className="flow-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}>
      <section ref={dialog} className="flow-chat" role="dialog" aria-modal="true" aria-labelledby="flow-chat-title" tabIndex={-1} onKeyDown={trap}>
        <header className="flow-chat-header"><div className="flow-brand-icon"><FlowIcon/></div><div><h2 id="flow-chat-title">Flow AI</h2><small>{t('flow.assistantSubtitle')}</small></div><button className="flow-icon-button" onClick={()=>{setMessages([]);setConversation(null);}} disabled={busy} title={t('flow.newChat')} aria-label={t('flow.newChat')}>＋</button><button className="flow-icon-button" aria-label={t('flow.close')} onClick={close}>×</button></header>
        <div className="flow-context"><select aria-label={t('flow.accountScope')} value={scope} disabled={busy} onChange={e=>changeScope(e.target.value)}><option value="">{t('flow.unifiedAccounts')}</option>{status?.accounts?.map(a=><option value={a.id} key={a.id}>{a.name||a.email_address}</option>)}</select>{messageId&&<label className="flow-context-check"><input type="checkbox" checked={includeMessage} onChange={e=>setIncludeMessage(e.target.checked)}/>{t('flow.selectedEmail')}</label>}</div>
        <div className="flow-chat-body">
          {!messages.length&&<div className="flow-welcome"><div className="flow-orbit"><FlowIcon size={42}/></div><h3>{t('flow.welcome')}</h3><p>{t('flow.welcomeHelp')}</p><div className="flow-starters">{suggestions.map(key=><button key={key} onClick={()=>setPrompt(t(key))}>{t(key)}<span>↗</span></button>)}</div>{history.length>0&&<details className="flow-history"><summary>{t('flow.recentChats')}</summary>{history.map(h=><div className="flow-row" key={h.id}><button className="flow-link" onClick={()=>loadHistory(h.id)}>{h.title}</button><button className="flow-icon-button" aria-label={t('flow.deleteChat')} onClick={async()=>{try{await flowRequest(`flow/conversations/${h.id}`,null,'DELETE');setHistory(history.filter(x=>x.id!==h.id));}catch(e){setError(e.message);}}}>×</button></div>)}</details>}</div>}
          {messages.map(m=><article key={m.id} className={`flow-message flow-message-${m.role}`}><small className="flow-eyebrow">{m.role==='user'?t('flow.you'):'Flow AI'}</small>{m.text&&<div className="flow-markdown" dangerouslySetInnerHTML={{__html:renderMarkdown(m.text)}} onClick={e=>{const link=e.target.closest('a');if(link){let url;try{url=new URL(link.href);}catch{return;}if(url.origin===window.location.origin&&url.searchParams.get('m')){e.preventDefault();close();openFlowSource({id:url.searchParams.get('m'),account_id:scopeIds[0]}).catch(e=>setError(e.message));}}}}/>}{m.stopped&&<p className="flow-muted">{t('flow.stopped')}</p>}{m.tools?.length>0&&<div className="flow-tools" aria-live="polite">{m.tools.map(tool=><span key={tool.name} className="flow-pill">{tool.status==='running'?'◌':tool.status==='failed'?'!':'✓'} {tool.name.replaceAll('_',' ')}</span>)}</div>}{m.proposals?.map(p=><ProposalCard key={p.id} proposal={p}/>)}{m.captures?.map(c=><button className="flow-button" key={c.draft_id} disabled={!plugins.includes('notetrace')} onClick={()=>{close();openCapture({id:c.message_id,subject:c.source.subject},c.mode||'note',null,c);}}>{t('flow.reviewCapture')}</button>)}{m.sources?.length>0&&<div className="flow-sources">{m.sources.map(s=><button key={s.id} onClick={()=>{close();openFlowSource(s).catch(e=>setError(e.message));}}>↗ {s.subject}</button>)}</div>}</article>)}
          {busy&&<div className="flow-thinking" role="status"><span/>{t('flow.thinking')}</div>}
          {error&&<p className="flow-error" role="alert">{error}</p>}<div ref={bottom}/>
        </div>
        <form className="flow-chat-compose" onSubmit={e=>{e.preventDefault();send(prompt);}}><textarea ref={input} value={prompt} maxLength={4000} rows={2} placeholder={t('flow.askPlaceholder')} aria-label={t('flow.askPlaceholder')} onChange={e=>setPrompt(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();send(prompt);}}}/><div className="flow-row"><small>{t('flow.reviewFooter')}</small>{busy?<button type="button" className="flow-button" onClick={()=>controller.current?.abort()}>{t('flow.stop')}</button>:<button className="flow-button flow-primary" disabled={!prompt.trim()||!scopeIds.length||!status?.allowed||!status?.features?.flow}>{t('flow.ask')} ↑</button>}</div></form>
      </section>
    </div>}
  </div>;
}
