import { TERMINAL_ACK_EVERY_BYTES } from '../flow';

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
const short = (t) => { const s = Math.round((Date.now() - t) / 1000); if (s < 60) return 'now'; if (s < 3600) return Math.round(s / 60) + 'm'; if (s < 86400) return Math.round(s / 3600) + 'h'; return Math.round(s / 86400) + 'd'; };
const ago = (t) => { const s = Math.round((Date.now() - t) / 1000); if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + 'm ago'; if (s < 86400) return Math.round(s / 3600) + 'h ago'; return Math.round(s / 86400) + 'd ago'; };
const size = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';
const toast = (text, bad) => { const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, text); document.body.append(t); setTimeout(() => t.remove(), bad ? 6000 : 2500); };
const spinner = () => h('span', { class: 'spin' });
const skeleton = () => h('div', { class: 'skeleton' }, h('div'), h('div'), h('div'));
const pathFromUrl = () => location.pathname.startsWith('/t/') ? decodeURIComponent(location.pathname.slice(3)) : null;
const freshLive = () => ({ text: '', tools: [], compacting: false });

const S = { threads: null, threadsError: null, name: pathFromUrl(), view: null, viewError: null, live: null,
  tab: 't1', path: '.', entries: null, file: null, filesError: null, action: null };

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
  const row = (t, child) => h('a', { class: 'item' + (t.name === S.name ? ' on' : '') + (child ? ' child' : ''), href: '/t/' + t.name, 'data-thread': t.name, title: [t.title, phaseLabel(t), t.forkedFrom ? 'fork of ' + t.forkedFrom : null, t.createdBy === 'web' ? null : 'via ' + t.createdBy].filter(Boolean).join(' · '), onclick: (e) => { e.preventDefault(); go(t.name); } },
    h('span', { class: 'dot ' + phaseOf(t) }), h('span', { class: 't' }, t.title || t.name), h('span', { class: 'm' }, short(t.updatedAt)));
  const groups = [['Working', (t) => t.busy], ['Running', (t) => !t.busy && t.phase === 'awake'], ['Paused', (t) => !t.busy && t.phase !== 'awake']];
  const roots = S.threads.filter((t) => !(t.parent && names.has(t.parent)));
  for (const [label, test] of groups) {
    const members = roots.filter(test);
    if (members.length === 0) continue;
    list.append(h('div', { class: 'group' }, label + ' ' + members.length));
    for (const t of members) { list.append(row(t, false)); for (const c of kids.get(t.name) || []) list.append(row(c, true)); }
  }
}

function renderBar() {
  const bar = $('#bar');
  bar.replaceChildren(h('button', { class: 'narrow', onclick: () => $('.app').classList.add('show-side'), 'aria-label': 'Threads' }, '☰'));
  if (!S.name) { bar.append(h('h1', {}, 'Threads')); return; }
  const v = S.view;
  bar.append(h('h1', { title: S.name }, v ? v.title : S.name));
  if (!v) return;
  bar.append(h('span', { class: 'chip ' + phaseOf(v), id: 'phase' }, v.busy ? spinner() : null, phaseLabel(v)));
  const locked = !!S.action || v.busy;
  const sizePicker = h('select', { class: 'size-pick', id: 'size', title: 'Computer size. Changing it restarts a running computer; the disk is kept.', disabled: locked, onchange: (e) => resize(e.target.value) },
    ...SIZES.map((s) => h('option', { value: s, selected: s === v.size }, s)));
  bar.append(sizePicker);
  const button = (key, label, onclick, extra) => h('button', { id: 'act-' + key, disabled: locked || extra, onclick }, S.action === key ? spinner() : null, label);
  const actions = h('div', { class: 'actions', id: 'actions' },
    button('compact', 'Compact', () => act('compact', 'Compacting: summarising and saving the disk…', 'Compacted. Summary and disk saved together.')),
    button('pause', 'Pause', () => act('pause', 'Pausing: saving the disk…', 'Paused. The disk is saved and the computer is off.'), v.phase === 'paused' || v.phase === 'new'),
    button('fork', 'Fork', fork),
    h('button', { class: 'panel-toggle', onclick: () => { $('.app').classList.add('show-panel'); actions.classList.remove('open'); } }, 'Computer'));
  bar.append(h('button', { class: 'more', 'aria-label': 'Actions', onclick: () => actions.classList.toggle('open') }, '⋯'), actions);
}

function toolEl(name, args, output, running) {
  let arg = args;
  try { const a = JSON.parse(args); arg = a.command || a.path || a.task || a.name || args; } catch {}
  return h('details', { class: 'tool', 'data-tool': name }, h('summary', {}, running ? spinner() : h('span', { class: 'caret' }, '▶'), h('b', {}, name), h('span', { class: 'arg' }, arg)), h('pre', {}, output || args));
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
  if (m.role === 'tool') { const el = toolEl(m.tool.name, m.tool.args, null, false); el.dataset.call = m.tool.id; return el; }
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
      h('div', { class: 'mark' }),
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
      const target = items.find((el) => el.dataset.call && el.dataset.call === m.toolCallId);
      if (target) { target.querySelector('pre').textContent = m.text || '(no output)'; const exit = /^exit (\d+)/.exec(m.text || ''); if (exit && exit[1] !== '0') target.classList.add('failed'); }
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
  send.replaceChildren(working ? spinner() : '↑');
  $('#hint').textContent = !v ? '' : working ? 'Working. You can leave; it keeps going.' : v.phase === 'paused' ? 'Paused. Sending resumes it from the saved disk.' : '';
}

const surfaceCache = new Map();
let termModule = null;
const loadTerm = () => (termModule ??= import(window.__TERM_SRC));
const wsUrl = (path) => (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + path;
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function applyTermTheme() {
  for (const entry of surfaceCache.values()) {
    const node = entry.el && entry.el.querySelector('.cloudterm');
    if (!node) continue;
    node.style.setProperty('--ct-bg', css('--term-bg'));
    node.style.setProperty('--ct-fg', css('--term-fg'));
  }
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => requestAnimationFrame(applyTermTheme));

function termTheme() {
  return { background: css('--term-bg'), foreground: css('--term-fg'), cursor: css('--orange'), fontFamily: css('--mono'), fontSize: 12.5 };
}

function terminalSurface(thread, id) {
  const key = thread + '/' + id;
  if (surfaceCache.has(key)) return surfaceCache.get(key);
  const el = h('div', { class: 'term-host', 'data-term': id });
  const status = h('div', { class: 'term-status' }, spinner(), 'Connecting');
  const root = h('div', { class: 'surface term-surface' }, el, status);
  const entry = { root, el, term: null, ws: null, closed: false, retry: 0 };
  surfaceCache.set(key, entry);
  const encoder = new TextEncoder();
  const open = async () => {
    if (entry.closed) return;
    const { mount } = await loadTerm();
    if (!entry.term) {
      entry.term = await mount(el, {
        theme: termTheme(),
        onData: (bytes) => { if (entry.ws && entry.ws.readyState === 1) entry.ws.send(bytes); },
        onResize: (cols, rows) => { if (cols >= 2 && rows >= 2 && entry.ws && entry.ws.readyState === 1) entry.ws.send(JSON.stringify({ resize: [cols, rows] })); },
      });
      applyTermTheme();
      new ResizeObserver(() => { if (root.isConnected && root.offsetWidth > 0) entry.term.fit(); }).observe(el);
    }
    const t = entry.term;
    if (root.offsetWidth > 0) t.fit();
    const cols = Math.max(20, Math.min(500, t.cols || 80));
    const rows = Math.max(5, Math.min(300, t.rows || 24));
    const ws = new WebSocket(wsUrl('/api/threads/' + thread + '/terminal?id=' + id + '&cols=' + cols + '&rows=' + rows));
    ws.binaryType = 'arraybuffer';
    entry.ws = ws;
    ws.onopen = () => { entry.retry = 0; status.replaceChildren(); status.hidden = true; if (t.cols >= 2 && t.rows >= 2) ws.send(JSON.stringify({ resize: [t.cols, t.rows] })); t.focus(); window.__coilTerm = (window.__coilTerm || 0) + 1; };
    let unacked = 0;
    ws.onmessage = (m) => {
      window.__coilBytes = (window.__coilBytes || 0) + m.data.byteLength;
      t.write(new Uint8Array(m.data));
      unacked += m.data.byteLength;
      if (unacked >= ${TERMINAL_ACK_EVERY_BYTES}) { const n = unacked; unacked = 0; requestAnimationFrame(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ ack: n })); }); }
    };
    ws.onclose = (e) => {
      entry.ws = null;
      if (entry.closed) return;
      status.hidden = false;
      if (e.code === 1000) { status.replaceChildren('Shell exited. ', h('button', { onclick: () => { status.replaceChildren(spinner(), 'Starting a new shell'); open(); } }, 'New shell')); return; }
      entry.retry += 1;
      const wait = Math.min(8000, 500 * 2 ** entry.retry);
      status.replaceChildren(spinner(), entry.retry > 1 ? 'Reconnecting…' : 'Starting the computer…');
      setTimeout(open, wait);
    };
  };
  open().catch((e) => { status.replaceChildren('Terminal failed: ' + e.message); });
  entry.focus = () => entry.term && entry.term.focus();
  entry.dispose = () => { entry.closed = true; if (entry.ws) entry.ws.close(); if (entry.term) entry.term.destroy(); surfaceCache.delete(key); };
  return entry;
}

const KEYS = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, PageUp: 33, PageDown: 34 };

function browserSurface(thread, id) {
  const key = thread + '/' + id;
  if (surfaceCache.has(key)) return surfaceCache.get(key);
  const url = h('input', { class: 'url', autocomplete: 'off', spellcheck: 'false', placeholder: 'localhost:3000 or a URL' });
  const canvas = h('canvas', { class: 'screen', tabindex: '0', width: '1280', height: '800' });
  const status = h('div', { class: 'term-status' }, spinner(), 'Starting the browser');
  const stage = h('div', { class: 'stage' }, canvas, status);
  const entry = { ws: null, closed: false, retry: 0, viewport: { width: 1280, height: 800 }, frames: 0 };
  const send = (msg) => { if (entry.ws && entry.ws.readyState === 1) entry.ws.send(JSON.stringify(msg)); };
  const go = () => { const v = url.value.trim(); if (v) { send({ open: v }); canvas.focus(); } };
  url.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  const bar = h('div', { class: 'urlbar' },
    h('button', { title: 'Back', 'aria-label': 'Back', onclick: () => send({ back: true }) }, '←'),
    h('button', { title: 'Reload', 'aria-label': 'Reload', onclick: () => send({ reload: true }) }, '↻'),
    url);
  entry.root = h('div', { class: 'surface browser-surface' }, bar, stage);
  surfaceCache.set(key, entry);
  const ctx = canvas.getContext('2d');
  let lastFrame = null;
  const paint = () => { if (lastFrame) ctx.drawImage(lastFrame, 0, 0, canvas.width, canvas.height); };
  const resizeCanvas = (viewport) => {
    entry.viewport = viewport;
    if (canvas.width === viewport.width && canvas.height === viewport.height) return;
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    paint();
  };
  const point = (e) => { const r = canvas.getBoundingClientRect(); return [Math.round((e.clientX - r.left) * entry.viewport.width / r.width), Math.round((e.clientY - r.top) * entry.viewport.height / r.height)]; };
  canvas.addEventListener('mousedown', (e) => { canvas.focus(); send({ click: point(e) }); e.preventDefault(); });
  canvas.addEventListener('wheel', (e) => { const [x, y] = point(e); send({ scroll: [x, y, e.deltaX, e.deltaY] }); e.preventDefault(); }, { passive: false });
  canvas.addEventListener('keydown', (e) => {
    if (e.metaKey) return;
    const mods = (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.shiftKey ? 8 : 0);
    if (e.key.length === 1 && !e.ctrlKey && !e.altKey) send({ text: e.key });
    else if (KEYS[e.key] || e.ctrlKey) { send({ key: { type: 'keyDown', key: e.key, code: e.code, keyCode: KEYS[e.key] || e.key.toUpperCase().charCodeAt(0), modifiers: mods } }); send({ key: { type: 'keyUp', key: e.key, code: e.code, keyCode: KEYS[e.key] || e.key.toUpperCase().charCodeAt(0), modifiers: mods } }); }
    else return;
    e.preventDefault();
  });
  canvas.addEventListener('paste', (e) => { const text = e.clipboardData.getData('text'); if (text) send({ text }); e.preventDefault(); });
  const open = () => {
    if (entry.closed) return;
    const ws = new WebSocket(wsUrl('/api/threads/' + thread + '/browser'));
    ws.binaryType = 'blob';
    entry.ws = ws;
    ws.onmessage = async (m) => {
      if (typeof m.data === 'string') {
        const msg = JSON.parse(m.data);
        if (msg.viewport) resizeCanvas(msg.viewport);
        if (msg.page) { if (document.activeElement !== url) url.value = msg.page.url === 'about:blank' ? '' : msg.page.url; entry.title = msg.page.title; }
        if (msg.error) toast(msg.error, true);
        if (msg.page && msg.viewport) entry.fit();
        entry.retry = 0; status.hidden = true;
        return;
      }
      const bitmap = await createImageBitmap(m.data);
      if (lastFrame) lastFrame.close();
      lastFrame = bitmap;
      paint();
      if (ws.readyState === 1) ws.send(JSON.stringify({ seen: true }));
      entry.frames += 1; window.__coilFrames = (window.__coilFrames || 0) + 1;
      status.hidden = true;
    };
    ws.onclose = () => {
      entry.ws = null;
      if (entry.closed) return;
      entry.retry += 1;
      status.hidden = false;
      status.replaceChildren(spinner(), 'Reconnecting to the browser…');
      setTimeout(open, Math.min(8000, 500 * 2 ** entry.retry));
    };
  };
  let sized = '';
  const fitViewport = () => {
    const w = Math.round(stage.clientWidth);
    const hgt = Math.round(stage.clientHeight);
    if (w < 50 || hgt < 50) return;
    const next = w + 'x' + hgt;
    if (next === sized) return;
    sized = next;
    send({ viewport: [w, hgt] });
  };
  new ResizeObserver(() => { clearTimeout(entry.fitTimer); entry.fitTimer = setTimeout(fitViewport, 150); }).observe(stage);
  entry.fit = () => { sized = ''; fitViewport(); };
  open();
  entry.focus = () => canvas.focus();
  entry.dispose = () => { entry.closed = true; if (entry.ws) entry.ws.close(); if (lastFrame) lastFrame.close(); surfaceCache.delete(key); };
  return entry;
}

function disposeThreadSurfaces(thread) {
  for (const [key, entry] of [...surfaceCache]) if (!thread || key.startsWith(thread + '/')) entry.dispose();
}

async function addSurface(kind) {
  try {
    const surfaces = await api('/api/threads/' + S.name + '/surfaces', { method: 'POST', body: JSON.stringify({ kind }) });
    S.view.surfaces = surfaces;
    const made = kind === 'browser' ? surfaces.find((x) => x.kind === 'browser') : surfaces[surfaces.length - 1];
    S.tab = made.id; renderPanel();
  } catch (e) { toast('Could not add a ' + kind + ': ' + e.message, true); }
}

async function closeSurface(id) {
  const entry = surfaceCache.get(S.name + '/' + id);
  if (entry) entry.dispose();
  try { S.view.surfaces = await api('/api/threads/' + S.name + '/surfaces/' + id, { method: 'DELETE' }); } catch (e) { toast('Could not close: ' + e.message, true); }
  if (S.tab === id) S.tab = (S.view.surfaces[0] || { id: 'files' }).id;
  renderPanel();
}

function renderTabs() {
  const tabs = $('#tabs');
  const surfaces = S.view ? S.view.surfaces || [] : [];
  const tab = (id, label, closable) => h('span', { class: 'tab' + (S.tab === id ? ' on' : ''), 'data-tab': id },
    h('button', { class: 'tab-main', onclick: () => { S.tab = id; renderPanel(); if (id === 'files' && S.entries === null && S.view) openDir(S.path); } }, label),
    closable ? h('button', { class: 'tab-x', title: 'Close', 'aria-label': 'Close ' + label, onclick: (e) => { e.stopPropagation(); closeSurface(id); } }, '×') : null);
  const menu = h('div', { class: 'add-menu', hidden: true },
    h('button', { onclick: () => { menu.hidden = true; addSurface('terminal'); } }, '▸_  Terminal'),
    h('button', { onclick: () => { menu.hidden = true; addSurface('browser'); }, disabled: surfaces.some((x) => x.kind === 'browser') }, '◎  Browser'));
  tabs.replaceChildren(
    h('div', { class: 'tab-strip' },
      ...surfaces.map((x) => tab(x.id, (x.kind === 'browser' ? '◎ ' : '▸ ') + x.title, true)),
      S.view ? h('span', { class: 'add-wrap' }, h('button', { class: 'tab-add', title: 'New terminal or browser', 'aria-label': 'Add surface', onclick: (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; } }, '+'), menu) : null),
    h('span', { class: 'tab-sep' }),
    tab('files', 'Files', false),
    tab('history', 'History', false),
    h('button', { class: 'narrow panel-close', 'aria-label': 'Close', onclick: () => $('.app').classList.remove('show-panel') }, '✕'));
}
document.addEventListener('click', () => { const m = $('.add-menu'); if (m) m.hidden = true; });

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
  renderTabs();
  const pane = $('#pane');
  if (!S.name) { pane.replaceChildren(h('div', { class: 'empty' }, h('div', { class: 'empty-inner' }, h('p', {}, 'Pick a thread to see its computer.')))); return; }
  if (S.viewError) { pane.replaceChildren(h('div', { class: 'err' }, 'This thread is unavailable.')); return; }
  if (!S.view) { pane.replaceChildren(skeleton()); return; }
  const surface = (S.view.surfaces || []).find((x) => x.id === S.tab);
  if (!surface && S.tab !== 'files' && S.tab !== 'history') S.tab = (S.view.surfaces[0] || { id: 'files' }).id;
  const live = (S.view.surfaces || []).find((x) => x.id === S.tab);
  if (live) {
    const entry = live.kind === 'browser' ? browserSurface(S.name, live.id) : terminalSurface(S.name, live.id);
    if (pane.firstChild !== entry.root || pane.childElementCount !== 1) pane.replaceChildren(entry.root);
    requestAnimationFrame(() => { if (entry.term) entry.term.fit(); entry.focus(); });
    return;
  }
  pane.replaceChildren();
  ({ files: renderFiles, history: renderHistory })[S.tab](pane);
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
    window.__coilEvents = (window.__coilEvents || 0) + 1;
    if (ev.type === 'state') {
      if (!S.view) return;
      const was = S.view.busy;
      Object.assign(S.view, { busy: ev.busy, phase: ev.phase, running: ev.running });
      if (ev.busy && !S.live) S.live = freshLive();
      if (was && !ev.busy) { S.live = null; loadView(); loadThreads(); }
      else { renderBar(); renderComposer(); renderFeed(); }
      return;
    }
    if (ev.type === 'exec') { if (S.view && !S.view.execs.some((e) => e.seq === ev.record.seq)) S.view.execs.push(ev.record); return; }
    if (ev.type === 'surfaces') { if (S.view) { S.view.surfaces = ev.surfaces; renderPanel(); } return; }
    if (ev.type === 'page') return;
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
  if (name !== S.name) disposeThreadSurfaces(S.name);
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

const SIZES = ['lite', 'standard-1', 'standard-2', 'standard-3', 'standard-4'];

async function resize(size) {
  const v = S.view;
  if (!v || size === v.size) return;
  if (v.running && !confirm('Restart the computer at ' + size + '? The disk is saved first; running programs stop.')) { renderBar(); return; }
  S.action = 'size'; renderBar(); toast('Changing the computer to ' + size + '…');
  try { const r = await api('/api/threads/' + S.name + '/size', { method: 'POST', body: JSON.stringify({ size }) }); toast(r.restarted ? 'Restarted at ' + size + '. The disk was kept.' : 'The computer will start at ' + size + '.'); }
  catch (err) { toast('Could not change the size: ' + err.message, true); }
  finally { S.action = null; await loadView(); }
}

function openNew() { $('#new').showModal(); $('#new-repo').focus(); }

async function create(e) {
  e.preventDefault();
  const repo = $('#new-repo').value.trim();
  const title = $('#new-title').value.trim();
  const size = $('#new-size').value;
  const btn = $('#new-go');
  btn.disabled = true; btn.replaceChildren(spinner(), 'Starting its computer');
  try {
    const t = await api('/api/threads', { method: 'POST', body: JSON.stringify({ ...(repo ? { repo } : {}), ...(title ? { title } : {}), size }) });
    $('#new').close(); $('#new-repo').value = ''; $('#new-title').value = '';
    await loadThreads(); go(t.name);
  } catch (err) { toast('Could not create the thread: ' + err.message, true); }
  finally { btn.disabled = false; btn.replaceChildren('Create'); }
}

function autosize() { const ta = $('#text'); ta.style.height = 'auto'; ta.style.height = Math.min(200, ta.scrollHeight) + 'px'; }

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; const b = $('#install'); if (b) b.hidden = false; });
window.addEventListener('appinstalled', () => { installPrompt = null; const b = $('#install'); if (b) b.hidden = true; });
const setOnline = () => document.documentElement.classList.toggle('offline', !navigator.onLine);
window.addEventListener('online', () => { setOnline(); loadThreads(); if (S.name) { loadView(); connect(); } });
window.addEventListener('offline', setOnline);

document.addEventListener('DOMContentLoaded', () => {
  setOnline();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  $('#install').addEventListener('click', async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; $('#install').hidden = true; });
  if (new URLSearchParams(location.search).get('new') === '1') { history.replaceState({}, '', '/'); setTimeout(openNew, 0); }
  $('#text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  $('#text').addEventListener('input', autosize);
  $('#send').addEventListener('click', send);
  $('#new-side').addEventListener('click', openNew);
  $('#new form').addEventListener('submit', create);
  $('#new-cancel').addEventListener('click', () => $('#new').close());
  $('#side-close').addEventListener('click', () => $('.app').classList.remove('show-side'));
  window.addEventListener('popstate', () => go(pathFromUrl()));
  api('/api/whoami').then((w) => { $('#whoami').textContent = w.who; }).catch(() => {});
  $('#theme').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('coil-theme', next); } catch {}
    applyTermTheme();
  });
  render(); loadThreads();
  if (S.name) { loadView(); connect(); }
  setInterval(loadThreads, 10000);
});
`;
