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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const until = async (what, check, seconds = 600) => {
  for (let waited = 0; waited < seconds; waited += 5) {
    const found = await check();
    if (found) return found;
    await sleep(5000);
  }
  throw new Error(`timed out waiting for ${what}`);
};

const status = (name) => capability('thread_status', { name });

const idle = (name) =>
  until(`${name} to finish`, async () => ((await status(name)).busy ? null : status(name)));

const send = async (name, text) => {
  await capability('thread_send', { name, text }).catch((error) => {
    if (!String(error.message).includes('failed:')) throw error;
  });
  return idle(name);
};

const users = (view) => view.messages.filter((m) => m.role === 'user').map((m) => m.text ?? '');
const answers = (view) =>
  view.messages.filter((m) => m.role === 'assistant' && m.text).map((m) => m.text);
const toolNames = (view) => view.messages.filter((m) => m.role === 'tool').map((m) => m.tool?.name);

const started = Date.now();
const made = [];
const create = async (title) => {
  const { name } = await capability('thread_create', { title });
  made.push(name);
  return name;
};

const sendWait = async () => {
  const a = await create('f3 sender');
  const b = await create('f3 receiver');
  const queued = await capability('thread_message', {
    from: a,
    to: b,
    text: 'Reply with exactly the word PONG and nothing else.',
  });
  const waited = await capability('thread_wait', { name: b, seconds: 300 });
  const bView = await status(b);

  return {
    a,
    b,
    queued,
    waited,
    checks: {
      receiverGotMessage: users(bView).some((text) => text.includes(`[message from thread ${a}]`)),
      waitReturnedAnswer: waited.done === true && String(waited.answer).includes('PONG'),
    },
  };
};

const doneToParent = async () => {
  const parent = await create('f3 parent');
  const after = await send(
    parent,
    'Call start_child with this task: "Run `echo 6*7 | bc` or compute 6*7, then end your reply with a line DONE: answer=<the number>". Do not call wait_child. Reply with the child name only.',
  );
  const child = toolNames(after).includes('start_child')
    ? after.messages
        .filter((m) => m.role === 'toolResult')
        .map((m) => m.text ?? '')
        .find((text) => text.startsWith('started child'))
        ?.replace('started child ', '')
        .trim()
    : undefined;

  if (child) made.push(child);

  const delivered = await until(
    'the child DONE: to reach the parent',
    async () => {
      const view = await status(parent);
      const message = users(view).find(
        (text) => text.includes('DONE:') && text.includes('[message from thread'),
      );
      return message ? { view, message } : null;
    },
    600,
  );
  const settled = await idle(parent);

  return {
    parent,
    child: child ?? null,
    delivered: delivered.message,
    parentAnswer: answers(settled).at(-1) ?? null,
    checks: {
      childStarted: child !== undefined,
      doneReachedParent: delivered.message.includes('DONE:') && delivered.message.includes('42'),
      parentTookATurn: answers(settled).length >= 2,
    },
  };
};

const compactAndHandoff = async () => {
  const name = await create('f3 compaction');
  const budget = await capability('thread_context_budget', { name, tokens: 12000 });

  await send(
    name,
    'Call notes_write with exactly: "HANDOFF: goal=count files in /etc; done=nothing yet; next=run ls /etc | wc -l and report the number with the word CONTINUED". Then reply "noted".',
  );

  const filler = 'x'.repeat(1500);
  let compacted = false;
  let turns = 0;

  for (; turns < 12 && !compacted; turns++) {
    await send(
      name,
      `Filler ${turns}. Ignore this text and reply "ok". ${filler} ${filler} ${filler}`,
    );
    compacted = (await status(name)).messages.some((m) => m.kind === 'pi.compaction');
  }

  const resumed = await send(name, 'Continue the task from your HANDOFF note.');
  const last = answers(resumed).at(-1) ?? '';
  const usage = await capability('thread_compact', { name }).catch(() => null);

  return {
    name,
    budget: { contextWindow: budget.contextWindow },
    fillerTurns: turns,
    autoCompacted: compacted,
    resumedAnswer: last,
    manualCompact: usage === null ? null : 'ok',
    checks: {
      contextBudgetApplied: budget.contextWindow === 12000,
      compactedAutomatically: compacted,
      continuedFromHandoff: last.includes('CONTINUED') && /\d/u.test(last),
      ranTheNextStep: toolNames(resumed).includes('run'),
    },
  };
};

const results = {
  sendWait: await sendWait(),
  doneToParent: await doneToParent(),
  compaction: await compactAndHandoff(),
};

for (const name of made) await capability('thread_pause', { name }).catch(() => null);

const checks = Object.fromEntries(
  Object.entries(results).flatMap(([part, value]) =>
    Object.entries(value.checks).map(([check, passed]) => [`${part}.${check}`, passed]),
  ),
);
const receipt = {
  feature: 'F3 thread messaging, DONE: to parent, compaction at 75% with HANDOFF:',
  base: local ? 'local dev server' : base,
  at: new Date().toISOString(),
  ms: Date.now() - started,
  checks,
  passed: Object.values(checks).every(Boolean),
  results,
};

mkdirSync('receipts', { recursive: true });
const out = `receipts/f3-threads${local ? '-local' : ''}.json`;
writeFileSync(out, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(out, receipt.passed ? 'PASS' : 'FAIL', JSON.stringify(checks));
process.exit(receipt.passed ? 0 : 1);
