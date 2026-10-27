import { Router } from 'express';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { developerPolicy, saveDeveloperPolicy, createToken, listTokens, revokeToken, createWebhook, listWebhooks, deleteWebhook, testWebhook, retryDelivery, externalAuth } from '../services/developerAccess.js';
import { availableTools, executeMailTool } from '../services/mailTools.js';
import { ownedAccounts, fail } from '../services/mailCapabilities.js';
import { prepareAction, confirmAction, getAction } from '../services/actionProposals.js';
import { embeddingConfig, saveEmbeddingConfig } from '../services/mailEmbeddings.js';
import { loadAiConfig } from '../services/aiProvider.js';
import { query } from '../services/db.js';

export const handleService=fn=>async(req,res)=>{try{res.json(await fn(req,res));}catch(e){res.status(e.status>=400&&e.status<600?e.status:500).json({error:e.status?e.message:'The request could not finish. Try again.'});}};
const owner=req=>({userId:req.session.userId});
export const developerRoutes=Router();
developerRoutes.use(requireAuth);
developerRoutes.get('/status',handleService(async()=>({policy:await developerPolicy()})));
developerRoutes.get('/settings',requireAdmin,handleService(async()=>({policy:await developerPolicy(),embeddings:await embeddingConfig(),features:(await loadAiConfig())?.features||{}})));
developerRoutes.patch('/settings',requireAdmin,handleService(async req=>{
  const policy=await saveDeveloperPolicy(req.body.policy||{});
  if(req.body.features){
    const features={flow:req.body.features.flow===true,inbox:req.body.features.inbox===true};
    await query(`UPDATE system_settings SET value=(value::jsonb || jsonb_build_object('features',COALESCE(value::jsonb->'features','{}'::jsonb)||$1::jsonb))::text,updated_at=NOW() WHERE key='ai_config'`,[JSON.stringify(features)]);
  }
  if(req.body.embeddings)await saveEmbeddingConfig(req.body.embeddings);
  return {policy,ok:true};
}));
developerRoutes.get('/tokens',handleService(async req=>({tokens:await listTokens(req.session.userId)})));
developerRoutes.post('/tokens',handleService(req=>createToken(req.session.userId,req.body)));
developerRoutes.delete('/tokens/:id',handleService(req=>revokeToken(req.session.userId,req.params.id)));
developerRoutes.get('/webhooks',handleService(req=>listWebhooks(req.session.userId)));
developerRoutes.post('/webhooks',handleService(req=>createWebhook(req.session.userId,req.body)));
developerRoutes.delete('/webhooks/:id',handleService(req=>deleteWebhook(req.session.userId,req.params.id)));
developerRoutes.post('/webhooks/:id/test',handleService(req=>testWebhook(req.session.userId,req.params.id)));
developerRoutes.post('/deliveries/:id/retry',handleService(req=>retryDelivery(req.session.userId,req.params.id)));
developerRoutes.post('/proposals',handleService(req=>prepareAction(owner(req),req.body)));
developerRoutes.get('/proposals/:id',handleService(req=>getAction(owner(req),req.params.id)));
developerRoutes.post('/proposals/:id/confirm',handleService(req=>{if(req.body.confirm!==true)throw fail('Explicit confirmation is required');return confirmAction(owner(req),req.params.id);}));

export const externalRoutes=Router();
externalRoutes.use(externalAuth('api'));
externalRoutes.get('/accounts',handleService(req=>executeMailTool(req.principal,'list_accounts',{})));
externalRoutes.get('/folders',handleService(req=>executeMailTool(req.principal,'list_folders',{account_id:req.query.account_id})));
externalRoutes.get('/messages',handleService(req=>executeMailTool(req.principal,'search_mail',{query:req.query.q||'',...(req.query.account_id?{account_ids:[req.query.account_id]}:{}),limit:Number(req.query.limit)||30,offset:Number(req.query.offset)||0})));
externalRoutes.get('/messages/:id',handleService(req=>executeMailTool(req.principal,'read_mail',{message_id:req.params.id,conversation:req.query.conversation==='true'})));
externalRoutes.post('/proposals',handleService(req=>prepareAction(req.principal,req.body)));
externalRoutes.get('/proposals/:id',handleService(req=>getAction(req.principal,req.params.id)));
externalRoutes.post('/proposals/:id/confirm',handleService(req=>{if(req.body.confirm!==true)throw fail('Explicit confirmation is required');return confirmAction(req.principal,req.params.id);}));
externalRoutes.post('/tools/:name',handleService(req=>executeMailTool(req.principal,req.params.name,req.body)));

export const mcpRoutes=Router();
mcpRoutes.use(externalAuth('mcp'));
mcpRoutes.post('/',async(req,res)=>{
  const handler=createMcpHandler(()=>{
    const server=new McpServer({name:'mailflow',version:'1.0.0'});
    for(const tool of availableTools(req.principal)){
      server.registerTool(tool.name,{description:tool.description,inputSchema:tool.schema,annotations:{readOnlyHint:!['prepare_action','prepare_capture','confirm_proposal'].includes(tool.name),destructiveHint:false}},async args=>{
        try{const data=await executeMailTool(req.principal,tool.name,args);return {content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data};}
        catch(e){return {isError:true,content:[{type:'text',text:e.status?e.message:'Mail operation failed'}]};}
      });
    }
    return server;
  },{legacy:'stateless'});
  try{await ownedAccounts(req.principal);await toNodeHandler(handler)(req,res,req.body);}
  catch{if(!res.headersSent)res.status(500).json({jsonrpc:'2.0',id:req.body?.id??null,error:{code:-32603,message:'MCP request failed'}});}
  finally{await handler.close();}
});
mcpRoutes.all('/',(_req,res)=>res.status(405).set('Allow','POST').json({error:'Use POST for stateless MCP requests'}));
