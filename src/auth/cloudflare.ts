import type { Directory } from '../directory';
import { DIRECTORY_NAME } from '../directory-name';
import {
  accountsOf,
  authorizeUrl,
  exchangeCode,
  type OAuthClient,
  OAuthFailed,
  randomToken,
  revoke,
  userInfo,
} from './oauth';
import {
  clearCookie,
  cookie,
  cookieJar,
  FLOW_TTL_MS,
  parseSession,
  readCookie,
  SESSION_TTL_MS,
  sessionValue,
  sign,
  unsign,
} from './session';
import { signInPage } from './sign-in-page';
import { type Auth, CLOUDFLARE_OWNER_PREFIX } from './types';

export type CloudflareAuthEnv = {
  readonly DIRECTORY: DurableObjectNamespace<Directory>;
  readonly OAUTH_CLIENT_ID?: string;
  readonly OAUTH_CLIENT_SECRET?: string;
  readonly SESSION_SECRET?: string;
  readonly COIL_USER_GATEWAY?: string;
};

const DEFAULT_GATEWAY = 'default';

const html = (body: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });

const redirect = (location: string, cookies: string[] = []) => {
  const headers = new Headers({ location, 'cache-control': 'no-store' });

  for (const each of cookies) headers.append('set-cookie', each);

  return new Response(null, { status: 302, headers });
};

const wantsJson = (request: Request) => {
  const path = new URL(request.url).pathname;

  return path.startsWith('/api/') || path === '/mcp' || path === '/llms.txt';
};

type Flow = { readonly state: string; readonly verifier: string; readonly expires: number };

const parseFlow = (raw: string | null, now = Date.now()): Flow | null => {
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('state' in parsed) ||
      !('verifier' in parsed) ||
      !('expires' in parsed)
    )
      return null;

    const { state, verifier, expires } = parsed;

    return typeof state === 'string' &&
      typeof verifier === 'string' &&
      typeof expires === 'number' &&
      expires > now
      ? { state, verifier, expires }
      : null;
  } catch {
    return null;
  }
};

export const cloudflareAuth = (env: CloudflareAuthEnv, send: typeof fetch = fetch): Auth => {
  const directory = () => env.DIRECTORY.getByName(DIRECTORY_NAME);
  const secret = env.SESSION_SECRET ?? '';
  const ready =
    (env.OAUTH_CLIENT_ID ?? '') !== '' &&
    (env.OAUTH_CLIENT_SECRET ?? '') !== '' &&
    secret.length >= 32;

  const clientFor = (request: Request): OAuthClient => ({
    clientId: env.OAUTH_CLIENT_ID ?? '',
    clientSecret: env.OAUTH_CLIENT_SECRET ?? '',
    redirectUri: `${new URL(request.url).origin}/oauth/callback`,
  });

  const page = (request: Request, error: string | undefined, status: number) => {
    const jar = cookieJar(request.url);

    return html(signInPage(error === undefined ? {} : { error }), status, {
      'set-cookie': clearCookie(jar, jar.flow),
    });
  };

  const notReady = (request: Request) =>
    page(request, 'Sign in with Cloudflare is not configured on this instance yet.', 503);

  const login = async (request: Request) => {
    if (!ready) return notReady(request);

    const flow: Flow = {
      state: randomToken(),
      verifier: randomToken(48),
      expires: Date.now() + FLOW_TTL_MS,
    };

    const jar = cookieJar(request.url);

    return redirect(await authorizeUrl(clientFor(request), flow.state, flow.verifier), [
      cookie(jar, jar.flow, await sign(secret, JSON.stringify(flow)), FLOW_TTL_MS),
    ]);
  };

  const callback = async (request: Request) => {
    if (!ready) return notReady(request);

    const url = new URL(request.url);
    const jar = cookieJar(request.url);
    const denied = url.searchParams.get('error');

    if (denied !== null)
      return page(
        request,
        `Cloudflare did not sign you in: ${url.searchParams.get('error_description') ?? denied}`,
        400,
      );

    const flow = parseFlow(await unsign(secret, readCookie(request, jar.flow)));
    const code = url.searchParams.get('code');

    if (flow === null || code === null || url.searchParams.get('state') !== flow.state)
      return page(request, 'That sign-in link expired or did not start here. Try again.', 400);

    try {
      const client = clientFor(request);
      const tokens = await exchangeCode(client, code, flow.verifier, send);
      const user = await userInfo(tokens.accessToken, send);
      const [account] = await accountsOf(tokens.accessToken, send);

      if (account === undefined)
        return page(
          request,
          'You did not give coil access to any Cloudflare account. Sign in again and pick one.',
          403,
        );

      const owner = `${CLOUDFLARE_OWNER_PREFIX}${user.sub}`;
      const session = { owner, id: randomToken(), expires: Date.now() + SESSION_TTL_MS };

      await directory().saveGrant({
        owner,
        email: user.email,
        accountId: account.id,
        accountName: account.name,
        gateway: env.COIL_USER_GATEWAY ?? DEFAULT_GATEWAY,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        scope: tokens.scope,
      });
      await directory().openSession(session.id, owner, session.expires);

      return redirect('/', [
        clearCookie(jar, jar.flow),
        cookie(jar, jar.session, await sign(secret, sessionValue(session)), SESSION_TTL_MS),
      ]);
    } catch (cause) {
      if (cause instanceof OAuthFailed) return page(request, cause.message, 502);

      throw cause;
    }
  };

  const sessionOf = async (request: Request) => {
    if (!ready) return null;

    const session = parseSession(
      await unsign(secret, readCookie(request, cookieJar(request.url).session)),
    );

    if (session === null) return null;

    return (await directory().sessionOwner(session.id)) === session.owner ? session : null;
  };

  const logout = async (request: Request) => {
    const session = await sessionOf(request);

    if (session !== null) {
      const grant = await directory().grantFor(session.owner);

      await directory().closeSession(session.id);

      if (grant !== null) {
        await revoke(clientFor(request), grant.refreshToken ?? grant.accessToken, send);
        await directory().dropGrant(session.owner);
      }
    }

    const jar = cookieJar(request.url);

    return redirect('/', [clearCookie(jar, jar.session)]);
  };

  return {
    mode: 'cloudflare',
    routes: async (request) => {
      const { pathname } = new URL(request.url);

      if (pathname === '/oauth/login' && request.method === 'GET') return login(request);

      if (pathname === '/oauth/callback' && request.method === 'GET') return callback(request);

      if (pathname === '/oauth/logout' && request.method === 'POST') return logout(request);

      return null;
    },
    admit: async (request) => {
      const session = await sessionOf(request);

      if (session !== null) return { identity: { who: session.owner } };

      if (wantsJson(request))
        return {
          refused: Response.json(
            { error: 'sign in with Cloudflare first', login: '/oauth/login' },
            { status: 401 },
          ),
        };

      return { refused: html(signInPage({}), ready ? 200 : 503) };
    },
  };
};
