import { lazy,Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/index.js';
import { registerSlot,registerRuntime,registerPluginMeta } from '../registry.js';
import FlowIcon from './FlowIcon.jsx';
import './styles.css';

const Assistant=lazy(()=>import('./FlowAssistant.jsx'));
const Inbox=lazy(()=>import('./AIInbox.jsx'));
function Runtime(){const userId=useStore(s=>s.user?.id);return <Suspense fallback={null}><Assistant key={userId}/></Suspense>;}
function InboxNavigation({collapsed}){
  const {t}=useTranslation();const active=useStore(s=>s.pluginView)==='flow-inbox';
  return <button className={`flow-nav ${active?'flow-nav-active':''}`} title={t('flow.aiInbox')} aria-label={t('flow.aiInbox')} aria-current={active?'page':undefined} onClick={()=>{useStore.getState().setPluginView('flow-inbox');useStore.getState().setMobileSidebarOpen(false);}}><FlowIcon size={19}/>{!collapsed&&<><span>{t('flow.aiInbox')}</span><small>AI</small></>}</button>;
}
registerRuntime({pluginId:'flow',component:Runtime});
registerSlot('sidebar-navigation',{pluginId:'flow',render:ctx=><InboxNavigation {...ctx}/>});
registerSlot('main-view',{pluginId:'flow',isActive:ctx=>ctx.view==='flow-inbox',render:()=> <Suspense fallback={null}><Inbox/></Suspense>});
registerPluginMeta('flow',{settingsLocation:{tab:'ai',labelKey:'admin.tabs.ai'}});
