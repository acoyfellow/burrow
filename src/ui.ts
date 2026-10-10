const STYLE = `
:root{--ink:#0b1118;--layer:#111a24;--layer2:#182431;--text:#f7f9fb;--muted:#9baaba;--orange:#f6821f;--amber:#f7b53b;--blue:#71b8d8;--green:#63d5a2;--red:#ff7d68;--border:rgba(174,196,216,.14)}
*{box-sizing:border-box}body{margin:0;background:var(--ink);color:var(--text);font:15px/1.5 Inter,system-ui,sans-serif;min-height:100vh;
background-image:radial-gradient(900px 500px at 15% -10%,rgba(247,181,59,.12),transparent 60%),linear-gradient(var(--border) 1px,transparent 1px),linear-gradient(90deg,var(--border) 1px,transparent 1px);background-size:auto,48px 48px,48px 48px}
.mono,code,pre,.eyebrow{font-family:"IBM Plex Mono",ui-monospace,monospace}
.eyebrow{text-transform:uppercase;letter-spacing:.18em;font-size:11px;color:var(--amber)}.eyebrow:before{content:"[ "}.eyebrow:after{content:" ]"}
header{display:flex;align-items:center;gap:16px;padding:18px 28px;border-bottom:1px solid var(--border);background:rgba(11,17,24,.8)}
h1{font-size:20px;margin:0;letter-spacing:-.03em;font-weight:800}h1 b{color:var(--orange)}
main{display:grid;grid-template-columns:260px 1fr 340px;gap:0;height:calc(100vh - 63px)}
aside,section{border-right:1px solid var(--border);overflow:auto;padding:18px}
.card{background:var(--layer);border:1px solid var(--border);border-radius:.45rem;padding:10px 12px;margin-bottom:8px}
a{color:var(--blue);text-decoration:none}a.on{color:var(--text);font-weight:700}
button{background:var(--orange);color:#160b02;border:0;border-radius:.25rem;padding:7px 12px;font-weight:700;cursor:pointer}
button.ghost{background:transparent;color:var(--text);border:1px solid var(--border)}
input,textarea{width:100%;background:var(--layer2);color:var(--text);border:1px solid var(--border);border-radius:.25rem;padding:8px;font:inherit}
.msg{margin:0 0 12px}.msg .who{font-size:11px;color:var(--muted)}.msg.user .body{color:var(--amber)}.msg.compaction .body{color:var(--green);font-style:italic}
pre{white-space:pre-wrap;word-break:break-word;margin:6px 0 0;font-size:12.5px;color:var(--muted)}
.pill{display:inline-block;font-size:11px;padding:1px 8px;border-radius:99px;border:1px solid var(--border)}.awake{color:var(--green)}.paused{color:var(--amber)}.new{color:var(--muted)}
.row{display:flex;gap:8px;margin-top:10px}
`;

const SCRIPT = `
const $=(s)=>document.querySelector(s);const api=(p,o)=>fetch(p,o).then(async r=>{const t=await r.text();try{return JSON.parse(t)}catch{return t}});
const list=()=>JSON.parse(localStorage.getItem('burrows')||'[]');const remember=(n)=>{const l=list().filter(x=>x!==n);l.unshift(n);localStorage.setItem('burrows',JSON.stringify(l.slice(0,40)))};
const name=location.pathname.startsWith('/t/')?location.pathname.slice(3):null;
const esc=(s)=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function side(){ $('#threads').innerHTML=list().map(n=>'<div class="card"><a class="'+(n===name?'on':'')+'" href="/t/'+n+'">'+esc(n)+'</a></div>').join('')||'<div class="card mono">No threads yet.</div>'; }
async function create(){ const repo=$('#repo').value.trim(); const t=await api('/api/threads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(repo?{repo}:{})}); remember(t.name); location.href='/t/'+t.name; }
async function refresh(){ if(!name) return; const v=await api('/api/threads/'+name); if(typeof v!=='object'||!v.messages){ $('#chat').textContent=String(v.error||v); return; }
 $('#phase').className='pill '+v.phase; $('#phase').textContent=v.phase+(v.running?' · computer on':' · computer off');
 $('#chat').innerHTML=v.messages.filter(m=>m.text).map(m=>'<div class="msg '+(m.kind==='pi.compaction'?'compaction':m.role)+'"><div class="who mono">'+esc(m.kind==='pi.compaction'?'compaction summary':m.role)+'</div><div class="body">'+esc(m.text).replace(/\\n/g,'<br>')+'</div></div>').join('');
 $('#pairs').innerHTML=v.pairs.map(p=>'<div class="card mono">'+esc(p.reason)+' · '+new Date(p.at).toLocaleTimeString()+'<pre>snapshot '+esc(p.snapshot.id.slice(0,16))+' · '+Math.round(p.snapshot.size/1e6)+' MB'+(p.summaryEntry?'\\nsummary '+esc(p.summaryEntry):'')+'</pre></div>').join('')||'<div class="mono" style="color:var(--muted)">No pairs yet.</div>';
 $('#execs').innerHTML=v.execs.slice(-12).map(e=>'<div class="card mono">$ '+esc(e.argv.slice(-1)[0])+' <span style="color:'+(e.exitCode?'var(--red)':'var(--green)')+'">'+e.exitCode+'</span><pre>'+esc(e.output.slice(0,600))+'</pre></div>').join(''); }
async function send(){ const text=$('#text').value.trim(); if(!text) return; $('#text').value=''; $('#send').disabled=true; $('#chat').insertAdjacentHTML('beforeend','<div class="msg user"><div class="who mono">user</div><div class="body">'+esc(text)+'</div></div><div class="mono" id="wait" style="color:var(--muted)">working…</div>');
 try{ await api('/api/threads/'+name+'/messages',{method:'POST',headers:{'content-type':'application/json','idempotency-key':crypto.randomUUID()},body:JSON.stringify({text})}); } finally { $('#send').disabled=false; await refresh(); } }
async function run(){ const command=$('#cmd').value.trim(); if(!command) return; await api('/api/threads/'+name+'/exec',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command})}); $('#cmd').value=''; refresh(); }
async function act(kind){ $('#'+kind).disabled=true; try{ await api('/api/threads/'+name+'/'+kind,{method:'POST'}); } finally { $('#'+kind).disabled=false; refresh(); } }
side(); if(name){ remember(name); side(); $('#title').textContent=name; refresh(); setInterval(refresh,5000); } else { $('#title').textContent='Pick or create a thread'; }
`;

export const page =
  () => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>burrow</title><style>${STYLE}</style></head>
<body><header><h1><b>burrow</b></h1><span class="eyebrow">one thread · one agent · one computer</span><span style="flex:1"></span><span id="phase" class="pill new mono">—</span></header>
<main>
<aside><div class="eyebrow">threads</div><div class="row"><input id="repo" placeholder="git URL (optional)"></div><div class="row"><button onclick="create()">New thread</button></div><div id="threads" style="margin-top:14px"></div></aside>
<section><div class="eyebrow" id="title"></div><div id="chat" style="margin-top:14px"></div>
<div class="row"><textarea id="text" rows="3" placeholder="Ask the agent to do something in its computer"></textarea></div><div class="row"><button id="send" onclick="send()">Send</button><button class="ghost" id="compact" onclick="act('compact')">Compact</button><button class="ghost" id="pause" onclick="act('pause')">Pause</button></div></section>
<section style="border-right:0"><div class="eyebrow">terminal</div><div class="row"><input id="cmd" class="mono" placeholder="ls -la" onkeydown="if(event.key==='Enter')run()"></div><div id="execs" style="margin-top:10px"></div>
<div class="eyebrow" style="margin-top:22px">compaction pairs</div><div id="pairs" style="margin-top:10px"></div></section>
</main><script>${SCRIPT}</script></body></html>`;
