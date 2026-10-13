import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = (process.argv[2] ?? 'http://localhost:8787').replace(/\/$/u, '');
const local = /^http:\/\/(localhost|127\.0\.0\.1)/u.test(base);
const token = local
  ? null
  : execFileSync('cloudflared', ['access', 'token', '-app', base], { encoding: 'utf8' }).trim();
const headers = {
  'content-type': 'application/json',
  ...(token === null ? {} : { 'cf-access-token': token }),
};

const MACHINE_SOURCE = 'https://github.com/acoyfellow/pi-ext-durable#main:machine';

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

const helloFile = async (thread) =>
  capability('thread_exec', {
    name: thread,
    command:
      'mkdir -p exts/hello && cd exts/hello && npm pack --silent @earendil-works/pi-coding-agent@1.2.0 >/dev/null && tar -xzf earendil-works-pi-coding-agent-1.2.0.tgz package/examples/extensions/hello.ts && mv package/examples/extensions/hello.ts index.ts && rm -rf package *.tgz && sha256sum index.ts',
  });

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
const thread = (await capability('thread_create', { title: 'f2 receipt' })).name;
const hello = await helloFile(thread);
const loaded = await capability('thread_extensions', {
  name: thread,
  sources: ['./exts/hello', MACHINE_SOURCE],
});
const { answer: turnAnswer, view } = await send(
  thread,
  'Call the hello tool with name "coil", then call machine_report. Reply with the greeting and the uname value, nothing else.',
);
const turn = { answer: turnAnswer };
const toolNames = view.messages
  .filter((message) => message.role === 'tool')
  .map((message) => message.tool?.name);
const results = view.messages
  .filter((message) => message.role === 'toolResult')
  .map((message) => message.text);
await capability('thread_pause', { name: thread });

const checks = {
  helloIsStockFile: /^[0-9a-f]{64}\s+index\.ts/u.test(hello.stdout.trim()),
  loadedBothTools:
    loaded.tools
      .map((tool) => tool.name)
      .sort()
      .join(',') === 'hello,machine_report',
  noLoadErrors: loaded.errors.length === 0,
  agentCalledHello: toolNames.includes('hello'),
  agentCalledMachineReport: toolNames.includes('machine_report'),
  helloRanInExtension: results.some((text) => text.includes('Hello, coil!')),
  machineReportRanOnLinux: results.some((text) => text.includes('"platform": "linux"')),
};

const receipt = {
  feature: 'F2 pi extensions from git and the workspace',
  base: local ? 'local dev server' : base,
  at: new Date().toISOString(),
  ms: Date.now() - started,
  sources: {
    hello:
      'stock examples/extensions/hello.ts from @earendil-works/pi-coding-agent@1.2.0, copied into ./exts/hello',
    machine: MACHINE_SOURCE,
  },
  helloSha256: hello.stdout.trim().split(/\s+/u)[0],
  checks,
  passed: Object.values(checks).every(Boolean),
  loaded,
  toolCalls: toolNames,
  toolResults: results.map((text) => text.slice(0, 600)),
  answer: turn.answer,
};

mkdirSync('receipts', { recursive: true });
const out = `receipts/f2-pi-extensions${local ? '-local' : ''}.json`;
writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(out, receipt.passed ? 'PASS' : 'FAIL', JSON.stringify(checks));
process.exit(receipt.passed ? 0 : 1);
