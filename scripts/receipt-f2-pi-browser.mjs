import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const [baseArg, folderArg, outArg] = process.argv.slice(2);
const base = (baseArg ?? 'http://localhost:8787').replace(/\/$/u, '');
const folder = folderArg ?? join(homedir(), 'cloudflare', 'pi-browser');
const out = outArg ?? join('/tmp', 'coil-loop', 'f2-pi-browser.json');
const local = /^http:\/\/(localhost|127\.0\.0\.1)/u.test(base);
const token = local
  ? null
  : execFileSync('cloudflared', ['access', 'token', '-app', base], { encoding: 'utf8' }).trim();
const headers = {
  'content-type': 'application/json',
  ...(token === null ? {} : { 'cf-access-token': token }),
};

const retried = async (name, input, attempt = 0) =>
  capability(name, input).catch(async (error) => {
    if (attempt >= 3 || !String(error.message).includes('failed:')) throw error;
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return retried(name, input, attempt + 1);
  });

const capability = async (name, input) => {
  const response = await fetch(`${base}/api/capabilities/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  }).catch((error) =>
    Promise.reject(new Error(`${name} failed: ${error.cause?.message ?? error.message}`)),
  );
  const body = await response.json();

  if (!response.ok) throw new Error(`${name} ${response.status}: ${JSON.stringify(body)}`);

  return body;
};

const PAGE =
  '<title>coil probe</title><h1>Hello from the thread computer</h1><button onclick="this.textContent=`clicked`">press</button>';

const settle = async (thread) => {
  for (let tries = 0; tries < 120; tries++) {
    const view = await capability('thread_status', { name: thread });
    if (!view.busy) return view;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error('the turn did not finish in 10 minutes');
};

const send = async (thread, text) => {
  const answer = await capability('thread_send', { name: thread, text }).catch((error) => {
    if (
      !String(error.message).includes('failed:') &&
      !String(error.cause ?? error).includes('Timeout')
    )
      throw error;
    return null;
  });
  const view = await settle(thread);
  const last = view.messages.filter((message) => message.role === 'assistant').at(-1);
  return { answer: answer?.answer ?? last?.text ?? '', view };
};

const started = Date.now();
const thread = (await capability('thread_create', { title: 'f2 pi-browser receipt' })).name;
const upload = execFileSync(
  'node',
  ['scripts/upload-folder.mjs', base, thread, folder, 'uploads/pi-browser'],
  { encoding: 'utf8' },
).trim();
await retried('thread_exec', {
  name: thread,
  command: 'cd uploads/pi-browser && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -1',
});
await capability('thread_write_file', {
  name: thread,
  path: 'uploads/site/index.html',
  content: PAGE,
});
await capability('thread_exec', {
  name: thread,
  command:
    'cd uploads/site && (setsid nohup python3 -m http.server 8090 --bind 127.0.0.1 </dev/null >/dev/null 2>&1 &) ; echo started',
});
const prepared = await capability('thread_exec', {
  name: thread,
  command:
    'for i in 1 2 3 4 5 6 7 8 9 10; do curl -s -m 2 http://127.0.0.1:8090/ && break; sleep 1; done | head -c 40',
});
if (!prepared.stdout.includes('coil probe'))
  throw new Error(`the probe page did not serve: ${JSON.stringify(prepared)}`);

const loaded = await capability('thread_extensions', {
  name: thread,
  sources: ['./uploads/pi-browser'],
});
const { answer: turnAnswer, view } = await send(
  thread,
  'Use the browser tool (not browser_open) to navigate to http://127.0.0.1:8090, click the button named "press", then reply with the h1 text and the new button label, nothing else.',
);
const turn = { answer: turnAnswer };
const calls = view.messages
  .filter((message) => message.role === 'tool')
  .map((message) => ({ name: message.tool?.name, args: message.tool?.args }));
const results = view.messages
  .filter((message) => message.role === 'toolResult')
  .map((message) => message.text ?? '');
await capability('thread_pause', { name: thread });

const browserCalls = calls.filter((call) => call.name === 'browser');
const checks = {
  uploadedFromLocal: upload.startsWith('uploaded '),
  pageServedInThread: prepared.stdout.includes('coil probe'),
  loadedBrowserTool: loaded.tools.some((tool) => tool.name === 'browser'),
  agentNavigated: browserCalls.some((call) => String(call.args).includes('navigate')),
  agentClicked: browserCalls.some((call) => String(call.args).includes('click')),
  sawHeading: results.some((text) => text.includes('Hello from the thread computer')),
  answerHasClicked: String(turn.answer ?? '')
    .toLowerCase()
    .includes('clicked'),
};

const receipt = {
  feature: 'F2 private: pi-browser uploaded from a local folder and used by the agent',
  base: local ? 'local dev server' : base,
  at: new Date().toISOString(),
  ms: Date.now() - started,
  checks,
  passed: Object.values(checks).every(Boolean),
  upload,
  tools: loaded.tools.map((tool) => tool.name),
  unsupported: loaded.unsupported,
  calls,
  results: results.map((text) => text.slice(0, 400)),
  answer: turn.answer,
};

writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(out, receipt.passed ? 'PASS' : 'FAIL', JSON.stringify(checks));
process.exit(receipt.passed ? 0 : 1);
