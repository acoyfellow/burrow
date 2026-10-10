import { Hono } from 'hono';
import { AccessDenied, accessConfig, verifyAccess } from './access';
import { mcp } from './mcp';
import type { Env } from './thread';
import { page } from './ui';

export { Thread } from './thread';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

const app = new Hono<{ Bindings: Env }>();

app.use('*', async (c, next) => {
  if (c.env.LOCAL_DEV_WITHOUT_ACCESS === '1' && LOCAL_HOSTS.has(new URL(c.req.url).hostname))
    return next();

  const config = accessConfig(c.env.ACCESS_TEAM_DOMAIN, c.env.ACCESS_AUD);

  if (config === null) return c.text('Access is not configured', 503);

  try {
    await verifyAccess(c.req.header('Cf-Access-Jwt-Assertion') ?? null, config);
  } catch (cause) {
    if (cause instanceof AccessDenied) return c.text(`Forbidden: ${cause.message}`, 403);

    throw cause;
  }

  return next();
});

const thread = (env: Env, name: string) => {
  if (!NAME.test(name)) throw new Error('Thread names are lowercase letters, digits, and dashes');

  return env.THREAD.getByName(name);
};

app.get('/', (c) => c.html(page()));

app.get('/t/:name', (c) => c.html(page()));

app.post('/api/threads', async (c) => {
  const body = await c.req
    .json<{ name?: string; repo?: string }>()
    .catch(() => ({}) as { name?: string; repo?: string });
  const name = body.name ?? `t-${crypto.randomUUID().slice(0, 8)}`;

  return c.json(await thread(c.env, name).create(name, body.repo ?? null), 201);
});

app.get('/api/threads/:name', async (c) => c.json(await thread(c.env, c.req.param('name')).view()));

app.post('/api/threads/:name/messages', async (c) => {
  const body = await c.req.json<{ text: string }>();
  const requestId = c.req.header('Idempotency-Key') ?? crypto.randomUUID();

  return c.json({
    requestId,
    ...(await thread(c.env, c.req.param('name')).send(requestId, body.text)),
  });
});

app.post('/api/threads/:name/exec', async (c) => {
  const body = await c.req.json<{ argv?: string[]; command?: string }>();
  const argv = body.argv ?? ['sh', '-lc', body.command ?? 'true'];

  return c.json(await thread(c.env, c.req.param('name')).exec(argv));
});

app.get('/api/threads/:name/files', async (c) =>
  c.text(await thread(c.env, c.req.param('name')).readFile(c.req.query('path') ?? '')),
);

app.post('/api/threads/:name/compact', async (c) =>
  c.json(await thread(c.env, c.req.param('name')).compact()),
);

app.post('/api/threads/:name/pause', async (c) =>
  c.json(await thread(c.env, c.req.param('name')).pause()),
);

app.post('/mcp', (c) => mcp(c.req.raw, c.env, thread));

app.onError((error, c) => c.json({ error: error.message }, 400));

export default app;
