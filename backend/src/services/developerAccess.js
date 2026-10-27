import { createHash, randomBytes, randomUUID, createHmac } from 'node:crypto';
import { query } from './db.js';
import { encrypt, decrypt } from './encryption.js';
import { consume } from './rateLimiter.js';
import { safeFetch } from './safeFetch.js';
import { fail, ownedAccounts, SCOPES } from './mailCapabilities.js';
import { isUuid } from '../utils/uuid.js';

export const WEBHOOK_EVENTS = ['mail.received', 'mail.changed', 'draft.changed', 'flow.inbox.updated', 'notetrace.captured'];
let eventsEnabled=false;
export const hashToken = secret => createHash('sha256').update(secret).digest('hex');
export async function developerPolicy() {
  const { rows } = await query("SELECT value FROM system_settings WHERE key='developer_access'");
  const raw = JSON.parse(rows[0]?.value || '{}');
  eventsEnabled=raw.webhooks===true;
  return { api: raw.api === true, mcp: raw.mcp === true, webhooks: raw.webhooks === true };
}
export async function saveDeveloperPolicy(input) {
  const policy = { api: input.api === true, mcp: input.mcp === true, webhooks: input.webhooks === true };
  await query("INSERT INTO system_settings(key,value) VALUES('developer_access',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()", [JSON.stringify(policy)]);
  eventsEnabled=policy.webhooks;
  return policy;
}
export async function accountSelection(userId, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some(id=>!isUuid(id))) throw fail('Select at least one available account');
  return (await ownedAccounts({ userId }, [...new Set(ids)])).map(a=>a.id);
}
export async function createToken(userId, input) {
  const policy = await developerPolicy();
  if (!policy.api && !policy.mcp) throw fail('API and MCP access are disabled by the administrator', 403);
  const scopes = input.scopes || ['mail:read'];
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length>100 || !Array.isArray(scopes) || !scopes.length || scopes.some(s=>!SCOPES.includes(s))) throw fail('Enter a name and valid permissions');
  const accounts = await accountSelection(userId, input.account_ids);
  const days = Number(input.days ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw fail('Expiry must be between 1 and 365 days');
  const secret = 'mailflow_pat_' + randomBytes(32).toString('base64url');
  const { rows } = await query(`INSERT INTO api_tokens(user_id,name,secret_hash,prefix,scopes,account_ids,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,NOW()+$7*INTERVAL '1 day') RETURNING id,name,prefix,scopes,account_ids,expires_at,created_at`,
  [userId,input.name.trim(),hashToken(secret),secret.slice(0,20),[...new Set(scopes)],accounts,days]);
  return { token: rows[0], secret };
}
export async function listTokens(userId) {
  return (await query('SELECT id,name,prefix,scopes,account_ids,expires_at,last_used_at,revoked_at,created_at FROM api_tokens WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId])).rows;
}
export async function revokeToken(userId, id) {
  if (!isUuid(id)) throw fail('Invalid token ID');
  await query('UPDATE api_tokens SET revoked_at=NOW() WHERE id=$1 AND user_id=$2',[id,userId]);
  return { ok:true };
}
export function externalAuth(surface) {
  return async (req,res,next) => {
    try {
      if (!(await developerPolicy())[surface]) throw fail('Developer access is disabled',404);
      const origin=req.get('Origin');
      const allowed=[process.env.APP_URL,process.env.FRONTEND_URL,...(process.env.MCP_ALLOWED_ORIGINS||'').split(',')].filter(Boolean).map(s=>{try{return new URL(s).origin;}catch{return '';}});
      if(origin && !allowed.includes(origin)) throw fail('Origin is not allowed',403);
      const ipLimit=await consume(`api-ip:${req.ip}`,120,60000);
      if(ipLimit.limited) throw fail('Too many requests',429);
      const match=/^Bearer (mailflow_pat_[A-Za-z0-9_-]{43})$/.exec(req.get('Authorization')||'');
      if(!match) throw fail('A Mailflow bearer token is required',401);
      const {rows}=await query(`SELECT t.* FROM api_tokens t JOIN users u ON u.id=t.user_id WHERE secret_hash=$1 AND revoked_at IS NULL AND expires_at>NOW()`,[hashToken(match[1])]);
      const t=rows[0]; if(!t) throw fail('Invalid or expired token',401);
      if((await consume(`api-token:${t.id}`,60,60000)).limited) throw fail('Token rate limit reached',429);
      req.principal={userId:t.user_id,tokenId:t.id,scopes:t.scopes,accountIds:t.account_ids};
      await query('UPDATE api_tokens SET last_used_at=NOW() WHERE id=$1',[t.id]);
      next();
    }catch(e){res.status(e.status||500).json({error:e.status?e.message:'Authentication failed'});}
  };
}
export async function recheckPrincipal(principal) {
  if (!principal.tokenId) return;
  const {rows}=await query('SELECT * FROM api_tokens WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL AND expires_at>NOW()',[principal.tokenId,principal.userId]);
  if(!rows[0]) throw fail('Token has expired or was revoked',403);
  principal.scopes=rows[0].scopes; principal.accountIds=rows[0].account_ids;
}

export function webhookDestination(value) {
  let u; try{u=new URL(value);}catch{throw fail('Enter a valid webhook URL');}
  if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.hash||u.href.length>2048)throw fail('Use an HTTP(S) URL without embedded credentials or fragment');
  const allowPrivate=(process.env.WEBHOOK_ALLOWED_PRIVATE_ORIGINS||'').split(',').map(s=>s.trim()).includes(u.origin);
  if(u.protocol!=='https:'&&!allowPrivate)throw fail('Public webhooks require HTTPS');
  return {url:u.href,allowPrivate};
}
export async function createWebhook(userId,input) {
  if(!(await developerPolicy()).webhooks)throw fail('Webhooks are disabled by the administrator',403);
  const {url}=webhookDestination(input.url);
  const events=input.events;
  if(!Array.isArray(events)||!events.length||events.some(e=>!WEBHOOK_EVENTS.includes(e)))throw fail('Select valid webhook events');
  const accounts=await accountSelection(userId,input.account_ids);
  const secret='whsec_'+randomBytes(32).toString('base64url');
  const {rows}=await query(`INSERT INTO webhook_subscriptions(user_id,url,secret,events,account_ids) VALUES($1,$2,$3,$4,$5) RETURNING id,url,events,account_ids,enabled,created_at`,[userId,url,encrypt(secret),[...new Set(events)],accounts]);
  return {webhook:rows[0],secret};
}
export async function listWebhooks(userId) {
  const subscriptions=(await query('SELECT id,url,events,account_ids,enabled,created_at FROM webhook_subscriptions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId])).rows;
  const deliveries=(await query(`SELECT d.id,d.subscription_id,d.status,d.attempts,d.http_status,d.created_at,d.payload->>'type' AS event FROM webhook_deliveries d JOIN webhook_subscriptions s ON s.id=d.subscription_id WHERE s.user_id=$1 ORDER BY d.created_at DESC LIMIT 50`,[userId])).rows;
  return {subscriptions,deliveries};
}
export async function deleteWebhook(userId,id) {
  if(!isUuid(id))throw fail('Invalid webhook ID');
  await query('DELETE FROM webhook_subscriptions WHERE id=$1 AND user_id=$2',[id,userId]); return {ok:true};
}
export async function queueEvent(userId,accountId,type,data={}) {
  if(!eventsEnabled)return;
  if(!WEBHOOK_EVENTS.includes(type)||!(await developerPolicy()).webhooks)return;
  const event={id:randomUUID(),type,created_at:new Date().toISOString(),account_id:accountId,data};
  await query(`INSERT INTO webhook_deliveries(subscription_id,event_id,payload)
    SELECT s.id,$3,$4::jsonb FROM webhook_subscriptions s JOIN email_accounts a ON a.id=$2 AND a.user_id=s.user_id
    WHERE s.user_id=$1 AND s.enabled=true AND $2=ANY(s.account_ids) AND $5=ANY(s.events) ON CONFLICT DO NOTHING`,[userId,accountId,event.id,JSON.stringify(event),type]);
}
export async function testWebhook(userId,id) {
  if(!isUuid(id))throw fail('Invalid webhook ID');
  const {rows}=await query('SELECT * FROM webhook_subscriptions WHERE id=$1 AND user_id=$2',[id,userId]);
  if(!rows[0])throw fail('Webhook not found',404);
  const event={id:randomUUID(),type:'webhook.test',created_at:new Date().toISOString(),data:{test:true}};
  await query('INSERT INTO webhook_deliveries(subscription_id,event_id,payload) VALUES($1,$2,$3)',[id,event.id,JSON.stringify(event)]);return {ok:true};
}
export async function retryDelivery(userId,id) {
  if(!isUuid(id))throw fail('Invalid delivery ID');
  await query(`UPDATE webhook_deliveries d SET status='pending',attempts=0,available_at=NOW(),locked_at=NULL FROM webhook_subscriptions s WHERE s.id=d.subscription_id AND s.user_id=$1 AND d.id=$2 AND d.status='failed'`,[userId,id]);return {ok:true};
}
export function webhookSignature(secret,timestamp,body) {return 'v1='+createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex');}
export async function deliverWebhookBatch() {
  if(!(await developerPolicy()).webhooks)return;
  const {rows}=await query(`WITH picked AS (SELECT id FROM webhook_deliveries WHERE (status='pending' AND available_at<=NOW()) OR (status='running' AND locked_at<NOW()-INTERVAL '2 minutes') ORDER BY available_at LIMIT 5 FOR UPDATE SKIP LOCKED)
    UPDATE webhook_deliveries d SET status='running',locked_at=NOW(),attempts=attempts+1 FROM picked WHERE d.id=picked.id RETURNING d.*`);
  for(const d of rows) {
    let code=null;
    let ok=false;
    try {
      const sub=(await query('SELECT * FROM webhook_subscriptions WHERE id=$1 AND enabled=true',[d.subscription_id])).rows[0];
      if(!sub)throw Error('disabled');
      if(d.payload.account_id)await ownedAccounts({userId:sub.user_id},[d.payload.account_id]);
      const {url,allowPrivate}=webhookDestination(sub.url);
      const body=JSON.stringify(d.payload), timestamp=String(Math.floor(Date.now()/1000));
      const response=await safeFetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json','X-Mailflow-Event':d.payload.type,'X-Mailflow-Delivery':d.id,'X-Mailflow-Timestamp':timestamp,'X-Mailflow-Signature':webhookSignature(decrypt(sub.secret),timestamp,body)},body},{allowPrivate});
      code=response.status;ok=response.ok;await response.body?.cancel();
    }catch{ /* A failed destination must not stop deliveries to other subscriptions. */ }
    await query(`UPDATE webhook_deliveries SET status=$2,http_status=$3,available_at=NOW()+$4*INTERVAL '1 second',locked_at=NULL WHERE id=$1`,[d.id,ok?'delivered':d.attempts>=5?'failed':'pending',code,[30,120,600,3600,14400][Math.min(d.attempts-1,4)]]);
  }
  await query("DELETE FROM webhook_deliveries WHERE created_at<NOW()-INTERVAL '30 days' AND status IN ('delivered','failed')");
}
