export const CLIENT = String.raw`
const $ = (s, r = document) => r.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
};
const api = async (path, opts = {}) => {
  const res = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error((body && body.error) || (typeof body === 'string' && body.slice(0, 200)) || res.statusText);
  return body;
};
const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + 'm ago'; if (s < 86400) return Math.round(s / 3600) + 'h ago'; return Math.round(s / 86400) + 'd ago'; };
const size = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';
const toast = (text, bad) => { const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, text); document.body.append(t); setTimeout(() => t.remove(), bad ? 6000 : 2500); };
const spinner = () => h('span', { class: 'spin' });
const skeleton = () => h('div', { class: 'skeleton' }, h('div'), h('div'), h('div'));
const pathFromUrl = () => location.pathname.startsWith('/t/') ? decodeURIComponent(location.pathname.slice(3)) : null;
const freshLive = () => ({ text: '', tools: [], compacting: false });

const S = { threads: null, threadsError: null, name: pathFromUrl(), view: null, viewError: null, live: null,
  tab: 'terminal', path: '.', entries: null, file: null, filesError: null, action: null };

const phaseOf = (t) => t.busy ? 'busy' : t.phase;
const phaseLabel = (t) => t.busy ? 'working' : ({ new: 'new', awake: 'running', paused: 'paused' })[t.phase] || t.phase;
const link = (name, text) => h('a', { href: '/t/' + name, onclick: (e) => { e.preventDefault(); go(name); } }, text || name);

function renderSide() {
  const list = $('#list');
  list.replaceChildren();
  if (S.threadsError) { list.append(h('div', { class: 'err' }, 'Could not load threads. ' + S.threadsError, h('button', { onclick: loadThreads }, 'Retry'))); return; }
  if (S.threads === null) { list.append(skeleton()); return; }
  if (S.threads.length === 0) { list.append(h('div', { class: 'empty inline' }, h('div', { class: 'empty-inner' }, h('p', {}, 'No threads yet.')))); return; }
  const names = new Set(S.threads.map((t) => t.name));
  const kids = new Map();
  for (const t of S.threads) if (t.parent && names.has(t.parent)) kids.set(t.parent, [...(kids.get(t.parent) || []), t]);
  const row = (t, child) => h('a', { class: 'item' + (t.name === S.name ? ' on' : '') + (child ? ' child' : ''), href: '/t/' + t.name, 'data-thread': t.name, onclick: (e) => { e.preventDefault(); go(t.name); } },
    h('div', { class: 't' }, h('span', { class: 'dot ' + phaseOf(t) }), h('span', {}, t.title || t.name)),
    h('div', { class: 'm' }, [phaseLabel(t), t.forkedFrom ? 'fork of ' + t.forkedFrom : null, t.createdBy === 'web' ? null : 'via ' + t.createdBy, ago(t.updatedAt)].filter(Boolean).join(' · ')));
  for (const t of S.threads) {
    if (t.parent && names.has(t.parent)) continue;
    list.append(row(t, false));
    for (const c of kids.get(t.name) || []) list.append(row(c, true));
  }
}

function renderBar() {
  const bar = $('#bar');
  bar.replaceChildren(h('button', { class: 'ghost narrow', onclick: () => $('.app').classList.add('show-side'), 'aria-label': 'Threads' }, '☰'));
  if (!S.name) { bar.append(h('h1', {}, 'Threads')); return; }
  const v = S.view;
  bar.append(h('h1', { title: S.name }, v ? v.title : S.name));
  if (!v) return;
  bar.append(h('span', { class: 'chip ' + phaseOf(v), id: 'phase' }, v.busy ? spinner() : null, phaseLabel(v)));
  const locked = !!S.action || v.busy;
  const button = (key, label, onclick, extra) => h('button', { class: 'ghost', id: 'act-' + key, disabled: locked || extra, onclick }, S.action === key ? spinner() : null, label);
  bar.append(
    button('compact', 'Compact', () => act('compact', 'Compacting: summarising and saving the disk…', 'Compacted. Summary and disk saved together.')),
    button('pause', 'Pause', () => act('pause', 'Pausing: saving the disk…', 'Paused. The disk is saved and the computer is off.'), v.phase === 'paused' || v.phase === 'new'),
    button('fork', 'Fork', fork),
    h('button', { class: 'ghost narrow panel-toggle', onclick: () => $('.app').classList.add('show-panel') }, 'Computer'));
}

function toolEl(name, args, output, running) {
  let arg = args;
  try { const a = JSON.parse(args); arg = a.command || a.path || a.task || a.name || args; } catch {}
  return h('details', { class: 'tool', 'data-tool': name }, h('summary', {}, running ? spinner() : h('span', { class: 'faint' }, '▸'), h('b', {}, name), h('span', { class: 'arg' }, arg)), h('pre', {}, output || args));
}

function richText(text) {
  const body = h('div', { class: 'body' });
  text.split(/\x60\x60\x60[a-zA-Z0-9_-]*\n?/).forEach((part, i) => {
    if (part === '') return;
    body.append(i % 2 ? h('pre', { class: 'code' }, part.replace(/\n$/, '')) : document.createTextNode(part));
  });
  return body;
}

function messageEl(m) {
  if (m.role === 'tool') return toolEl(m.tool.name, m.tool.args, null, false);
  if (m.kind === 'pi.compaction') return h('div', { class: 'msg summary' }, h('div', { class: 'label' }, 'Compaction summary'), h('div', { class: 'body' }, m.text));
  if (m.role !== 'user' && m.role !== 'assistant') return null;
  if (!m.text) return null;
  return h('div', { class: 'msg ' + m.role }, m.role === 'user' ? null : h('div', { class: 'label' }, 'agent'), m.role === 'user' ? h('div', { class: 'body' }, m.text) : richText(m.text));
}

function renderFeed() {
  const feed = $('#feed');
  const pinned = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 120;
  feed.replaceChildren();
  if (!S.name) {
    feed.append(h('div', { class: 'empty' }, h('div', { class: 'empty-inner' },
      h('h2', {}, 'One thread, one agent, one computer'),
      h('p', {}, 'Each thread gets its own Linux machine with a git checkout. Pause it and the disk is saved. Come back later and it resumes where it left off. Fork it to try another idea from the same point.'),
      h('button', { class: 'primary', 'data-new': '1', onclick: openNew }, 'New thread'))));
    return;
  }
  if (S.viewError) { feed.append(h('div', { class: 'err' }, S.viewError, h('button', { onclick: loadView }, 'Retry'))); return; }
  if (!S.view) { feed.append(h('div', { class: 'feed-inner' }, skeleton())); return; }
  const inner = h('div', { class: 'feed-inner' });
  const items = [];
  for (const m of S.view.messages) {
    if (m.role === 'toolResult') {
      const last = [...items].reverse().find((el) => el.matches('details.tool') && !el.dataset.filled);
      if (last) { last.dataset.filled = '1'; last.querySelector('pre').textContent = m.text || '(no output)'; const exit = /^exit (\d+)/.exec(m.text || ''); if (exit && exit[1] !== '0') last.classList.add('failed'); }
      continue;
    }
    const el = messageEl(m);
    if (el) items.push(el);
  }
  if (items.length === 0 && !S.live) {
    const o = S.view.origin;
    inner.append(h('div', { class: 'empty inline' }, h('div', { class: 'empty-inner' },
      h('h2', {}, 'Ready when you are'),
      h('p', {}, S.view.repo ? 'Its computer has ' + S.view.repo + ' checked out in /workspace.' : 'Its computer has an empty git repo in /workspace.'),
      h('p', { class: 'faint' }, o.forkedFrom ? 'Forked from ' + o.forkedFrom + ': it starts from that disk and a summary of that conversation.' : o.parent ? 'A child thread started by ' + o.parent + '.' : o.base ? 'It started warm, from a prepared snapshot of this repo.' : 'Ask it to build, fix, or explore something.'))));
  }
  inner.append(...items);
  if (S.live) {
    for (const t of S.live.tools) inner.append(toolEl(t.name, t.args, t.output, !t.done));
    if (S.live.text) inner.append(h('div', { class: 'msg assistant', id: 'live-text' }, h('div', { class: 'label' }, spinner(), 'agent'), h('div', { class: 'body' }, S.live.text)));
    else if (S.live.tools.every((t) => t.done)) inner.append(h('div', { class: 'msg', id: 'live-wait' }, h('div', { class: 'label' }, spinner(), S.live.compacting ? 'compacting…' : 'thinking…')));
  }
  feed.append(inner);
  if (pinned || S.live) feed.scrollTop = feed.scrollHeight;
}

function renderComposer() {
  $('#composer').style.display = S.name ? '' : 'none';
  const v = S.view;
  const working = !!(v && v.busy);
  const send = $('#send');
  send.disabled = !v || working;
  send.replaceChildren(...(working ? [spinner(), 'Working'] : ['Send']));
  $('#hint').textContent = !v ? '' : working ? 'The agent is working. Watch here, or leave and come back; it keeps going.' : v.phase === 'paused' ? 'Paused. Sending a message resumes the computer from its saved disk.' : 'Enter to send. Shift+Enter for a new line.';
}

function renderTerminal(pane) {
  const log = h('div', { class: 'term-log', id: 'termlog' });
  if (S.view.execs.length === 0) log.append(h('div', { class: 'faint' }, 'No commands yet. Commands you and the agent run appear here.'));
  for (const e of S.view.execs) log.append(
    h('div', { class: 'cmd' }, e.argv[e.argv.length - 1], h('span', { class: 'tag' }, (e.by === 'agent' ? 'agent' : 'you') + ' · exit ' + e.exitCode)),
    h('div', { class: 'out' + (e.exitCode ? ' bad' : '') }, e.output || ''));
  const input = h('input', { id: 'cmd', autocomplete: 'off', spellcheck: 'false', placeholder: S.view.phase === 'paused' ? 'Run a command (resumes the computer)' : 'Run a command in /workspace' });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') runCmd(); });
  pane.append(h('div', { class: 'term' }, log, h('div', { class: 'term-in' }, input, h('button', { onclick: runCmd }, 'Run'))));
  log.scrollTop = log.scrollHeight;
}

function renderFiles(pane) {
  const wrap = h('div', { class: 'files' });
  const parts = S.path === '.' ? [] : S.path.split('/');
  wrap.append(h('div', { class: 'crumbs' }, h('a', { onclick: () => openDir('.') }, '/workspace'), ...parts.map((p, i) => [h('span', { class: 'faint' }, '/'), h('a', { onclick: () => openDir(parts.slice(0, i + 1).join('/')) }, p)])));
  if (S.filesError) wrap.append(h('div', { class: 'err' }, S.filesError, h('button', { onclick: () => openDir(S.path) }, 'Retry')));
  else if (S.file) wrap.append(h('div', { class: 'row', onclick: () => { S.file = null; renderPanel(); } }, '← ' + (S.path === '.' ? '/workspace' : S.path)), S.file.loading ? skeleton() : h('pre', { class: 'viewer' }, S.file.text || '(empty file)'));
  else if (S.entries === null) wrap.append(skeleton());
  else if (S.entries.length === 0) wrap.append(h('div', { class: 'faint', style: 'padding:8px' }, 'This folder is empty.'));
  else for (const e of S.entries) {
    const full = S.path === '.' ? e.name : S.path + '/' + e.name;
    wrap.append(h('div', { class: 'row', onclick: () => e.type === 'directory' ? openDir(full) : openFile(full) }, h('span', { class: 'faint' }, e.type === 'directory' ? '▸' : '·'), e.name + (e.type === 'directory' ? '/' : '')));
  }
  pane.append(wrap);
}

function renderHistory(pane) {
  const tl = h('div', { class: 'timeline' });
  const o = S.view.origin;
  if (o.forkedFrom) tl.append(h('div', { class: 'tl' }, h('div', { class: 'h' }, 'Forked from', link(o.forkedFrom))));
  if (o.parent) tl.append(h('div', { class: 'tl' }, h('div', { class: 'h' }, 'Child of', link(o.parent))));
  if (o.base && !o.forkedFrom && !o.parent) tl.append(h('div', { class: 'tl' }, h('div', { class: 'h' }, 'Started warm', h('span', { class: 'faint' }, 'prepared base')), h('div', { class: 'd' }, 'snapshot ' + o.base.slice(0, 12))));
  const kids = (S.threads || []).filter((t) => t.parent === S.name || t.forkedFrom === S.name);
  for (const k of kids) tl.append(h('div', { class: 'tl' }, h('div', { class: 'h' }, k.parent === S.name ? 'Child' : 'Fork', link(k.name, k.title || k.name)), h('div', { class: 'd' }, phaseLabel(k) + ' · ' + ago(k.updatedAt))));
  for (const p of [...S.view.pairs].reverse()) tl.append(h('div', { class: 'tl' },
    h('div', { class: 'h' }, p.reason === 'compaction' ? 'Compacted' : 'Paused', h('span', { class: 'faint' }, ago(p.at))),
    h('div', { class: 'd' }, 'disk ' + size(p.snapshot.size) + ' · ' + p.snapshot.id.slice(0, 12) + (p.summaryEntry ? ' · with summary' : ''))));
  if (tl.childElementCount === 0) tl.append(h('div', { class: 'faint' }, 'Nothing saved yet. Pause saves the disk. Compact saves a summary and the disk together. Fork starts a new thread from here.'));
  pane.append(tl);
}

function renderPanel() {
  for (const b of document.querySelectorAll('.tabs [data-tab]')) b.classList.toggle('on', b.dataset.tab === S.tab);
  const pane = $('#pane');
  pane.replaceChildren();
  if (!S.name) { pane.append(h('div', { class: 'empty' }, h('div', { class: 'empty-inner' }, h('p', {}, 'Pick a thread to see its computer.')))); return; }
  if (S.viewError) { pane.append(h('div', { class: 'err' }, 'This thread is unavailable.')); return; }
  if (!S.view) { pane.append(skeleton()); return; }
  ({ terminal: renderTerminal, files: renderFiles, history: renderHistory })[S.tab](pane);
}

function render() { renderSide(); renderBar(); renderFeed(); renderComposer(); renderPanel(); }

async function loadThreads() {
  try { S.threads = await api('/api/threads'); S.threadsError = null; } catch (e) { S.threadsError = e.message; }
  renderSide();
}

async function loadView() {
  if (!S.name) return;
  const name = S.name;
  try { const v = await api('/api/threads/' + name); if (name !== S.name) return; S.view = v; S.viewError = null; }
  catch (e) { if (name !== S.name) return; S.viewError = e.message; S.view = null; }
  if (S.view && S.view.busy && !S.live) S.live = freshLive();
  if (S.view && !S.view.busy) S.live = null;
  render();
}

let refreshTimer = 0;
function refreshSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    try {
      const v = await api('/api/threads/' + S.name);
      S.view = { ...v, busy: S.view ? S.view.busy : v.busy };
      if (S.live) S.live = { ...S.live, tools: S.live.tools.filter((t) => !t.done) };
      render();
    } catch {}
  }, 300);
}

let source = null;
function connect() {
  if (source) source.close();
  source = null;
  if (!S.name) return;
  const name = S.name;
  source = new EventSource('/api/threads/' + name + '/events');
  source.onopen = () => renderComposer();
  source.onmessage = (msg) => {
    if (name !== S.name) return;
    const ev = JSON.parse(msg.data);
    if (ev.type === 'hello') return;
    window.__burrowEvents = (window.__burrowEvents || 0) + 1;
    if (ev.type === 'state') {
      if (!S.view) return;
      const was = S.view.busy;
      Object.assign(S.view, { busy: ev.busy, phase: ev.phase, running: ev.running });
      if (ev.busy && !S.live) S.live = freshLive();
      if (was && !ev.busy) { S.live = null; loadView(); loadThreads(); }
      else { renderBar(); renderComposer(); renderFeed(); }
      return;
    }
    if (ev.type === 'exec') { if (S.view && !S.view.execs.some((e) => e.seq === ev.record.seq)) { S.view.execs.push(ev.record); if (S.tab === 'terminal') renderPanel(); } return; }
    if (!S.live) S.live = freshLive();
    if (ev.type === 'text') S.live.text += ev.delta;
    else if (ev.type === 'tool_start') { S.live.text = ''; S.live.tools.push({ id: ev.id, name: ev.name, args: ev.args, output: '', done: false }); }
    else if (ev.type === 'tool_output') { const t = S.live.tools.find((x) => x.id === ev.id); if (t) t.output += ev.append; }
    else if (ev.type === 'tool_end') { const t = S.live.tools.find((x) => x.id === ev.id); if (t) t.done = true; refreshSoon(); }
    else if (ev.type === 'turn_end') { S.live.text = ''; refreshSoon(); }
    else if (ev.type === 'compaction') S.live.compacting = ev.phase === 'start';
    renderFeed();
  };
  source.onerror = () => { if (S.view && S.view.busy) $('#hint').textContent = 'Reconnecting to the live stream…'; };
}

function go(name) {
  Object.assign(S, { name, view: null, viewError: null, live: null, path: '.', entries: null, file: null, filesError: null });
  if (location.pathname !== (name ? '/t/' + name : '/')) history.pushState({}, '', name ? '/t/' + name : '/');
  $('.app').classList.remove('show-side', 'show-panel');
  render(); loadView(); connect();
  if (S.tab === 'files' && name) openDir('.');
}

async function send() {
  const ta = $('#text');
  const text = ta.value.trim();
  if (!text || !S.view || S.view.busy) return;
  ta.value = ''; autosize();
  S.view.messages.push({ id: 'pending', kind: 'pi.user', role: 'user', text });
  S.view.busy = true; S.live = freshLive();
  render();
  try {
    await api('/api/threads/' + S.name + '/messages', { method: 'POST', headers: { 'idempotency-key': crypto.randomUUID() }, body: JSON.stringify({ text }) });
    loadThreads();
  } catch (e) {
    toast('Could not send: ' + e.message, true);
    S.view.messages.pop(); S.view.busy = false; S.live = null; ta.value = text; render();
  }
}

async function act(kind, doing, done) {
  S.action = kind; renderBar(); toast(doing);
  try { await api('/api/threads/' + S.name + '/' + kind, { method: 'POST' }); toast(done); }
  catch (e) { toast(kind[0].toUpperCase() + kind.slice(1) + ' failed: ' + e.message, true); }
  finally { S.action = null; await loadView(); loadThreads(); }
}

async function fork() {
  S.action = 'fork'; renderBar(); toast('Forking: saving this disk…');
  try { const t = await api('/api/threads/' + S.name + '/fork', { method: 'POST', body: '{}' }); S.action = null; await loadThreads(); go(t.name); toast('Forked into ' + t.name + '.'); }
  catch (e) { S.action = null; renderBar(); toast('Fork failed: ' + e.message, true); }
}

async function runCmd() {
  const input = $('#cmd');
  const command = input.value.trim();
  if (!command) return;
  input.value = ''; input.disabled = true;
  try {
    const r = await api('/api/threads/' + S.name + '/exec', { method: 'POST', body: JSON.stringify({ command }) });
    if (!S.view.execs.some((e) => e.seq === r.seq)) S.view.execs.push({ seq: r.seq, argv: ['bash', '-lc', command], exitCode: r.exitCode, output: r.stdout + r.stderr, by: 'human' });
    S.view.phase = 'awake'; renderBar(); renderPanel();
  } catch (e) { toast('Command failed: ' + e.message, true); }
  finally { const i = $('#cmd'); if (i) { i.disabled = false; i.focus(); } }
}

async function openDir(path) {
  Object.assign(S, { path, entries: null, file: null, filesError: null }); renderPanel();
  try { S.entries = await api('/api/threads/' + S.name + '/files?list=1&path=' + encodeURIComponent(path)); } catch (e) { S.filesError = e.message; }
  renderPanel();
}

async function openFile(path) {
  S.file = { path, text: '', loading: true }; renderPanel();
  try { const res = await fetch('/api/threads/' + S.name + '/files?path=' + encodeURIComponent(path)); const text = await res.text(); if (!res.ok) throw new Error(text); S.file = { path, text, loading: false }; }
  catch (e) { S.file = null; S.filesError = e.message; }
  renderPanel();
}

function openNew() { $('#new').showModal(); $('#new-repo').focus(); }

async function create(e) {
  e.preventDefault();
  const repo = $('#new-repo').value.trim();
  const title = $('#new-title').value.trim();
  const btn = $('#new-go');
  btn.disabled = true; btn.replaceChildren(spinner(), 'Starting its computer');
  try {
    const t = await api('/api/threads', { method: 'POST', body: JSON.stringify({ ...(repo ? { repo } : {}), ...(title ? { title } : {}) }) });
    $('#new').close(); $('#new-repo').value = ''; $('#new-title').value = '';
    await loadThreads(); go(t.name);
  } catch (err) { toast('Could not create the thread: ' + err.message, true); }
  finally { btn.disabled = false; btn.replaceChildren('Create'); }
}

function autosize() { const ta = $('#text'); ta.style.height = 'auto'; ta.style.height = Math.min(200, ta.scrollHeight) + 'px'; }

document.addEventListener('DOMContentLoaded', () => {
  $('#text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  $('#text').addEventListener('input', autosize);
  $('#send').addEventListener('click', send);
  $('#new-side').addEventListener('click', openNew);
  $('#new form').addEventListener('submit', create);
  $('#new-cancel').addEventListener('click', () => $('#new').close());
  $('#side-close').addEventListener('click', () => $('.app').classList.remove('show-side'));
  $('#panel-close').addEventListener('click', () => $('.app').classList.remove('show-panel'));
  for (const b of document.querySelectorAll('.tabs [data-tab]')) b.addEventListener('click', () => { S.tab = b.dataset.tab; renderPanel(); if (S.tab === 'files' && S.entries === null && S.view) openDir(S.path); });
  window.addEventListener('popstate', () => go(pathFromUrl()));
  api('/api/whoami').then((w) => { $('#whoami').textContent = 'Signed in as ' + w.who; }).catch(() => {});
  render(); loadThreads();
  if (S.name) { loadView(); connect(); }
  setInterval(loadThreads, 10000);
});
`;
