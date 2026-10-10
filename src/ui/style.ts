export const STYLE = String.raw`
:root{
  --bg:#0b0f14;--panel:#10161d;--raise:#151c25;--line:#1f2933;--line2:#2a3542;
  --text:#e8edf2;--dim:#8b98a7;--faint:#5c6976;
  --accent:#f6821f;--accent-ink:#1a0d02;--ok:#4cc38a;--warn:#e5a83b;--bad:#ef6a5b;--info:#6cb6d9;
  --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  --sans:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  --radius:8px;
}
*{box-sizing:border-box}
html,body{height:100%;margin:0}
body{background:var(--bg);color:var(--text);font:14px/1.5 var(--sans);-webkit-font-smoothing:antialiased;overflow:hidden}
button,input,textarea{font:inherit;color:inherit}
button{cursor:pointer;border:1px solid var(--line2);background:var(--raise);border-radius:6px;padding:6px 12px;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
button:hover:not(:disabled){border-color:var(--dim)}
button:disabled{opacity:.45;cursor:default}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);font-weight:600}
button.ghost{background:transparent;border-color:transparent;color:var(--dim)}
button.ghost:hover:not(:disabled){color:var(--text);border-color:var(--line2)}
input,textarea{width:100%;background:var(--bg);border:1px solid var(--line2);border-radius:6px;padding:8px 10px;outline:none}
input:focus,textarea:focus{border-color:var(--accent)}
textarea{resize:none}
.faint{color:var(--faint)}.dim{color:var(--dim)}

.app{display:grid;grid-template-columns:280px minmax(0,1fr) minmax(320px,38%);grid-template-rows:100%;height:100dvh}
.side{border-right:1px solid var(--line);background:var(--panel);display:flex;flex-direction:column;min-height:0}
.brand{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid var(--line);min-height:53px}
.brand b{font-size:16px;letter-spacing:-.02em}
.brand b span{color:var(--accent)}
.list{flex:1;overflow:auto;padding:6px}
.item{display:block;padding:9px 10px;border-radius:6px;color:inherit;text-decoration:none;border:1px solid transparent}
.item:hover{background:var(--raise)}
.item.on{background:var(--raise);border-color:var(--line2)}
.item .t{display:flex;align-items:center;gap:8px;font-weight:500;min-width:0}
.item .t span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item .m{font-size:12px;color:var(--faint);margin-top:2px;padding-left:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item.child{margin-left:14px}
.dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--faint)}
.dot.awake{background:var(--ok)}.dot.paused{background:var(--warn)}.dot.busy{background:var(--info);animation:pulse 1.2s infinite}
@keyframes pulse{50%{opacity:.35}}
.who{padding:10px 14px;border-top:1px solid var(--line);font-size:12px;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

.main{display:flex;flex-direction:column;min-width:0;min-height:0}
.bar{display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid var(--line);min-height:53px}
.bar h1{font-size:15px;margin:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.chip{font-size:12px;padding:2px 8px;border-radius:99px;border:1px solid var(--line2);color:var(--dim);white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
.chip.busy{color:var(--info);border-color:color-mix(in srgb,var(--info) 40%,transparent)}
.chip.paused{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 40%,transparent)}
.chip.awake{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,transparent)}
.feed{flex:1;overflow:auto;padding:20px 16px 8px}
.feed-inner{max-width:820px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.msg{display:flex;flex-direction:column;gap:4px}
.label{font-size:12px;color:var(--faint);display:flex;gap:8px;align-items:center}
.msg.user .body{background:var(--raise);border:1px solid var(--line2);border-radius:var(--radius);padding:10px 12px;align-self:flex-start;max-width:100%;white-space:pre-wrap;word-break:break-word}
.msg.assistant .body{white-space:pre-wrap;word-break:break-word}
.msg.summary .body{border-left:2px solid var(--ok);padding:6px 12px;color:var(--dim);white-space:pre-wrap}
.tool{border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);overflow:hidden}
.tool summary{list-style:none;cursor:pointer;padding:8px 12px;display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:12.5px;color:var(--dim)}
.tool summary::-webkit-details-marker{display:none}
.tool summary b{color:var(--text);font-weight:500}
.tool summary .arg{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.tool pre{margin:0;padding:10px 12px;border-top:1px solid var(--line);font:12px/1.5 var(--mono);color:var(--dim);white-space:pre-wrap;word-break:break-word;max-height:320px;overflow:auto}
.msg .body pre.code{margin:8px 0;padding:10px 12px;background:var(--panel);border:1px solid var(--line);border-radius:6px;font:12.5px/1.5 var(--mono);white-space:pre-wrap;overflow:auto}
.tool.failed summary b{color:var(--bad)}
.spin{width:12px;height:12px;border:2px solid var(--line2);border-top-color:var(--info);border-radius:50%;animation:spin .8s linear infinite;flex:none}
@keyframes spin{to{transform:rotate(360deg)}}
.composer{border-top:1px solid var(--line);padding:12px 16px}
.composer-inner{max-width:820px;margin:0 auto;display:flex;gap:8px;align-items:flex-end}
.composer textarea{min-height:44px;max-height:200px}
.hint{max-width:820px;margin:6px auto 0;font-size:12px;color:var(--faint);min-height:18px}

.panel{border-left:1px solid var(--line);background:var(--panel);display:flex;flex-direction:column;min-width:0;min-height:0}
.tabs{display:flex;gap:2px;padding:10px;border-bottom:1px solid var(--line);min-height:53px;align-items:center}
.tabs button{border-color:transparent;background:transparent;color:var(--dim)}
.tabs button.on{background:var(--raise);border-color:var(--line2);color:var(--text)}
.pane{flex:1;overflow:auto;min-height:0}
.term{display:flex;flex-direction:column;height:100%}
.term-log{flex:1;overflow:auto;padding:10px 12px;font:12px/1.55 var(--mono)}
.term-log .cmd{color:var(--text);word-break:break-word}
.term-log .cmd::before{content:"$ ";color:var(--accent)}
.term-log .out{color:var(--dim);white-space:pre-wrap;word-break:break-word;margin:2px 0 10px}
.term-log .out.bad{color:var(--bad)}
.term-log .tag{font-size:11px;color:var(--faint);margin-left:6px}
.term-in{display:flex;gap:6px;padding:10px;border-top:1px solid var(--line)}
.term-in input{font-family:var(--mono);font-size:12.5px}
.files{padding:8px}
.crumbs{display:flex;flex-wrap:wrap;gap:4px;padding:4px 6px 8px;font:12px var(--mono)}
.crumbs a{color:var(--info);cursor:pointer}
.row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;font:12.5px var(--mono)}
.row:hover{background:var(--raise)}
.viewer{margin:0;padding:12px;font:12px/1.55 var(--mono);white-space:pre-wrap;word-break:break-word;color:var(--dim)}
.timeline{padding:12px;display:flex;flex-direction:column;gap:10px}
.tl{border:1px solid var(--line);border-radius:var(--radius);padding:10px 12px;background:var(--bg)}
.tl .h{display:flex;justify-content:space-between;gap:8px;font-weight:500}
.tl .h a{color:var(--info);text-decoration:none}
.tl .d{font:12px var(--mono);color:var(--faint);margin-top:4px;word-break:break-all}

.empty{height:100%;display:flex;align-items:center;justify-content:center;padding:32px;text-align:center}
.empty.inline{height:auto;padding:56px 0}
.empty-inner{max-width:440px;display:flex;flex-direction:column;gap:12px;align-items:center}
.empty h2{margin:0;font-size:18px}
.empty p{margin:0;color:var(--dim)}
.skeleton{display:flex;flex-direction:column;gap:10px;padding:12px}
.skeleton div{height:14px;border-radius:4px;background:linear-gradient(90deg,var(--raise),var(--line),var(--raise));background-size:200% 100%;animation:shimmer 1.4s infinite}
.skeleton div:nth-child(2){width:72%}.skeleton div:nth-child(3){width:86%}
@keyframes shimmer{to{background-position:-200% 0}}
.err{margin:12px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--bad) 50%,transparent);background:color-mix(in srgb,var(--bad) 10%,transparent);border-radius:var(--radius);font-size:13px;display:flex;gap:10px;align-items:center;justify-content:space-between}
.toast{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:var(--raise);border:1px solid var(--line2);padding:8px 14px;border-radius:8px;font-size:13px;z-index:30;max-width:90vw}
.toast.bad{border-color:var(--bad)}

dialog{background:var(--panel);color:var(--text);border:1px solid var(--line2);border-radius:12px;padding:0;width:min(480px,92vw)}
dialog::backdrop{background:rgba(0,0,0,.55)}
dialog form{display:flex;flex-direction:column;gap:12px;padding:18px}
dialog h3{margin:0;font-size:16px}
dialog label{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--dim)}
dialog .actions{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}

.actions{display:flex;gap:2px;align-items:center}
.actions .panel-toggle{display:none}
.more{display:none!important}
.narrow{display:none!important}
@media (max-width:1100px){
  .app{grid-template-columns:240px minmax(0,1fr)}
  .panel{display:none}
  .app.show-panel .panel{display:flex;position:fixed;inset:0 0 0 auto;width:min(480px,100vw);z-index:10;box-shadow:-20px 0 40px rgba(0,0,0,.45)}
  .actions .panel-toggle{display:inline-flex}
}
@media (max-width:720px){
  .app{grid-template-columns:100%}
  .side{display:none}
  .app.show-side .side{display:flex;position:fixed;inset:0;z-index:15}
  .narrow{display:inline-flex!important}
  .bar{padding:8px 10px;gap:6px;position:relative}
  .more{display:inline-flex!important}
  .actions{display:none;position:absolute;top:calc(100% + 4px);right:8px;flex-direction:column;align-items:stretch;background:var(--raise);border:1px solid var(--line2);border-radius:8px;padding:4px;z-index:12;min-width:160px;box-shadow:0 12px 30px rgba(0,0,0,.45)}
  .actions.open{display:flex}
  .actions button{justify-content:flex-start}
  .feed{padding:14px 10px 6px}
  .composer{padding:10px}
}
`;
