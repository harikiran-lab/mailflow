import { createHash } from 'node:crypto';
import { query } from './db.js';
import { encrypt, decrypt } from './encryption.js';
import { getConnectionPolicy } from './connectionPolicy.js';
import { safeFetch } from './safeFetch.js';
import { readLimited } from './aiHttp.js';
import { fail, sourceKey } from './mailCapabilities.js';

const hash=s=>createHash('sha256').update(s).digest('hex');
const textFor=m=>`${m.subject||''}\n${m.from_email||''}\n${m.body_text||m.snippet||''}`.slice(0,6000);
export async function embeddingConfig({secret=false}={}) {
  const {rows}=await query("SELECT value FROM system_settings WHERE key='mail_embeddings'");
  const c=JSON.parse(rows[0]?.value||'{"enabled":false}');
  return {...c,key:secret?decrypt(c.key):c.key?'••••••••':''};
}
export async function saveEmbeddingConfig(input) {
  const previous=await embeddingConfig({secret:true});
  let url;
  try{url=new URL(input.base_url);}catch{if(input.enabled)throw fail('Enter an embeddings API base URL');}
  if(url&&(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash))throw fail('Invalid embeddings URL');
  if(input.enabled&&(!input.model||typeof input.model!=='string'||input.model.length>200))throw fail('Enter an embeddings model');
  const key=input.key==='••••••••'?previous.key:input.key;
  const c={enabled:input.enabled===true,base_url:url?.href.replace(/\/+$/,''),model:String(input.model||'').trim(),key:key?encrypt(String(key)):null};
  await query("INSERT INTO system_settings(key,value) VALUES('mail_embeddings',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()",[JSON.stringify(c)]);
  return embeddingConfig();
}
export function normalizedVector(v) {
  if(!Array.isArray(v)||!v.length||v.length>4096||v.some(n=>typeof n!=='number'||!Number.isFinite(n)))throw fail('Embeddings provider returned an invalid vector',502);
  const norm=Math.sqrt(v.reduce((s,n)=>s+n*n,0));if(!norm)throw fail('Embeddings provider returned an empty vector',502);
  return v.map(n=>n/norm);
}
export function cosine(a,b) {if(a.length!==b.length)return null;return a.reduce((sum,n,i)=>sum+n*b[i],0);}
async function embed(c,texts,signal) {
  const policy=await getConnectionPolicy();
  const response=await safeFetch(c.base_url+'/embeddings',{method:'POST',redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000),headers:{'Content-Type':'application/json',...(c.key?{Authorization:`Bearer ${c.key}`}:{})},body:JSON.stringify({model:c.model,input:texts,encoding_format:'float'})},{allowPrivate:policy.allowPrivateHosts});
  const raw=await readLimited(response,2*1024*1024);
  if(!response.ok)throw fail('Embeddings provider request failed',502);
  let parsed;try{parsed=JSON.parse(raw);}catch{throw fail('Invalid embeddings response',502);}
  const rows=parsed.data?.slice().sort((a,b)=>a.index-b.index);
  if(!rows||rows.length!==texts.length||rows.some((r,i)=>r.index!==i))throw fail('Invalid embeddings response',502);
  return rows.map(r=>normalizedVector(r.embedding));
}
const fingerprint=c=>`${c.model}:${hash(c.base_url).slice(0,16)}`;
export async function indexMailEmbeddings(userId,messages,checkAccess) {
  const c=await embeddingConfig({secret:true});if(!c.enabled)return;
  for(let i=0;i<messages.length;i+=8){
    await checkAccess();
    const batch=messages.slice(i,i+8),missing=[];
    for(const m of batch){
      const exists=await query('SELECT 1 FROM ai_embeddings WHERE user_id=$1 AND account_id=$2 AND source_key=$3 AND model=$4 AND content_hash=$5',[userId,m.account_id,sourceKey(m),fingerprint(c),hash(textFor(m))]);
      if(!exists.rows.length)missing.push(m);
    }
    if(!missing.length)continue;
    const vectors=await embed(c,missing.map(textFor));
    await checkAccess();
    for(let j=0;j<missing.length;j++){
      const m=missing[j];
      await query(`INSERT INTO ai_embeddings(user_id,account_id,source_key,model,content_hash,embedding) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,account_id,source_key,model) DO UPDATE SET content_hash=EXCLUDED.content_hash,embedding=EXCLUDED.embedding,updated_at=NOW()`,[userId,m.account_id,sourceKey(m),fingerprint(c),hash(textFor(m)),vectors[j]]);
    }
  }
}
export async function rerankMail(userId,q,messages,signal) {
  const c=await embeddingConfig({secret:true});if(!c.enabled||!messages.length||!q.trim())return {messages,semantic:false};
  try{
    const vectors=(await query('SELECT source_key,embedding FROM ai_embeddings WHERE user_id=$1 AND source_key=ANY($2::text[]) AND model=$3',[userId,messages.map(m=>m.source_key),fingerprint(c)])).rows;
    if(!vectors.length)return {messages,semantic:false,indexed_candidates:0};
    const [v]=await embed(c,[q.slice(0,2000)],signal);
    const scores=new Map(vectors.map(r=>[r.source_key,cosine(v,r.embedding)]));
    return {messages:messages.slice().sort((a,b)=>(scores.get(b.source_key)??-2)-(scores.get(a.source_key)??-2)),semantic:true,indexed_candidates:vectors.length};
  }catch{return {messages,semantic:false,semantic_unavailable:true};}
}
