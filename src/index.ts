import { Context } from 'effect';
import { AccessDenied, accessConfig, verifyAccess } from './access';
import { mcp } from './mcp';
import { serveRest } from './rest';
import { type Caller, handlersFor, isRpcPath, rpcHandler } from './rpc';
import { type Coil, coil } from './service';
import type { Env } from './thread';
import { page } from './ui/index';
import { serviceWorker } from './ui/sw';
import { TERM_JS, TERM_VERSION } from './ui/term.generated';

export { Directory } from './directory';
export { Thread } from './thread';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const LOCAL_OWNER = 'local';

const THREAD_SOCKET = /^\/api\/threads\/([a-z0-9][a-z0-9-]{0,62})\/(terminal|browser)$/;

const THREAD_EVENTS = /^\/api\/threads\/([a-z0-9][a-z0-9-]{0,62})\/events$/;

const THREAD_UPLOAD = /^\/api\/threads\/([a-z0-9][a-z0-9-]{0,62})\/upload$/;

const UPLOAD_LIMIT = 10 * 1024 * 1024;

const UPLOAD_NAME = /^[\w.-]{1,120}$/;

const PAGE = /^\/(t\/[a-z0-9][a-z0-9-]{0,62})?\/?$/;

type Owner = Caller & { readonly api: Coil };

type Admission = { readonly caller: Owner } | { readonly refused: Response };

const receiveUpload = async (request: Request, caller: Owner, name: string): Promise<Response> => {
  const file = new URL(request.url).searchParams.get('file') ?? '';
  const length = Number(request.headers.get('content-length') ?? 'NaN');

  if (!UPLOAD_NAME.test(file) || file.startsWith('.'))
    return Response.json(
      { error: 'file names are letters, digits, dot, dash, underscore' },
      { status: 400 },
    );

  if (!(length <= UPLOAD_LIMIT))
    return Response.json({ error: 'files are limited to 10 MB' }, { status: 413 });

  const bytes = await request.arrayBuffer();

  if (bytes.byteLength > UPLOAD_LIMIT)
    return Response.json({ error: 'files are limited to 10 MB' }, { status: 413 });

  try {
    const path = await caller.api.upload(name, `uploads/${file}`, bytes);

    return Response.json({ path });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);

    return Response.json(
      { error: reason },
      { status: reason.startsWith('unknown thread') ? 404 : 500 },
    );
  }
};

const isLocalDev = (request: Request, env: Env) =>
  env.LOCAL_DEV_WITHOUT_ACCESS === '1' && LOCAL_HOSTS.has(new URL(request.url).hostname);

const admit = async (request: Request, env: Env): Promise<Admission> => {
  if (isLocalDev(request, env))
    return { caller: { who: LOCAL_OWNER, api: coil(env, LOCAL_OWNER) } };

  const config = accessConfig(env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);

  if (config === null)
    return { refused: new Response('Access is not configured', { status: 503 }) };

  try {
    const identity = await verifyAccess(request.headers.get('Cf-Access-Jwt-Assertion'), config);

    if (identity.email === null)
      return { refused: new Response('Forbidden: the Access token has no email', { status: 403 }) };

    const who = identity.email.toLowerCase();

    return { caller: { who, api: coil(env, who) } };
  } catch (cause) {
    if (cause instanceof AccessDenied)
      return { refused: new Response(`Forbidden: ${cause.message}`, { status: 403 }) };

    throw cause;
  }
};

const isCrossOriginWrite = (request: Request) => {
  const origin = request.headers.get('Origin');
  const isWrite = request.method !== 'GET' && request.method !== 'HEAD';

  return isWrite && origin !== null && origin !== new URL(request.url).origin;
};

const script = (body: string, cache: string) =>
  new Response(body, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': cache,
      'service-worker-allowed': '/',
    },
  });

const upgrade = (request: Request, caller: Owner, name: string, kind: 'terminal' | 'browser') =>
  request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
    ? caller.api.socket(name, kind, request)
    : Promise.resolve(new Response('Expected a WebSocket upgrade', { status: 426 }));

const failed = (cause: unknown) => {
  const message = cause instanceof Error ? cause.message : String(cause);
  const status = /unknown thread|not found/i.test(message) ? 404 : 400;

  return Response.json({ error: message }, { status });
};

const route = async (request: Request, env: Env, caller: Owner): Promise<Response> => {
  const url = new URL(request.url);
  const { pathname } = url;

  if (isRpcPath(pathname)) return rpcHandler(caller)(request, Context.empty());

  if (pathname === '/mcp' && request.method === 'POST') return mcp(request, caller.api);

  if (pathname === `/assets/term-${TERM_VERSION}.js`)
    return script(TERM_JS, 'public, max-age=31536000, immutable');

  if (pathname === '/sw.js') return script(serviceWorker(TERM_VERSION), 'no-cache');

  const socket = THREAD_SOCKET.exec(pathname);

  if (socket?.[1] !== undefined && socket[2] !== undefined)
    return upgrade(request, caller, socket[1], socket[2] === 'browser' ? 'browser' : 'terminal');

  const upload = THREAD_UPLOAD.exec(pathname);

  if (upload?.[1] !== undefined && request.method === 'PUT')
    return receiveUpload(request, caller, upload[1]);

  const events = THREAD_EVENTS.exec(pathname);

  if (events?.[1] !== undefined) return caller.api.events(events[1], request);

  if (pathname.startsWith('/api/'))
    return (
      (await serveRest(request, handlersFor(caller))) ??
      Response.json({ error: 'not found' }, { status: 404 })
    );

  if (PAGE.test(pathname) && request.method === 'GET')
    return new Response(page(), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
    });

  return env.ASSETS.fetch(request);
};

export default {
  async fetch(request, env) {
    const admission = await admit(request, env);

    if ('refused' in admission) return admission.refused;

    if (isCrossOriginWrite(request))
      return new Response('cross-origin request refused', { status: 403 });

    try {
      return await route(request, env, admission.caller);
    } catch (cause) {
      return failed(cause);
    }
  },
} satisfies ExportedHandler<Env>;
