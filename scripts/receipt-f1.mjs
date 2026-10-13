import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = (process.argv[2] ?? 'http://localhost:8787').replace(/\/$/u, '');
const local = /^http:\/\/(localhost|127\.0\.0\.1)/u.test(base);

const accessToken = () =>
  local
    ? null
    : execFileSync('cloudflared', ['access', 'token', '-app', base], { encoding: 'utf8' }).trim();

const token = accessToken();
const headers = {
  'content-type': 'application/json',
  ...(token === null ? {} : { 'cf-access-token': token }),
};

const get = async (path) => {
  const response = await fetch(`${base}${path}`, { headers });

  return { status: response.status, text: await response.text() };
};

let id = 0;

const mcp = async (method, params) => {
  id += 1;
  const response = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });

  return response.json();
};

const SCRIPT = `
const t = await coil.thread_create({ title: "f1 receipt" });
const shell = await coil.thread_exec({ name: t.name, command: "mkdir -p site && printf '%s' '<h1 id=n>0</h1><button onclick=\\"n.textContent=+n.textContent+1\\">plus</button>' > site/index.html && cd site && (nohup busybox httpd -f -p 3000 >/dev/null 2>&1 &) && sleep 1 && uname -s" });
await coil.browser_open({ name: t.name, url: "localhost:3000" });
const snapshot = await coil.browser_snapshot({ name: t.name });
const ref = (snapshot.match(/(e\\d+)[^\\n]*plus/) ?? [])[1];
const clicked = await coil.browser_click({ name: t.name, ref });
await coil.browser_click({ name: t.name, ref });
const count = await coil.browser_eval({ name: t.name, expression: "document.getElementById('n').textContent" });
const paused = await coil.thread_pause({ name: t.name });
return { thread: t.name, uname: shell.stdout.trim(), ref, clicked, count, paused: paused !== null };
`;

const started = Date.now();
const llms = await get('/llms.txt');
const docs = await get('/docs');
const tools = await mcp('tools/list', {});
const described = await mcp('tools/call', { name: 'coil_describe', arguments: {} });
const ran = await mcp('tools/call', { name: 'coil_run', arguments: { code: SCRIPT } });
const runText = ran.result?.content?.[0]?.text ?? '{}';
const run = JSON.parse(runText);
const toolNames = (tools.result?.tools ?? []).map((tool) => tool.name);

const checks = {
  llmsTxt: llms.status === 200 && llms.text.includes('### browser_click'),
  docsPage: docs.status === 200 && docs.text.includes('id="thread_pause"'),
  mcpListsRunAndDescribe: toolNames.includes('coil_run') && toolNames.includes('coil_describe'),
  describeDeclaresCoil: (described.result?.content?.[0]?.text ?? '').includes('declare const coil'),
  runOk: run.ok === true,
  shellRan: run.result?.uname === 'Linux',
  browserClickedTwice: String(run.result?.count).trim().replace(/"/gu, '') === '2',
  paused: run.result?.paused === true,
};

const receipt = {
  feature: 'F1 agent path',
  base: local ? 'local dev server' : base,
  at: new Date().toISOString(),
  ms: Date.now() - started,
  checks,
  passed: Object.values(checks).every(Boolean),
  mcpTools: toolNames,
  run,
};

mkdirSync('receipts', { recursive: true });
const out = `receipts/f1-agent-path${local ? '-local' : ''}.json`;
writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(out, receipt.passed ? 'PASS' : 'FAIL', JSON.stringify(checks));
process.exit(receipt.passed ? 0 : 1);
