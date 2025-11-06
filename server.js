const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

// --- CORS ---
const allowOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({
  origin: allowOrigin,
  methods: ['GET','POST','OPTIONS'],
  credentials: false
}));

// --- no-cache para API ---
function noCache(req,res,next){
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma','no-cache');
  res.setHeader('Expires','0');
  res.setHeader('Surrogate-Control','no-store');
  next();
}

// --- IDs válidos ---
const VALID_IDS = ['v1','v2','v3','v4','v5'];

// --- Persistencia ---
const DATA_DIR = process.env.DATA_DIR || __dirname;
const COUNTER_FILE = path.join(DATA_DIR, 'plays.json');

function loadState(){
  try{
    const raw = fs.readFileSync(COUNTER_FILE,'utf8');
    const data = JSON.parse(raw);
    if (data && typeof data === 'object'){
      if (data.byId && typeof data.byId === 'object'){
        for (const id of VALID_IDS){
          if (!Number.isFinite(data.byId[id])) data.byId[id] = 0;
        }
        if (!Number.isFinite(data.total)){
          data.total = Object.values(data.byId).reduce((a,b)=>a+(Number(b)||0),0);
        }
        return data;
      }
      if (Number.isFinite(data.total)){
        const byId = Object.fromEntries(VALID_IDS.map(id=>[id,0]));
        return { byId, total: data.total|0 };
      }
    }
  }catch{}
  return { byId: Object.fromEntries(VALID_IDS.map(id=>[id,0])), total: 0 };
}
let state = loadState();
try{ if (!fs.existsSync(COUNTER_FILE)) fs.writeFileSync(COUNTER_FILE, JSON.stringify(state,null,2)); }catch{}

function saveState(){
  try{ fs.writeFileSync(COUNTER_FILE, JSON.stringify(state,null,2)); }
  catch(e){ console.error('Error guardando plays.json:', e); }
}

// --- API ---
app.post('/api/play/:id', noCache, (req,res)=>{
  const id = String(req.params.id||'').toLowerCase();
  if (!VALID_IDS.includes(id)) return res.status(400).json({ ok:false, error:'invalid_id', valid: VALID_IDS });
  state.byId[id] = (Number(state.byId[id])||0)+1;
  state.total = (Number(state.total)||0)+1;
  saveState();
  const ip = req.headers['x-forwarded-for']?.toString().split(',')[0].trim()
          || req.socket.remoteAddress || 'unknown';
  console.log(`[play:${id}] +1 => v=${state.byId[id]} total=${state.total} (ip: ${ip})`);
  res.json({ ok:true, id, totalById: state.byId[id], totalAll: state.total });
});

app.get('/api/stats/:id', noCache, (req,res)=>{
  const id = String(req.params.id||'').toLowerCase();
  if (!VALID_IDS.includes(id)) return res.status(400).json({ ok:false, error:'invalid_id', valid: VALID_IDS });
  res.json({ id, totalById: state.byId[id] });
});

app.get('/api/stats', noCache, (req,res)=>{
  res.json({ byId: state.byId, totalAll: state.total });
});

// --- HLS estático ---
app.use('/hls', express.static(path.join(__dirname,'public','hls'), {
  setHeaders: (res, fp) => {
    if (fp.endsWith('.m3u8')){
      res.setHeader('Content-Type','application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control','public, max-age=300, immutable');
    }
    if (fp.endsWith('.ts')){
      res.setHeader('Content-Type','video/mp2t');
      res.setHeader('Cache-Control','public, max-age=31536000, immutable');
    }
  }
}));

app.get('/health', (req,res)=>res.json({ status:'ok', time:new Date().toISOString() }));

// --- Proxy y listen ---
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Backend listo y escuchando en el puerto ${PORT}`);
});
