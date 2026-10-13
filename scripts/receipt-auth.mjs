import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const base = (process.argv[2] ?? 'http://localhost:8833').replace(/\/$/u, '');
const cookieFile = process.env.COIL_SESSION_COOKIE_FILE ?? '/tmp/coil-loop/.session-cookie';
const model = process.env.COIL_RECEIPT_MODEL ?? 'gateway/claude-opus-5-5';
const sessionCookie = readFileSync(cookieFile, 'utf8').trim();

const call = async (capability, input, cookie = sessionCookie) => {
  const response = await fetch(`${base}/api/capabilities/${capability}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', cookie },
    body: JSON.stringify(input),
  });
  const text = await response.text();
  let body = null;

  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 300) };
  }

  return { status: response.status, body };
};

const started = Date.now();
const anonymous = await call('thread_list', {}, '');
const created = await call('thread_create', { title: 'auth receipt' });
const name = created.body?.name;
const switched = await call('thread_model', { name, model });
const sent = await call('thread_send', {
  name,
  text: 'Reply with exactly the words: coil auth ok',
});

const answer = {
  text: typeof sent.body?.answer === 'string' ? sent.body.answer : '',
  error: sent.body?.error ?? (sent.status === 200 ? null : JSON.stringify(sent.body).slice(0, 300)),
};

const checks = {
  anonymousRefused: anonymous.status === 401,
  signedInCreates: created.status === 200 && typeof name === 'string',
  modelSwitched: switched.status === 200,
  turnSent: sent.status === 200,
  opusAnswered: /coil auth ok/iu.test(answer?.text ?? ''),
};

const receipt = {
  ok: Object.values(checks).every(Boolean),
  base,
  model,
  thread: name ?? null,
  checks,
  answer: answer?.text?.slice(0, 200) ?? null,
  error: answer?.error ?? null,
  seconds: Math.round((Date.now() - started) / 1000),
  at: new Date().toISOString(),
};

mkdirSync('receipts', { recursive: true });
writeFileSync(
  process.env.COIL_RECEIPT_OUT ?? 'receipts/auth-cloudflare.json',
  `${JSON.stringify(receipt, null, 2)}\n`,
);
console.log(JSON.stringify(receipt, null, 2));
process.exit(receipt.ok ? 0 : 1);
