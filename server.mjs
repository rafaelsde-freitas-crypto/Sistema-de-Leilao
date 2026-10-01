import { createServer } from 'node:http';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { randomInt, randomUUID, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.join(root, 'data.json');
const { Pool } = pg;
const scryptAsync = promisify(scrypt);
const adminSetupToken = process.env.ADMIN_SETUP_TOKEN || (process.env.NODE_ENV === 'production' ? null : randomBytes(32).toString('base64url'));
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined }) : null;
if (process.env.NODE_ENV === 'production' && !pool) throw new Error('Configure DATABASE_URL para iniciar em produção e preservar os dados.');
if (adminSetupToken && adminSetupToken.length < 32) throw new Error('ADMIN_SETUP_TOKEN precisa ter pelo menos 32 caracteres.');
const importedCatalog = [
  'Hellwyrm','Tyrannosaur','Spellbound','Primal Tyrannosaur','Obsidian','Ice Bear',
  'Fel Statue','Goblin Shredder','Frenzied Icebear','Bio Giant','Fel Hydra','Frenzied Wildsoul',
  'Fel Thunderlizard','Fel Tyrannosaur','Wind Sprite','Lava Giant','Frenzied Blackdragon',
  'Frenzied Tyrannosaur','Stormkin','Waterkin','Firekin','Ogre',
].map((name,index)=>({id:`zip-${String(index+1).padStart(2,'0')}`,name,attributes:'',emoji:'✨',stock:0,published:false,round:1,image:`/assets/items/item-${String(index+1).padStart(2,'0')}.jpeg`}));
const initial = { items: importedCatalog, entries: [], results: [], adminAuth: null };
let state;
async function persist() {
  if (pool) await pool.query('INSERT INTO skyline_state (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [JSON.stringify(state)]);
  else {
    const tempFile = `${dataFile}.tmp`;
    await writeFile(tempFile, JSON.stringify(state, null, 2));
    await rename(tempFile, dataFile);
  }
}
function ensureCatalog(current) {
  current.adminAuth ??= null;
  if(!current.items.some(item=>item.id==='zip-01')){
  const sampleIds=new Set(['fone','smart','gift','game']);
    if(current.items.length&&current.items.every(item=>sampleIds.has(item.id))&&!current.entries.length&&!current.results.length)current.items=importedCatalog;
    else current.items.push(...importedCatalog);
    return true;
  }
  return false;
}
function zeroFinishedItems(current) {
  const finished = new Set(current.items
    .filter(item => current.results.some(result => result.itemId === item.id && (result.round || 1) === (item.round || 1)))
    .map(item => item.id));
  let changed = false;
  for (const item of current.items) {
    if (finished.has(item.id) && (item.published || item.stock !== 0)) {
      item.published = false;
      item.stock = 0;
      changed = true;
    }
  }
  return changed;
}
function normalizeRounds(current) {
  let changed = false;
  const rounds = new Map();
  for (const item of current.items) {
    if (!Number.isInteger(item.round) || item.round < 1) { item.round = 1; changed = true; }
    rounds.set(item.id, item.round);
  }
  for (const result of current.results) {
    if (!Number.isInteger(result.round) || result.round < 1) {
      result.round = rounds.get(result.itemId) || 1;
      changed = true;
    }
  }
  for (const entry of current.entries) {
    if (!Number.isInteger(entry.round) || entry.round < 1) {
      entry.round = rounds.get(entry.itemId) || 1;
      changed = true;
    }
  }
  return changed;
}
if (pool) {
  await pool.query('CREATE TABLE IF NOT EXISTS skyline_state (id smallint PRIMARY KEY CHECK (id = 1), data jsonb NOT NULL)');
  const saved = await pool.query('SELECT data FROM skyline_state WHERE id = 1');
  if (saved.rowCount) state = saved.rows[0].data;
  else {
    try { state = JSON.parse(await readFile(dataFile, 'utf8')); }
    catch { state = initial; }
    ensureCatalog(state);
    await persist();
  }
  if (ensureCatalog(state)) await persist();
} else {
  try { state = JSON.parse(await readFile(dataFile, 'utf8')); }
  catch { state = initial; await persist(); }
  if (ensureCatalog(state)) await persist();
}
const roundsChanged = normalizeRounds(state);
const finishedItemsChanged = zeroFinishedItems(state);
if (roundsChanged || finishedItemsChanged) await persist();
if (!state.adminAuth && process.env.NODE_ENV !== 'production' && !process.env.ADMIN_SETUP_TOKEN) console.warn(`Código temporário do primeiro acesso administrativo: ${adminSetupToken}`);
const sessions = new Map();
const authAttempts = new Map();
const requestLimits = new Map();
let writeQueue = Promise.resolve();
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
async function body(req) {
  const length = Number(req.headers['content-length'] || 0);
  if (length > 10000) throw Error('Requisição muito grande');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 10000) throw Error('Requisição muito grande'); chunks.push(chunk); }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new SyntaxError('O corpo precisa ser um objeto JSON.');
  return parsed;
}
function shuffled(list) { for(let i=list.length-1;i>0;i--){const j=randomInt(i+1);[list[i],list[j]]=[list[j],list[i]];} return list; }
function sessionToken(req) { return (req.headers.cookie||'').split(';').map(c=>c.trim()).find(c=>c.startsWith('skyline_admin='))?.slice('skyline_admin='.length); }
function isAdmin(req) { const token=sessionToken(req);const expiresAt=token&&sessions.get(token);if(!expiresAt)return false;if(expiresAt<=Date.now()){sessions.delete(token);return false;}return true; }
function clientIp(req) {
  if (process.env.NODE_ENV === 'production') {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded && forwarded.length <= 64) return forwarded;
  }
  return req.socket.remoteAddress || 'unknown';
}
function limited(map, key, max, windowMs) {
  const now = Date.now();
  let record = map.get(key);
  if (!record || record.resetAt <= now) { record = { count: 0, resetAt: now + windowMs }; map.set(key, record); }
  record.count++;
  if (map.size > 10000) {
    for (const [storedKey, value] of map) if (value.resetAt <= now) map.delete(storedKey);
    while (map.size > 10000) map.delete(map.keys().next().value);
  }
  return record.count > max ? Math.max(1, Math.ceil((record.resetAt - now) / 1000)) : 0;
}
function setSessionCookie(res, token) { res.setHeader('Set-Cookie',`skyline_admin=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${process.env.NODE_ENV==='production'?'; Secure':''}`); }
function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}
function isCurrentRoundResult(itemId, round) { return state.results.some(result=>result.itemId===itemId&&(result.round||1)===(round||1)); }
function startNewAuction() {
  const completedItems = new Set(state.results.map(result => result.itemId));
  for (const item of state.items) {
    if (completedItems.has(item.id) && isCurrentRoundResult(item.id, item.round)) item.round = (item.round || 1) + 1;
  }
  state.results = [];
}
function viewState(admin=false) { const entries=admin?state.entries.filter(entry=>{const item=state.items.find(i=>i.id===entry.itemId);return item&&(entry.round||1)===(item.round||1);}):[];const results=admin||!state.items.some(item=>item.published)?state.results:[];return {items:admin?state.items:state.items.filter(item=>item.published),entries,results,isAdmin:admin,adminConfigured:Boolean(state.adminAuth),setupTokenRequired:!state.adminAuth}; }
async function passwordMatches(password) { if(!state.adminAuth)return false; const supplied=await scryptAsync(password,state.adminAuth.salt,64);return timingSafeEqual(supplied,Buffer.from(state.adminAuth.hash,'hex')); }
const handleRequest = async (req,res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'POST' && req.headers.origin) {
      let originHost;
      try { originHost = new URL(req.headers.origin).host; } catch { return json(res,403,{error:'Origem da solicitação não permitida.'}); }
      if (originHost !== req.headers.host) return json(res,403,{error:'Origem da solicitação não permitida.'});
    }
    if (req.method === 'POST' && req.headers['sec-fetch-site'] === 'cross-site') return json(res,403,{error:'Origem da solicitação não permitida.'});
    if (req.method === 'POST' && !String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return json(res,415,{error:'Envie os dados como JSON.'});
    if(req.method==='GET' && url.pathname==='/api/state') return json(res,200,viewState(isAdmin(req)));
    if(req.method==='GET' && url.pathname==='/healthz') return json(res,200,{status:'ok'});
    if(req.method==='POST' && url.pathname==='/api/admin/setup') {
      if(state.adminAuth) return json(res,409,{error:'O acesso administrativo já foi configurado. Entre com sua senha.'});
      const retryAfter=limited(authAttempts,`setup:${clientIp(req)}`,10,15*60*1000);if(retryAfter)return json(res,429,{error:'Muitas tentativas de configuração. Aguarde antes de tentar novamente.',retryAfter});
      const {password,setupToken}=await body(req);
      if(!adminSetupToken)return json(res,503,{error:'Configure ADMIN_SETUP_TOKEN no ambiente antes do primeiro acesso administrativo.'});
      const expected=Buffer.from(adminSetupToken);const supplied=Buffer.from(typeof setupToken==='string'?setupToken:'');
      if(expected.length!==supplied.length||!timingSafeEqual(expected,supplied))return json(res,403,{error:'Código de configuração inválido.'});
      if(typeof password!=='string'||password.length<12)return json(res,400,{error:'Crie uma senha com pelo menos 12 caracteres.'});
      const salt=randomBytes(16).toString('hex');state.adminAuth={salt,hash:Buffer.from(await scryptAsync(password,salt,64)).toString('hex')};await persist();
      const token=randomBytes(32).toString('hex');sessions.set(token,Date.now()+12*60*60*1000);setSessionCookie(res,token);return json(res,200,viewState(true));
    }
    if(req.method==='POST' && url.pathname==='/api/admin/login') {
      const key=`login:${clientIp(req)}`,retryAfter=limited(authAttempts,key,6,15*60*1000);if(retryAfter)return json(res,429,{error:'Muitas tentativas. Aguarde antes de tentar novamente.',retryAfter});
      const {password}=await body(req);if(!await passwordMatches(String(password||'')))return json(res,401,{error:'Senha incorreta.'});
      authAttempts.delete(key);const token=randomBytes(32).toString('hex');sessions.set(token,Date.now()+12*60*60*1000);setSessionCookie(res,token);return json(res,200,viewState(true));
    }
    if(req.method==='POST' && url.pathname==='/api/admin/logout') {
      const token=sessionToken(req);if(token)sessions.delete(token);res.setHeader('Set-Cookie',`skyline_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`);return json(res,200,viewState(false));
    }
    if((url.pathname==='/api/items'||url.pathname==='/api/items/configure'||url.pathname==='/api/draw')&&!isAdmin(req))return json(res,401,{error:'Apenas o administrador pode realizar esta ação.'});
    if(req.method==='POST' && url.pathname==='/api/items/configure') {
      const {itemId,name,stock,attributes}=await body(req);const item=state.items.find(i=>i.id===itemId);const clean=String(name||'').trim();const cleanAttributes=typeof attributes==='string'?attributes.trim():attributes==null?'':null;
      if(!item)return json(res,404,{error:'Item não encontrado.'});
      if(!clean||clean.length>60||!Number.isInteger(stock)||stock<1||stock>500)return json(res,400,{error:'Informe o nome e uma quantidade entre 1 e 500.'});
      if(cleanAttributes===null||cleanAttributes.length>240)return json(res,400,{error:'Os atributos devem ter no máximo 240 caracteres.'});
      const itemFinished = isCurrentRoundResult(item.id,item.round);
      if (state.results.length && (!state.items.some(candidate => candidate.published) || itemFinished)) startNewAuction();
      item.name=clean;item.attributes=cleanAttributes;item.stock=stock;item.published=true;await persist();return json(res,200,viewState(true));
    }
    if(req.method==='POST' && url.pathname==='/api/items') {
      const {name,stock,emoji,attributes}=await body(req); const clean=String(name||'').trim();const cleanAttributes=typeof attributes==='string'?attributes.trim():attributes==null?'':null;
      if(!clean||clean.length>42||!Number.isInteger(stock)||stock<1||stock>500) return json(res,400,{error:'Informe nome e quantidade válida (1 a 500).'});
      if(cleanAttributes===null||cleanAttributes.length>240)return json(res,400,{error:'Os atributos devem ter no máximo 240 caracteres.'});
      if (state.results.length && !state.items.some(item => item.published)) startNewAuction();
      state.items.push({id:randomUUID(),name:clean,attributes:cleanAttributes,stock,emoji:String(emoji||'🎁').slice(0,8),published:true,round:1,image:null}); await persist(); return json(res,201,viewState(true));
    }
    if(req.method==='POST' && url.pathname==='/api/entries') {
      const retryAfter=limited(requestLimits,`entries:${clientIp(req)}`,60,60*1000);if(retryAfter)return json(res,429,{error:'Muitas inscrições em pouco tempo. Aguarde e tente novamente.',retryAfter});
      const {name,itemId,qty}=await body(req); const clean=String(name||'').trim().slice(0,60); const item=state.items.find(i=>i.id===itemId&&i.published);
      if(!clean||!item||!Number.isInteger(qty)||qty<1||qty>item.stock) return json(res,400,{error:'Inscrição inválida.'});
      if(isCurrentRoundResult(itemId,item.round)) return json(res,409,{error:'As inscrições para este item foram encerradas.'});
      const existing=state.entries.find(e=>e.itemId===itemId&&(e.round||1)===(item.round||1)&&e.name.toLowerCase()===clean.toLowerCase());
      if(existing) existing.qty=qty; else state.entries.push({id:randomUUID(),name:clean,itemId,round:item.round||1,qty});
      await persist(); return json(res,201,viewState(isAdmin(req)));
    }
    if(req.method==='POST' && url.pathname==='/api/draw') {
      const {itemId}=await body(req); const items=(itemId?state.items.filter(i=>i.id===itemId):state.items).filter(i=>i.published);
      for(const item of items){ if(isCurrentRoundResult(item.id,item.round)) continue;
        const pool=shuffled(state.entries.filter(e=>e.itemId===item.id&&(e.round||1)===(item.round||1)).map(e=>({...e}))); let left=item.stock; const winners=[];
        for(const entry of pool){if(left<=0)break;const won=Math.min(left,entry.qty);winners.push({name:entry.name,qty:won});left-=won;}
        state.results.push({itemId:item.id,itemName:item.name,round:item.round||1,stock:item.stock,winners,drawnAt:new Date().toISOString()});
        item.published=false;
        item.stock=0;
      }
      await persist(); return json(res,200,viewState(true));
    }
    if(req.method==='GET' && url.pathname==='/') {const nonce=randomBytes(18).toString('base64');const html=(await readFile(path.join(root,'index.html'),'utf8')).replace('<style>','<style nonce="'+nonce+'">').replace('<script>','<script nonce="'+nonce+'">');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':`default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; style-src 'self' 'nonce-${nonce}'; script-src 'self' 'nonce-${nonce}'; connect-src 'self'; font-src 'self' data:`});return res.end(html);}
    if(req.method==='GET' && url.pathname==='/assets/skyline-watermark.png') {res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'public, max-age=3600'});return res.end(await readFile(path.join(root,'assets','skyline-watermark.png')));}
    if(req.method==='GET' && url.pathname==='/assets/skyline-crown.svg') {res.writeHead(200,{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'public, max-age=3600'});return res.end(await readFile(path.join(root,'assets','skyline-crown.svg')));}
    if(req.method==='GET' && /^\/assets\/items\/item-\d{2}\.jpeg$/.test(url.pathname)) {res.writeHead(200,{'Content-Type':'image/jpeg','Cache-Control':'public, max-age=86400'});return res.end(await readFile(path.join(root,url.pathname)));}
    if(req.method==='OPTIONS' && url.pathname.startsWith('/api/')) {res.writeHead(204);return res.end();}
    json(res,404,{error:'Não encontrado.'});
  } catch(error) {
    console.error(error);
    const tooLarge = error.message === 'Requisição muito grande';
    const badJson = error instanceof SyntaxError;
    json(res,tooLarge?413:badJson?400:500,{error:tooLarge?'Requisição muito grande.':badJson?'O conteúdo enviado não é um JSON válido.':'Erro interno do servidor.'});
  }
};
const server = createServer((req,res) => {
  setSecurityHeaders(res);
  if (req.method === 'POST') {
    writeQueue = writeQueue.then(() => handleRequest(req,res)).catch(error => { console.error(error); if (!res.headersSent) json(res,500,{error:'Erro interno do servidor.'}); });
  } else void handleRequest(req,res);
});
const port=Number(process.env.PORT)||3000;
server.headersTimeout=15000;
server.requestTimeout=30000;
server.keepAliveTimeout=5000;
server.listen(port,'0.0.0.0',()=>console.log(`SKYLINE AUCTION disponível em http://localhost:${port}`));
