import { query } from './db.js';
import { requireScope, ownedMessage, ownedAccounts, invokeMailCapability, fail, publicMessage } from './mailCapabilities.js';
import { recheckPrincipal } from './developerAccess.js';
import { isUuid } from '../utils/uuid.js';
import { isPluginActivated } from '../plugins/activation.js';
import { saveEmailCapture } from './emailCapture.js';
import { getUserAiAccess, aiFeatureEnabled } from './aiAccess.js';

export const ACTIONS = ['read','star','category','move','archive','snooze','draft','capture'];
export const scopeForAction = action => action==='draft'?'drafts:write':action==='capture'?'notetrace:capture':'mail:organize';
export function validateAction(input) {
  if(!ACTIONS.includes(input.action))throw fail('Unsupported action');
  const args={};
  if(input.action==='read'){if(typeof input.read!=='boolean')throw fail('read must be a boolean');args.read=input.read;}
  if(input.action==='star'){if(typeof input.starred!=='boolean')throw fail('starred must be a boolean');args.starred=input.starred;}
  if(input.action==='category'){if(!['primary','newsletter','promotion','automated','social'].includes(input.category))throw fail('Invalid category');args.category=input.category;}
  if(input.action==='move'){if(typeof input.folder!=='string'||!input.folder.trim()||input.folder.length>255||/[\r\n\0]/.test(input.folder))throw fail('Choose a destination folder');args.folder=input.folder;}
  if(input.action==='snooze'){const d=new Date(input.until);if(!Number.isFinite(+d)||d<=new Date()||d>new Date(Date.now()+366*86400000))throw fail('Choose a future snooze time within one year');args.until=d.toISOString();}
  if(input.action==='draft'){
    if(!isUuid(input.account_id)||typeof input.subject!=='string'||input.subject.length>1000||/[\r\n]/.test(input.subject)||typeof input.body!=='string'||!input.body.trim()||input.body.length>32000)throw fail('Enter a valid draft account, subject, and body');
    if(!Array.isArray(input.to)||!input.to.length||input.to.length>50||input.to.some(a=>typeof a!=='string'||a.length>320||! /^[^\s<>@]+@[^\s<>@]+$/.test(a)))throw fail('Use explicit email addresses for draft recipients');
    Object.assign(args,{accountId:input.account_id,to:input.to,subject:input.subject,body:input.body,bodyIsHtml:false});
  }
  if(input.action==='capture'){
    if(!isUuid(input.draft_id)||!Array.isArray(input.entries)||!input.entries.length||input.entries.length>50)throw fail('Prepare and review a NoteTrace capture first');
    args.draft_id=input.draft_id;args.entries=input.entries;
  }
  return args;
}
const snapshot=m=>({id:m.id,account_id:m.account_id,folder:m.folder,uid:String(m.uid),uid_validity:String(m.uid_validity),message_id:m.message_id,is_read:m.is_read,is_starred:m.is_starred,category:m.category});
export function sameSnapshot(m,s){return Object.entries(snapshot(m)).every(([key,value])=>s[key]===value);}

export async function prepareAction(principal,input,{flow=false}={}) {
  requireScope(principal,scopeForAction(input.action));
  const args=validateAction(input);
  if(!Array.isArray(input.message_ids)||(!input.message_ids.length&&input.action!=='draft')||input.message_ids.length>50||input.message_ids.some(id=>!isUuid(id)))throw fail('Select between 1 and 50 exact messages');
  if(input.action==='draft')await ownedAccounts(principal,[args.accountId]);
  if(input.action==='capture'&&!(await isPluginActivated(principal.userId,'notetrace')))throw fail('Enable NoteTrace first',409);
  const messages=[];
  for(const id of [...new Set(input.message_ids)])messages.push(await ownedMessage(principal,id));
  if(flow&&input.action==='draft'){
    const access=await getUserAiAccess(principal.userId);
    if(!access.allowed||!aiFeatureEnabled(access.status,'compose'))throw fail('The AI writing assistant is disabled',403);
  }
  let primaryId=messages[0]?.id;
  if(input.action==='snooze'){
    if(messages.length!==1)throw fail('Choose one conversation to snooze');
    const related=await invokeMailCapability('snooze-preview',principal,{params:{id:primaryId}});
    messages.length=0;
    for(const id of related.ids)messages.push(await ownedMessage(principal,id));
    if(messages.length>50)throw fail('This conversation is too large for an AI snooze preview');
    args.expectedConversationIds=messages.map(m=>m.id).sort();
  }
  if(input.action==='draft'&&messages.length){if(messages.length!==1||messages[0].account_id!==args.accountId)throw fail('Choose one source email from the draft account');args.inReplyTo=messages[0].message_id;args.references=messages[0].thread_references;}
  const payload={action:input.action,args,primaryId,snapshots:messages.map(snapshot),messages:messages.map(m=>publicMessage(m)),flow};
  const {rows}=await query('INSERT INTO action_proposals(user_id,token_id,payload) VALUES($1,$2,$3::jsonb) RETURNING id,expires_at',[principal.userId,principal.tokenId||null,JSON.stringify(payload)]);
  return {...rows[0],...payload,status:'pending'};
}
export async function confirmAction(principal,id) {
  if(!isUuid(id))throw fail('Invalid proposal ID');
  await recheckPrincipal(principal);
  const proposal=(await query('SELECT * FROM action_proposals WHERE id=$1 AND user_id=$2 AND token_id IS NOT DISTINCT FROM $3::uuid',[id,principal.userId,principal.tokenId||null])).rows[0];
  if(!proposal)throw fail('Proposal not found',404);
  requireScope(principal,scopeForAction(proposal.payload.action));
  if(proposal.status==='done')return {status:'done',receipts:proposal.receipts};
  if(proposal.status!=='pending')throw fail('Execution already started. Review receipts before preparing a new proposal.',409);
  if(new Date(proposal.expires_at)<=new Date())throw fail('Preview expired. Prepare a new preview.',409);
  const p=proposal.payload;
  if(p.flow){const access=await getUserAiAccess(principal.userId);if(!access.allowed||!aiFeatureEnabled(access.status,'flow')||!(await isPluginActivated(principal.userId,'flow')))throw fail('Flow AI is disabled',403);}
  if(p.action==='draft')await ownedAccounts(principal,[p.args.accountId]);
  for(const s of p.snapshots){if(!sameSnapshot(await ownedMessage(principal,s.id),s))throw fail('An email changed after this preview. Prepare a new preview.',409);}
  const claimed=await query("UPDATE action_proposals SET status='running' WHERE id=$1 AND status='pending' AND expires_at>NOW() RETURNING id",[id]);
  if(!claimed.rows.length)throw fail('This proposal is already being executed',409);
  const receipts=[];
  const items=['draft','capture','snooze'].includes(p.action)?[p.snapshots.find(s=>s.id===p.primaryId)||null]:p.snapshots;
  for(const s of items){
    try{
      await recheckPrincipal(principal);requireScope(principal,scopeForAction(p.action));
      if(s&&!sameSnapshot(await ownedMessage(principal,s.id),s))throw fail('Email changed during execution',409);
      let result;
      if(p.action==='capture'){
        if(!(await isPluginActivated(principal.userId,'notetrace')))throw fail('NoteTrace is disabled',403);
        // Capture's own service rechecks the reviewed source/destination and deduplicates retries.
        const stored=(await query("SELECT value FROM plugin_data WHERE plugin_id='notetrace' AND owner_id=$1 AND key=$2",[principal.userId,`draft:${principal.userId}:${p.args.draft_id}`])).rows[0]?.value;
        if(!stored||!s||stored.message_id!==s.id)throw fail('Capture source does not match the preview',409);
        result=await saveEmailCapture(principal.userId,p.args);
      }else result=await invokeMailCapability(p.action,principal,{params:s?{id:s.id}:{},body:{...p.args,...(s?{ids:[s.id]}:{})}});
      if(result?.failed?.length||result?.noArchiveFolder?.length)throw fail('Mail server could not apply this change',409);
      receipts.push({message_id:s?.id||null,status:'applied',result});
    }catch(e){receipts.push({message_id:s?.id||null,status:'failed',error:e.status?e.message:'Mail operation failed; check the mailbox before trying again.'});}
    await query('UPDATE action_proposals SET receipts=$2::jsonb WHERE id=$1',[id,JSON.stringify(receipts)]);
  }
  await query("UPDATE action_proposals SET status='done' WHERE id=$1",[id]);
  return {status:'done',receipts};
}
export async function getAction(principal,id) {
  if(!isUuid(id))throw fail('Invalid proposal ID');
  const row=(await query('SELECT id,payload,status,receipts,expires_at FROM action_proposals WHERE id=$1 AND user_id=$2 AND token_id IS NOT DISTINCT FROM $3::uuid',[id,principal.userId,principal.tokenId||null])).rows[0];
  if(!row)throw fail('Proposal not found',404);
  for(const s of row.payload.snapshots)await ownedAccounts(principal,[s.account_id]);
  return {...row,...row.payload};
}
