import { Hono } from 'hono';
import { AccessDenied, accessConfig, verifyAccess } from './access';
import { mcp } from './mcp';
import { type Coil, coil } from './service';
import { isSize, SIZES } from './size';
import type { Env } from './thread';
import { page } from './ui/index';
import { serviceWorker } from './ui/sw';
import { TERM_JS, TERM_VERSION } from './ui/term.generated';

export { Directory } from './directory';
export { Thread } from './thread';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const LOCAL_OWNER = 'local';

type Vars = { Bindings: Env; Variables: { who: string; api: Coil } };

const app = new Hono<Vars>();

app.use('*', async (c, next) => {
  if (c.env.LOCAL_DEV_WITHOUT_ACCESS === '1' && LOCAL_HOSTS.has(new URL(c.req.url).hostname)) {
    c.set('who', 'local');
    c.set('api', coil(c.env, LOCAL_OWNER));

    return next();
  }

  const config = accessConfig(c.env.ACCESS_TEAM_DOMAIN, c.env.ACCESS_AUD);

  if (config === null) return c.text('Access is not configured', 503);

  try {
    const identity = await verifyAccess(c.req.header('Cf-Access-Jwt-Assertion') ?? null, config);

    if (identity.email === null) return c.text('Forbidden: the Access token has no email', 403);

    c.set('who', identity.email.toLowerCase());
  } catch (cause) {
    if (cause instanceof AccessDenied) return c.text(`Forbidden: ${cause.message}`, 403);

    throw cause;
  }

  c.set('api', coil(c.env, c.var.who));

  return next();
});

const body = async <T>(request: Request): Promise<Partial<T>> =>
  (await request.json().catch(() => ({}))) as Partial<T>;

app.get('/', (c) => c.html(page()));
app.get('/t/:name', (c) => c.html(page()));

app.get('/api/threads', async (c) => c.json(await c.var.api.list()));

app.post('/api/threads', async (c) => {
  const input = await body<{
    name: string;
    repo: string;
    title: string;
    warm: boolean;
    size: string;
  }>(c.req.raw);

  if (input.size !== undefined && !isSize(input.size))
    return c.json({ error: `size must be one of ${SIZES.join(', ')}` }, 400);

  return c.json(
    await c.var.api.create({
      name: input.name,
      repo: input.repo ?? null,
      title: input.title,
      createdBy: 'web',
      warm: input.warm !== false,
      size: isSize(input.size) ? input.size : undefined,
    }),
    201,
  );
});

app.get('/api/threads/:name', async (c) => c.json(await c.var.api.view(c.req.param('name'))));

app.get('/api/threads/:name/events', async (c) => c.var.api.events(c.req.param('name'), c.req.raw));

app.post('/api/threads/:name/messages', async (c) => {
  const input = await body<{ text: string; wait: boolean }>(c.req.raw);
  const requestId = c.req.header('Idempotency-Key') ?? crypto.randomUUID();
  const text = input.text ?? '';

  if (text.trim() === '') return c.json({ error: 'text is required' }, 400);

  if (input.wait === true)
    return c.json({ requestId, ...(await c.var.api.send(c.req.param('name'), requestId, text)) });

  return c.json(await c.var.api.start(c.req.param('name'), requestId, text), 202);
});

app.post('/api/threads/:name/exec', async (c) => {
  const input = await body<{ argv: string[]; command: string }>(c.req.raw);

  return c.json(
    await c.var.api.exec(
      c.req.param('name'),
      input.argv ?? ['bash', '-lc', input.command ?? 'true'],
    ),
  );
});

app.get('/api/threads/:name/files', async (c) => {
  const path = c.req.query('path') ?? '.';

  return c.req.query('list') === '1'
    ? c.json(await c.var.api.list_dir(c.req.param('name'), path))
    : c.text(await c.var.api.read(c.req.param('name'), path));
});

app.post('/api/threads/:name/compact', async (c) =>
  c.json(await c.var.api.compact(c.req.param('name'))),
);

app.post('/api/threads/:name/pause', async (c) =>
  c.json(await c.var.api.pause(c.req.param('name'))),
);

app.post('/api/threads/:name/size', async (c) => {
  const input = await body<{ size: string }>(c.req.raw);

  if (!isSize(input.size)) return c.json({ error: `size must be one of ${SIZES.join(', ')}` }, 400);

  return c.json(await c.var.api.resize(c.req.param('name'), input.size));
});

app.get('/api/sizes', (c) => c.json(SIZES));

app.post('/api/threads/:name/fork', async (c) => {
  const input = await body<{ name: string }>(c.req.raw);

  return c.json(await c.var.api.fork(c.req.param('name'), input.name, 'web'), 201);
});

app.get('/api/threads/:name/terminal', async (c) =>
  c.req.header('Upgrade')?.toLowerCase() === 'websocket'
    ? c.var.api.socket(c.req.param('name'), 'terminal', c.req.raw)
    : c.text('Expected a WebSocket upgrade', 426),
);

app.get('/api/threads/:name/browser', async (c) =>
  c.req.header('Upgrade')?.toLowerCase() === 'websocket'
    ? c.var.api.socket(c.req.param('name'), 'browser', c.req.raw)
    : c.text('Expected a WebSocket upgrade', 426),
);

app.post('/api/threads/:name/surfaces', async (c) => {
  const input = await body<{ kind: string }>(c.req.raw);

  return c.json(
    input.kind === 'browser'
      ? await c.var.api.addBrowser(c.req.param('name'))
      : await c.var.api.addTerminal(c.req.param('name')),
  );
});

app.delete('/api/threads/:name/surfaces/:id', async (c) =>
  c.json(await c.var.api.closeSurface(c.req.param('name'), c.req.param('id'))),
);

app.get(`/assets/term-${TERM_VERSION}.js`, (c) =>
  c.body(TERM_JS, 200, {
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': 'public, max-age=31536000, immutable',
  }),
);

app.get('/sw.js', (c) =>
  c.body(serviceWorker(TERM_VERSION), 200, {
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': 'no-cache',
    'service-worker-allowed': '/',
  }),
);

app.get('/api/bases', async (c) => c.json(await c.var.api.bases()));

app.post('/api/bases', async (c) => {
  const input = await body<{ repo: string; setup: string }>(c.req.raw);

  if (typeof input.repo !== 'string' || input.repo === '')
    return c.json({ error: 'repo is required' }, 400);

  return c.json(await c.var.api.prepare(input.repo, input.setup ?? ''), 201);
});

app.get('/api/whoami', (c) => c.json({ who: c.var.who }));

app.post('/mcp', (c) => mcp(c.req.raw, c.var.api));

app.onError((error, c) => {
  const message = error instanceof Error ? error.message : String(error);
  const status = /no such file|not found|ENOENT|unknown thread/i.test(message)
    ? 404
    : /agent is working|command is running|name .* is taken/i.test(message)
      ? 409
      : 400;

  return c.json({ error: message }, status);
});

export default app;
