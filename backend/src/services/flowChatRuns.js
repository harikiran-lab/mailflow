import { randomUUID } from 'node:crypto';
import { query } from './db.js';
import * as storage from '../plugins/storage.js';
import { ownedAccounts,ownedMessage,fail } from './mailCapabilities.js';
import { isUuid } from '../utils/uuid.js';
import { requireFlow,runFlowChat,flowConversations } from './flowAI.js';

const active=new Map();
const key=(userId,id)=>`run:${userId}:${id}`;
const ongoing=status=>['pending','running'].includes(status);

export async function getFlowRun(userId,id) {
  await requireFlow(userId);
  if(!isUuid(id))throw fail('Invalid run ID');
  const record=await storage.getValue('flow',key(userId,id));
  if(!record||record.owner_id!==userId)throw fail('Run not found',404);
  await ownedAccounts({userId},record.value.account_ids);
  const {input,...run}=record.value;void input;
  return run;
}
export async function listFlowRuns(userId) {
  await requireFlow(userId);
  const {rows}=await query("SELECT value FROM plugin_data WHERE plugin_id='flow' AND owner_id=$1 AND key LIKE $2 ORDER BY updated_at DESC LIMIT 10",[userId,`run:${userId}:%`]);
  return {runs:rows.map(({value:r})=>({id:r.id,status:r.status,account_ids:r.account_ids,conversation_id:r.conversation_id,updated_at:r.updated_at}))};
}
export async function startFlowRun(userId,input) {
  await requireFlow(userId);
  if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>4000)throw fail('Enter a question of up to 4,000 characters');
  const accounts=await ownedAccounts({userId},input.account_ids);
  if(!accounts.length)throw fail('Choose an enabled account');
  if(input.message_id) {
    const message=await ownedMessage({userId},input.message_id);
    if(!accounts.some(a=>a.id===message.account_id))throw fail('Selected email is outside the account scope',403);
  }
  const conversationId=input.conversation_id||randomUUID();
  if(!isUuid(conversationId))throw fail('Invalid conversation ID');
  if(input.conversation_id){const previous=await flowConversations(userId,conversationId);if(JSON.stringify([...previous.account_ids].sort())!==JSON.stringify(accounts.map(a=>a.id).sort()))throw fail('Start a new conversation to change account scope',409);}
  const id=randomUUID(),now=new Date().toISOString();
  const run={id,status:'pending',account_ids:accounts.map(a=>a.id),conversation_id:conversationId,prompt:input.prompt.trim(),updated_at:now,started_at:now,output:{text:'',tools:[],proposals:[],captures:[],sources:[],questions:[]},input:{prompt:input.prompt.trim(),account_ids:accounts.map(a=>a.id),...(input.message_id?{message_id:input.message_id}:{}),...(input.conversation_id?{conversation_id:conversationId}:{})}};
  // One slot per user, claimed atomically across backend replicas. Completed
  // runs have independent keys so a later request cannot erase their output.
  const claimed=await query(`INSERT INTO plugin_data(plugin_id,key,owner_id,value,visibility,updated_at) VALUES('flow',$1,$2,$3::jsonb,'private',NOW())
    ON CONFLICT(plugin_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()
    WHERE plugin_data.value->>'status' NOT IN ('pending','running') RETURNING key`,[`run-slot:${userId}`,userId,JSON.stringify({id,status:'pending'})]);
  if(!claimed.rows.length)throw fail('A Flow AI request is already running. Open it or stop it first.',409);
  try{await storage.put('flow',key(userId,id),{ownerId:userId,value:run});}
  catch(e){await query("UPDATE plugin_data SET value=jsonb_set(value,'{status}','\"failed\"'::jsonb) WHERE plugin_id='flow' AND key=$1 AND value->>'id'=$2",[`run-slot:${userId}`,id]);throw e;}
  void executeRun(userId,id).catch(e=>console.error('Flow background run failed:',e.message));
  return {id,conversation_id:conversationId,status:'pending'};
}
export async function stopFlowRun(userId,id) {
  const run=await getFlowRun(userId,id);
  if(!ongoing(run.status))return {ok:true};
  await query("UPDATE plugin_data SET value=jsonb_set(value,'{stop_requested}','true'::jsonb),updated_at=NOW() WHERE plugin_id='flow' AND key=$1 AND owner_id=$2",[key(userId,id),userId]);
  active.get(id)?.abort();return {ok:true};
}
async function executeRun(userId,id) {
  const claimed=await query("UPDATE plugin_data SET value=jsonb_set(value,'{status}','\"running\"'::jsonb),updated_at=NOW() WHERE plugin_id='flow' AND key=$1 AND owner_id=$2 AND value->>'status'='pending' RETURNING value",[key(userId,id),userId]);
  if(!claimed.rows.length)return;
  const run=claimed.rows[0].value,controller=new AbortController();active.set(id,controller);
  let write=Promise.resolve(),timer=null,checking=false;
  const flush=()=>{clearTimeout(timer);timer=null;run.updated_at=new Date().toISOString();const snapshot=JSON.stringify(run);write=write.then(()=>query("UPDATE plugin_data SET value=$3::jsonb||CASE WHEN value->>'stop_requested'='true' THEN '{\"stop_requested\":true}'::jsonb ELSE '{}'::jsonb END,updated_at=NOW() WHERE plugin_id='flow' AND key=$1 AND owner_id=$2",[key(userId,id),userId,snapshot]));return write;};
  const emit=(type,data)=>{
    if(controller.signal.aborted)return;
    const output=run.output;
    if(type==='conversation')run.conversation_id=data.id;
    if(type==='text')output.text=(output.text+data.delta).slice(0,128000);
    if(type==='answer')output.text=data.text.slice(0,128000);
    if(type==='tool')output.tools=[...output.tools.filter(t=>t.name!==data.name),data];
    if(type==='proposal')output.proposals=[...output.proposals,data].slice(-32);
    if(type==='capture')output.captures=[...output.captures,data].slice(-32);
    if(type==='sources')output.sources=data.messages;
    if(type==='question')output.questions=[...output.questions,data].slice(-8);
    if(!timer)timer=setTimeout(()=>{void flush().catch(()=>controller.abort());},300);
  };
  const heartbeat=setInterval(async()=>{if(checking)return;checking=true;try{const current=await storage.getValue('flow',key(userId,id));if(current?.value.stop_requested)controller.abort();await flush();}catch{controller.abort();}finally{checking=false;}},5000);
  try{
    if(run.stop_requested)controller.abort();
    await runFlowChat(userId,run.input,emit,controller.signal);
    run.status=controller.signal.aborted?'stopped':'done';
  }catch(e){run.status=controller.signal.aborted?'stopped':'failed';if(!controller.signal.aborted)run.error=e.status?e.message:'Flow AI could not finish. Saved output remains available.';}
  finally{
    clearInterval(heartbeat);clearTimeout(timer);active.delete(id);delete run.input;
    try{await flush();}finally{await query("UPDATE plugin_data SET value=jsonb_set(value,'{status}',$3::jsonb),updated_at=NOW() WHERE plugin_id='flow' AND key=$1 AND value->>'id'=$2",[`run-slot:${userId}`,id,JSON.stringify(run.status)]);}
  }
}
export async function recoverFlowRuns() {
  // A server restart must not silently present unfinished output as complete.
  // Live runs heartbeat every five seconds; retain stale partial output.
  await query(`UPDATE plugin_data SET value=value||'{"status":"failed","error":"The server restarted during generation. Partial output was saved; retry to continue."}'::jsonb,updated_at=NOW()
    WHERE plugin_id='flow' AND key LIKE 'run:%' AND value->>'status'='running' AND updated_at<NOW()-INTERVAL '2 minutes'`);
  await query(`UPDATE plugin_data slot SET value=jsonb_set(slot.value,'{status}','"failed"'::jsonb),updated_at=NOW() WHERE slot.plugin_id='flow' AND slot.key LIKE 'run-slot:%'
    AND slot.value->>'status' IN ('pending','running') AND slot.updated_at<NOW()-INTERVAL '2 minutes'
    AND NOT EXISTS(SELECT 1 FROM plugin_data r WHERE r.plugin_id='flow' AND r.owner_id=slot.owner_id AND r.key='run:'||slot.owner_id::text||':'||(slot.value->>'id') AND r.value->>'status' IN ('pending','running'))`);
  const {rows}=await query("SELECT owner_id,value->>'id' AS id FROM plugin_data WHERE plugin_id='flow' AND key LIKE 'run:%' AND value->>'status'='pending' ORDER BY updated_at LIMIT 4");
  for(const row of rows)void executeRun(row.owner_id,row.id).catch(e=>console.error('Flow run recovery failed:',e.message));
  await query("DELETE FROM plugin_data WHERE plugin_id='flow' AND key LIKE 'run:%' AND value->>'status' NOT IN ('pending','running') AND updated_at<NOW()-INTERVAL '90 days'");
}
