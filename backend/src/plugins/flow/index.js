import { Router } from 'express';
import { requireAuth, isPluginActivated, startFlowRun,getFlowRun,listFlowRuns,stopFlowRun,flowStatus, setFlowPreferences, setFlowAnalysis, setFlowAccount, requestFlowRefresh, flowInbox, dismissFlowItem, runFlowChat, flowConversations, deleteFlowConversation, flowIngest, flowEventsActive, prepareFlowAction, confirmFlowAction, getFlowAction, resolveFlowSource } from '../api.js';

const router=Router();
router.use(requireAuth);
router.use(async(req,res,next)=>await isPluginActivated(req.session.userId,'flow')?next():res.status(409).json({error:'Enable Flow AI in Settings → Plugins first.'}));
const handle=fn=>async(req,res)=>{try{res.json(await fn(req));}catch(e){res.status(e.status>=400&&e.status<600?e.status:500).json({error:e.status?e.message:'Flow AI could not finish. Try again.'});}};
router.get('/status',handle(req=>flowStatus(req.session.userId)));
router.patch('/preferences',handle(req=>setFlowPreferences(req.session.userId,req.body)));
router.patch('/analysis',handle(req=>setFlowAnalysis(req.session.userId,req.body)));
router.patch('/accounts',handle(req=>setFlowAccount(req.session.userId,req.body)));
router.get('/inbox',handle(req=>flowInbox(req.session.userId,req.query.account_id?{account_ids:[req.query.account_id]}:{})));
router.post('/refresh',handle(req=>requestFlowRefresh(req.session.userId,req.body)));
router.post('/dismiss',handle(req=>dismissFlowItem(req.session.userId,req.body)));
router.get('/source',handle(req=>resolveFlowSource(req.session.userId,req.query.key,req.query.id)));
router.get('/conversations',handle(req=>flowConversations(req.session.userId)));
router.get('/conversations/:id',handle(req=>flowConversations(req.session.userId,req.params.id)));
router.delete('/conversations/:id',handle(req=>deleteFlowConversation(req.session.userId,req.params.id)));
router.post('/proposals',handle(req=>prepareFlowAction(req.session.userId,req.body)));
router.get('/proposals/:id',handle(req=>getFlowAction(req.session.userId,req.params.id)));
router.post('/proposals/:id/confirm',handle(req=>confirmFlowAction(req.session.userId,req.params.id,req.body.confirm)));
router.post('/runs',handle(req=>startFlowRun(req.session.userId,req.body)));
router.get('/runs',handle(req=>listFlowRuns(req.session.userId)));
router.get('/runs/:id',handle(req=>getFlowRun(req.session.userId,req.params.id)));
router.post('/runs/:id/stop',handle(req=>stopFlowRun(req.session.userId,req.params.id)));
router.post('/chat',async(req,res)=>{
  const controller=new AbortController();
  const close=()=>{if(!res.writableEnded)controller.abort();};
  req.once('aborted',close);res.once('close',close);
  const emit=(type,data)=>{if(controller.signal.aborted||res.destroyed)return;if(!res.headersSent){res.set({'Content-Type':'text/event-stream','Cache-Control':'no-cache','X-Accel-Buffering':'no'});res.flushHeaders();}res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);};
  try{await runFlowChat(req.session.userId,req.body,emit,controller.signal);}
  catch(e){if(!controller.signal.aborted){if(!res.headersSent)res.status(e.status>=400&&e.status<600?e.status:500).json({error:e.status?e.message:'Flow AI request failed. Check the provider and try again.'});else emit('error',{error:e.status?e.message:'Flow AI request failed. Try again.'});}}
  finally{req.removeListener('aborted',close);res.removeListener('close',close);if(!res.writableEnded)res.end();}
});
export const flowPlugin={id:'flow',name:'Flow AI',version:'1.0.0',tier:1,router:{base:'/api/flow',handler:router},hooks:{mailIngested:{handler:flowIngest,isActive:flowEventsActive}}};
