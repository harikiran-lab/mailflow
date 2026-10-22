import { beforeAll,afterAll,beforeEach,describe,it,expect,vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import express from 'express';
import 'express-async-errors';
const state=vi.hoisted(()=>({db:null,turn:vi.fn(),complete:vi.fn(),fetch:vi.fn(),mutate:vi.fn()}));
vi.mock('./db.js',()=>({query:async(sql,args=[])=>{const r=await state.db.query(sql,args);return {rows:r.rows,rowCount:r.affectedRows};}}));
vi.mock('./aiProvider.js',()=>({getAiStatus:async()=>({enabled:true,features:{flow:true,inbox:true,compose:true,summarize:true}}),toolTurn:state.turn,completeText:state.complete,loadAiConfig:async()=>({features:{flow:true,inbox:true}})}));
vi.mock('./rateLimiter.js',()=>({consume:async()=>({limited:false})}));
vi.mock('./safeFetch.js',()=>({safeFetch:state.fetch}));
import { query } from './db.js';
import { createToken,developerPolicy,hashToken,createWebhook,queueEvent,deliverWebhookBatch,webhookSignature,saveDeveloperPolicy } from './developerAccess.js';
import { ownedAccounts,ownedMessage,searchMail,readMail,bindMailCapability } from './mailCapabilities.js';
import { prepareAction,confirmAction } from './actionProposals.js';
import { availableTools,executeMailTool } from './mailTools.js';
import { parseInboxItems,runFlowChat,setFlowAccount,tickIntegrations,flowInbox,enqueueFlow,flowIngest,scheduleFlowReassessments,requestFlowRefresh } from './flowAI.js';
import { invalidateActivationCache } from '../plugins/activation.js';
import { externalRoutes,mcpRoutes } from '../routes/developer.js';

const U='11111111-1111-4111-8111-111111111111',V='22222222-2222-4222-8222-222222222222',A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',M='cccccccc-cccc-4ccc-8ccc-cccccccccccc',N='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
let http,base;
beforeAll(async()=>{
  process.env.ENCRYPTION_KEY='ab'.repeat(32);
  state.db=new PGlite();
  await state.db.exec(`CREATE TABLE users(id uuid primary key,preferences jsonb default '{}',ai_enabled boolean default true,is_admin boolean default false);
    CREATE TABLE email_accounts(id uuid primary key,user_id uuid references users(id) ON DELETE CASCADE,name text,email_address text,enabled boolean default true,include_in_unified_inbox boolean default true,sort_order integer default 0,folder_mappings jsonb default '{}',created_at timestamptz default now());
    CREATE TABLE messages(id uuid primary key,account_id uuid references email_accounts(id) ON DELETE CASCADE,uid bigint,folder text,message_id text,subject text,from_email text,from_name text,date timestamptz,snippet text,body_text text,is_read boolean default false,is_starred boolean default false,is_deleted boolean default false,category text,thread_id text,thread_key text GENERATED ALWAYS AS (COALESCE(thread_id,id::text)) STORED,thread_references text,synced_at timestamptz default now());
    CREATE TABLE folders(account_id uuid references email_accounts(id),path text,name text,special_use text,uid_validity bigint);
    CREATE TABLE system_settings(key text primary key,value text,updated_at timestamptz default now());
    CREATE TABLE plugin_account_config(plugin_id text,account_id uuid references email_accounts(id) ON DELETE CASCADE,config jsonb,updated_at timestamptz default now(),primary key(plugin_id,account_id));
    CREATE TABLE plugin_data(plugin_id text,key text,owner_id uuid references users(id) ON DELETE CASCADE,value jsonb,blob bytea,blob_mime text,visibility text,updated_at timestamptz default now(),primary key(plugin_id,key));`);
  await state.db.exec(await readFile(new URL('../../migrations/0069_flow_integrations.sql',import.meta.url),'utf8'));
  await state.db.exec(await readFile(new URL('../../migrations/0070_flow_reassessment.sql',import.meta.url),'utf8'));
  bindMailCapability('read',async(req,res)=>{state.mutate(req.body);await query('UPDATE messages SET is_read=$1 WHERE id=$2',[req.body.read,req.params.id]);res.json({ok:true});});
  bindMailCapability('draft',async(req,res)=>{state.mutate(req.body);res.json({uid:10,folder:'Drafts'});});
  const app=express();app.use(express.json());app.use('/api/v1',externalRoutes);app.use('/api/mcp',mcpRoutes);
  http=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});base=`http://127.0.0.1:${http.address().port}`;
},30000);
afterAll(async()=>{await new Promise(resolve=>http?.close(resolve));await state.db?.close();});
beforeEach(async()=>{
  vi.clearAllMocks();invalidateActivationCache(U);invalidateActivationCache(V);
  state.complete.mockReset().mockResolvedValue('{"items":[]}');
  await state.db.exec('TRUNCATE users CASCADE; TRUNCATE system_settings;');
  await query("INSERT INTO users(id,preferences,is_admin) VALUES($1,'{\"enabledPlugins\":[\"flow\",\"notetrace\"]}',true),($2,'{}',false)",[U,V]);
  await query('INSERT INTO email_accounts(id,user_id,name,email_address) VALUES($1,$2,\'Personal\',\'me@example.com\'),($3,$4,\'Other\',\'other@example.com\')',[A,U,B,V]);
  await query("INSERT INTO folders(account_id,path,uid_validity) VALUES($1,'INBOX',7)",[A]);
  await query("INSERT INTO messages(id,account_id,uid,folder,message_id,subject,from_email,date,body_text,snippet,thread_id) VALUES($1,$2,1,'INBOX','<one@example.com>','Contract review','alex@example.com',NOW(),'Please review the contract by Friday.','Please review…','thread1'),($3,$4,2,'INBOX','<other@example.com>','Private mail','other@example.com',NOW(),'Private body','Private…','thread2')",[M,A,N,B]);
  await saveDeveloperPolicy({api:true,mcp:true,webhooks:true});
});

describe('scoped mail and reviewed mutations',()=>{
  it('rejects an explicit unowned account rather than widening to unified mail',async()=>{
    await expect(ownedAccounts({userId:U},[B])).rejects.toMatchObject({status:403});
    await expect(ownedMessage({userId:U},N)).rejects.toMatchObject({status:404});
    expect((await searchMail({userId:U})).messages.map(m=>m.id)).toEqual([M]);
  });
  it('returns bounded evidence and marks missing bodies partial',async()=>{
    await query('UPDATE messages SET body_text=NULL WHERE id=$1',[M]);
    expect((await readMail({userId:U},{message_id:M})).messages[0]).toMatchObject({content:'Please review…',partial:true});
  });
  it('stores only a hash and excludes credentials from public account results',async()=>{
    const r=await createToken(U,{name:'Read',account_ids:[A]});
    const stored=(await query('SELECT * FROM api_tokens WHERE id=$1',[r.token.id])).rows[0];
    expect(stored.secret_hash).toBe(hashToken(r.secret));expect(JSON.stringify(stored)).not.toContain(r.secret);
    expect((await ownedAccounts({userId:U,tokenId:r.token.id,accountIds:[A]}))[0]).not.toHaveProperty('auth_pass');
  });
  it('does not apply a preview and applies a confirmed proposal only once',async()=>{
    const p=await prepareAction({userId:U},{action:'read',message_ids:[M],read:true});
    expect(state.mutate).not.toHaveBeenCalled();expect((await ownedMessage({userId:U},M)).is_read).toBe(false);
    const first=await confirmAction({userId:U},p.id);expect(first.receipts[0].status).toBe('applied');
    expect(await confirmAction({userId:U},p.id)).toEqual(first);expect(state.mutate).toHaveBeenCalledTimes(1);
  });
  it('rejects changed UIDVALIDITY, expired proposals, and another user',async()=>{
    const p=await prepareAction({userId:U},{action:'read',message_ids:[M],read:true});
    await query('UPDATE folders SET uid_validity=8 WHERE account_id=$1',[A]);
    await expect(confirmAction({userId:U},p.id)).rejects.toMatchObject({status:409});
    await expect(confirmAction({userId:V},p.id)).rejects.toMatchObject({status:404});
    await query("UPDATE action_proposals SET expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1",[p.id]);
    await expect(confirmAction({userId:U},p.id)).rejects.toThrow(/expired/);expect(state.mutate).not.toHaveBeenCalled();
  });
  it('enforces token-specific proposals and immediate revocation',async()=>{
    const token=await createToken(U,{name:'Writer',account_ids:[A],scopes:['mail:organize']});
    const p={userId:U,tokenId:token.token.id,accountIds:[A],scopes:['mail:organize']};
    const proposal=await prepareAction(p,{action:'read',message_ids:[M],read:true});
    await expect(confirmAction({userId:U},proposal.id)).rejects.toMatchObject({status:404});
    await query('UPDATE api_tokens SET revoked_at=NOW() WHERE id=$1',[p.tokenId]);
    await expect(confirmAction(p,proposal.id)).rejects.toMatchObject({status:403});
    expect(state.mutate).not.toHaveBeenCalled();
  });
  it('never advertises confirmation to Flow or sending to any client',()=>{
    expect(availableTools({userId:U},{flow:true}).some(t=>t.name==='confirm_proposal')).toBe(false);
    expect(availableTools({userId:U}).some(t=>/send|delete|unsubscribe/.test(t.name))).toBe(false);
  });
  it('rejects read-only writes, invented actions, and prompt-injected account arguments',async()=>{
    const p={userId:U,tokenId:'token',accountIds:[A],scopes:['mail:read']};
    await expect(prepareAction(p,{action:'read',message_ids:[M],read:true})).rejects.toMatchObject({status:403});
    await expect(prepareAction({userId:U},{action:'send',message_ids:[M]})).rejects.toMatchObject({status:400});
    await expect(executeMailTool({userId:U},'read_mail',{message_id:N},{flow:true,accountIds:[A]})).rejects.toMatchObject({status:404});
  });
  it('validates and previews plain text drafts without sending',async()=>{
    const p=await prepareAction({userId:U},{action:'draft',message_ids:[M],account_id:A,to:['alex@example.com'],subject:'Re: Contract',body:'I will review it.'});
    expect(state.mutate).not.toHaveBeenCalled();await confirmAction({userId:U},p.id);
    expect(state.mutate).toHaveBeenCalledWith(expect.objectContaining({bodyIsHtml:false,inReplyTo:'<one@example.com>'}));
  });
});

describe('REST and MCP transport',()=>{
  async function token(scopes=['mail:read']){return (await createToken(U,{name:'Client',account_ids:[A],scopes})).secret;}
  it('has bearer-only auth and rejects foreign browser origins',async()=>{
    expect((await fetch(base+'/api/v1/accounts')).status).toBe(401);
    const secret=await token();
    const result=await fetch(base+'/api/v1/accounts',{headers:{Authorization:'Bearer '+secret}});expect(result.status).toBe(200);expect((await result.json()).accounts).toHaveLength(1);
    expect((await fetch(base+'/api/v1/accounts',{headers:{Authorization:'Bearer '+secret,Origin:'https://evil.example'}})).status).toBe(403);
  });
  it('requires an explicit second confirmation call through REST',async()=>{
    const secret=await token(['mail:read','mail:organize']),headers={Authorization:'Bearer '+secret,'Content-Type':'application/json'};
    const p=await (await fetch(base+'/api/v1/proposals',{method:'POST',headers,body:JSON.stringify({action:'read',message_ids:[M],read:true})})).json();
    expect(state.mutate).not.toHaveBeenCalled();
    expect((await fetch(base+`/api/v1/proposals/${p.id}/confirm`,{method:'POST',headers,body:'{}'})).status).toBe(400);
    expect((await fetch(base+`/api/v1/proposals/${p.id}/confirm`,{method:'POST',headers,body:'{"confirm":true}'})).status).toBe(200);
    expect(state.mutate).toHaveBeenCalledTimes(1);
  });
  it('supports legacy initialization and modern stateless tools/list',async()=>{
    const secret=await token();
    const headers={Authorization:'Bearer '+secret,'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
    const legacy=await fetch(base+'/api/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}})});
    const decode=async response=>{const text=await response.text();return JSON.parse(text.startsWith('event:')?text.split('\n').find(l=>l.startsWith('data:')).slice(5):text);};
    const legacyBody=await decode(legacy);expect(legacy.status,JSON.stringify(legacyBody)).toBe(200);expect(legacyBody.result.serverInfo.name).toBe('mailflow');
    const modern=await fetch(base+'/api/mcp',{method:'POST',headers:{...headers,'MCP-Protocol-Version':'2026-07-28','Mcp-Method':'tools/list'},body:JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{_meta:{'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientInfo':{name:'test',version:'1'},'io.modelcontextprotocol/clientCapabilities':{}}}})});
    const result=await decode(modern);expect(modern.status,JSON.stringify(result)).toBe(200);expect(result.result.tools.map(t=>t.name)).toContain('read_mail');expect(result.result.tools.map(t=>t.name)).not.toContain('confirm_proposal');
  });
});

describe('background analysis and signed durable events',()=>{
  it('includes outgoing-only conversations as possible follow-ups',async()=>{
    const sent='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    await query("INSERT INTO messages(id,account_id,uid,folder,message_id,thread_id,date,from_email,subject,body_text) VALUES($1,$2,7,'Sent','<proposal>','outgoing-only',NOW()-INTERVAL '5 days','me@example.com','Proposal','Could you review my proposal?')",[sent,A]);
    state.complete.mockResolvedValue(JSON.stringify({items:[{message_id:sent,kind:'followup',title:'Follow up on proposal',summary:'Consider asking for an update.',quote:'Could you review my proposal?'}]}));
    await setFlowAccount(U,{account_id:A,enabled:true});await tickIntegrations();
    expect((await flowInbox(U)).items).toEqual([expect.objectContaining({message_id:sent,kind:'followup'})]);expect(state.mutate).not.toHaveBeenCalled();
  });
  it('reassesses a sent reply against its older inbox conversation and excludes drafts',async()=>{
    state.complete.mockResolvedValue(JSON.stringify({items:[{message_id:M,kind:'action',title:'Review contract',summary:'Please review',quote:'Please review the contract by Friday.'}]}));
    await setFlowAccount(U,{account_id:A,enabled:true});await tickIntegrations();
    expect((await flowInbox(U)).items).toHaveLength(1);
    await query("UPDATE messages SET date=NOW()-INTERVAL '7 days',synced_at=NOW()-INTERVAL '7 days' WHERE id=$1",[M]);
    const sent='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',draft='ffffffff-ffff-4fff-8fff-ffffffffffff';
    await query("INSERT INTO messages(id,account_id,uid,folder,message_id,thread_id,date,from_email,subject,body_text) VALUES($1,$2,3,'Sent','<reply>','thread1',NOW(),'me@example.com','Re: Contract','I have reviewed the contract.'),($3,$2,4,'Drafts','<draft>','thread1',NOW()+INTERVAL '1 minute','me@example.com','Draft','THIS IS ONLY AN UNSENT DRAFT')",[sent,A,draft]);
    await flowIngest({account:{id:A,user_id:U},folder:'Sent',newMailIds:[sent]});
    expect((await query('SELECT affected_threads FROM integration_jobs WHERE account_id=$1',[A])).rows[0].affected_threads).toEqual(['thread1']);
    state.complete.mockClear().mockResolvedValue('{"items":[]}');await tickIntegrations();
    expect(state.complete).toHaveBeenCalledTimes(1);
    const context=JSON.parse(state.complete.mock.calls[0][0][1].content);
    expect(context.current_time).toMatch(/^\d{4}-/);expect(context.sources[0].excerpts).toContain('I have reviewed the contract.');expect(context.sources[0].excerpts).not.toContain('UNSENT DRAFT');
    expect((await flowInbox(U)).items).toHaveLength(0);expect(state.mutate).not.toHaveBeenCalled();
  });
  it('recognizes localized Sent folders and immediate SMTP sent-record events',async()=>{
    await setFlowAccount(U,{account_id:A,enabled:true});await tickIntegrations();
    const sent='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    await query('INSERT INTO folders(account_id,path,special_use) VALUES($1,$2,$3)',[A,'Gesendet','\\Sent']);
    await query("INSERT INTO messages(id,account_id,uid,folder,thread_id,date) VALUES($1,$2,9,'Gesendet','thread1',NOW())",[sent,A]);
    await flowIngest({account:{id:A,user_id:U},folder:'Gesendet',newMailIds:[sent]});
    expect((await query('SELECT status FROM integration_jobs WHERE account_id=$1',[A])).rows[0].status).toBe('pending');await tickIntegrations();
    await flowIngest({account:{id:A,user_id:U},folder:'Gesendet',sentChanged:{uid:9}});
    expect((await query('SELECT affected_threads FROM integration_jobs WHERE account_id=$1',[A])).rows[0].affected_threads).toEqual(['thread1']);
  });
  it('queues hourly reassessments without an open UI, reruns unchanged excerpts, and coalesces timers',async()=>{
    await setFlowAccount(U,{account_id:A,enabled:true});await tickIntegrations();state.complete.mockClear();
    await scheduleFlowReassessments();expect((await query('SELECT status FROM integration_jobs WHERE account_id=$1',[A])).rows[0].status).toBe('done');
    await query("UPDATE integration_jobs SET last_reassessed_at=NOW()-INTERVAL '2 hours' WHERE account_id=$1",[A]);
    await query("UPDATE messages SET date=NOW()-INTERVAL '20 days',synced_at=NOW()-INTERVAL '20 days' WHERE id=$1",[M]);
    await scheduleFlowReassessments();await scheduleFlowReassessments();await tickIntegrations();
    expect(state.complete).toHaveBeenCalledTimes(1);
    const job=(await query('SELECT * FROM integration_jobs WHERE account_id=$1',[A])).rows[0];expect(job.status).toBe('done');expect(job.full_reassessment_at).toBeNull();expect(job.last_reassessed_at).toBeTruthy();
    await scheduleFlowReassessments();expect((await query('SELECT status FROM integration_jobs WHERE account_id=$1',[A])).rows[0].status).toBe('done');expect(state.mutate).not.toHaveBeenCalled();
  });
  it('keeps a full refresh requested during another run and rechecks opted-out accounts',async()=>{
    state.complete.mockImplementationOnce(async()=>{await enqueueFlow(U,A,{full:true});return '{"items":[]}';});
    await setFlowAccount(U,{account_id:A,enabled:true});await tickIntegrations();
    expect((await query('SELECT full_reassessment_at,status FROM integration_jobs WHERE account_id=$1',[A])).rows[0]).toMatchObject({status:'pending',full_reassessment_at:expect.any(Date)});
    await tickIntegrations();await requestFlowRefresh(U,{account_ids:[A]});
    expect((await query('SELECT full_reassessment_at FROM integration_jobs WHERE account_id=$1',[A])).rows[0].full_reassessment_at).toBeTruthy();
    await setFlowAccount(U,{account_id:A,enabled:false});await scheduleFlowReassessments();
    expect((await query('SELECT * FROM integration_jobs WHERE account_id=$1',[A])).rows).toHaveLength(0);
  });
  it('preserves mail queued while an analysis job is running',async()=>{
    state.complete.mockImplementationOnce(async()=>{
      await enqueueFlow(U,A);
      return '{"items":[]}';
    });
    await setFlowAccount(U,{account_id:A,enabled:true});await tickIntegrations();
    expect((await query('SELECT status FROM integration_jobs WHERE account_id=$1',[A])).rows[0].status).toBe('pending');
    await tickIntegrations();
    expect((await query('SELECT status FROM integration_jobs WHERE account_id=$1',[A])).rows[0].status).toBe('done');
  });
  it('allows only owned, evidence-backed suggestions',()=>{
    const source={id:M,account_id:A,message_id:'<one>',evidence:'Please review the contract by Friday.'};
    const raw=JSON.stringify({items:[{message_id:M,kind:'action',title:'Review',summary:'Review contract',quote:'review the contract'},{message_id:N,kind:'action',title:'Leak',summary:'private',quote:'Private'},{message_id:M,kind:'topic',title:'Invented',summary:'fake',quote:'Cancel subscription'}]});
    expect(parseInboxItems(raw,[source])).toHaveLength(1);
  });
  it('runs an opt-in account job, persists progress, and never alters mail',async()=>{
    state.complete.mockResolvedValue(JSON.stringify({items:[{message_id:M,kind:'action',title:'Review contract',summary:'Alex asks for a review.',quote:'Please review the contract by Friday.'}]}));
    await setFlowAccount(U,{account_id:A,enabled:true});await tickIntegrations();
    const inbox=await flowInbox(U,{account_ids:[A]});expect(inbox.items).toHaveLength(1);expect(inbox.accounts[0].scanned).toBe(1);expect(state.mutate).not.toHaveBeenCalled();
  });
  it('streams tool results and citations while keeping confirmation outside model tools',async()=>{
    state.turn.mockResolvedValueOnce({role:'assistant',content:'',tool_calls:[{id:'call1',type:'function',function:{name:'read_mail',arguments:JSON.stringify({message_id:M,conversation:false})}}]}).mockImplementationOnce(async(_m,_t,{onDelta})=>{onDelta('Review the contract.');return {role:'assistant',content:'Review the contract.',tool_calls:[]};});
    const events=[];await runFlowChat(U,{prompt:'What do I need to do?',account_ids:[A]},(type,data)=>events.push({type,data}));
    expect(events.find(e=>e.type==='sources').data.messages[0].id).toBe(M);expect(events.at(-1).type).toBe('done');expect(state.mutate).not.toHaveBeenCalled();
    expect(state.turn.mock.calls[0][1].some(t=>t.function.name==='confirm_proposal')).toBe(false);
  });
  it('signs the exact raw body and recovers failed deliveries from the outbox',async()=>{
    const subscription=await createWebhook(U,{url:'https://automation.example/webhook',events:['mail.received'],account_ids:[A]});
    await queueEvent(U,A,'mail.received',{message_ids:[M]});
    state.fetch.mockRejectedValueOnce(Error('offline'));await deliverWebhookBatch();
    let d=(await query('SELECT * FROM webhook_deliveries')).rows[0];expect(d.status).toBe('pending');expect(d.attempts).toBe(1);
    await query("UPDATE webhook_deliveries SET available_at=NOW()-INTERVAL '1 minute'");
    state.fetch.mockResolvedValueOnce(new Response(null,{status:204}));await deliverWebhookBatch();
    const options=state.fetch.mock.calls.at(-1)[1];expect(options.headers['X-Mailflow-Signature']).toBe(webhookSignature(subscription.secret,options.headers['X-Mailflow-Timestamp'],options.body));
    expect(JSON.parse(options.body).data).not.toHaveProperty('body');d=(await query('SELECT * FROM webhook_deliveries')).rows[0];expect(d.status).toBe('delivered');expect(d.attempts).toBe(2);
  });
  it('halts delivery when the administrator disables webhooks',async()=>{
    await createWebhook(U,{url:'https://automation.example/webhook',events:['mail.received'],account_ids:[A]});await queueEvent(U,A,'mail.received',{});
    await saveDeveloperPolicy({api:true,mcp:true,webhooks:false});await deliverWebhookBatch();expect(state.fetch).not.toHaveBeenCalled();expect((await developerPolicy()).webhooks).toBe(false);
  });
});
