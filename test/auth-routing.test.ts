import { describe, expect, it } from 'vitest';
import { gate } from '../src/auth/gate';

const sessions = new Map<string, string>();

const directory = {
  getByName: () => ({
    saveGrant: async () => undefined,
    openSession: async (id: string, owner: string) => void sessions.set(id, owner),
    sessionOwner: async (id: string) => sessions.get(id) ?? null,
  }),
};

const call = async (path: string, env: Record<string, unknown>) => {
  const result = await gate(new Request(`https://coil.example${path}`), {
    DIRECTORY: directory,
    ...env,
  } as never);

  return result.kind === 'response'
    ? result.response
    : Response.json({ admitted: result.identity.who });
};

describe('auth routing in the Worker', () => {
  it('in access mode /oauth/* is never a sign-in route: Access refuses it like any other path', async () => {
    const env = { COIL_AUTH: 'access' };

    for (const path of ['/oauth/login', '/oauth/callback?code=x&state=y', '/oauth/logout']) {
      const response = await call(path, env);

      expect(response.status).toBe(503);
      expect(await response.text()).toBe('Access is not configured');
      expect(response.headers.get('location')).toBeNull();
    }
  });

  it('refuses an unknown COIL_AUTH instead of guessing', async () => {
    const response = await call('/', { COIL_AUTH: 'both' });

    expect(response.status).toBe(503);
  });

  it('in cloudflare mode without a session the API answers 401 and pages show sign-in', async () => {
    const env = {
      COIL_AUTH: 'cloudflare',
      OAUTH_CLIENT_ID: 'client',
      OAUTH_CLIENT_SECRET: 'secret',
      SESSION_SECRET: 's'.repeat(40),
    };
    const api = await call('/api/capabilities/thread_list', env);
    const home = await call('/', env);

    expect(api.status).toBe(401);
    expect(await api.json()).toMatchObject({ login: '/oauth/login' });
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('Sign in with Cloudflare');
  });

  it('in cloudflare mode /oauth/login sends the browser to Cloudflare with a signed flow cookie', async () => {
    const response = await call('/oauth/login', {
      COIL_AUTH: 'cloudflare',
      OAUTH_CLIENT_ID: 'client',
      OAUTH_CLIENT_SECRET: 'secret',
      SESSION_SECRET: 's'.repeat(40),
    });
    const location = new URL(response.headers.get('location') ?? '');

    expect(response.status).toBe(302);
    expect(location.origin).toBe('https://dash.cloudflare.com');
    expect(location.searchParams.get('redirect_uri')).toBe('https://coil.example/oauth/callback');
    expect(response.headers.get('set-cookie')).toContain('__Host-coil_oauth=');
  });

  it('in cloudflare mode a callback that did not start here is refused', async () => {
    const response = await call('/oauth/callback?code=x&state=forged', {
      COIL_AUTH: 'cloudflare',
      OAUTH_CLIENT_ID: 'client',
      OAUTH_CLIENT_SECRET: 'secret',
      SESSION_SECRET: 's'.repeat(40),
    });

    expect(response.status).toBe(400);
  });
});
