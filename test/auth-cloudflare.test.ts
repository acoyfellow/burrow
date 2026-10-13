import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript';
import { describe, expect, it } from 'vitest';
import { accountModel } from '../src/auth/account-models';
import { authorizeUrl, exchangeCode, SCOPES } from '../src/auth/oauth';
import { parseSession, readCookie, sign, unsign } from '../src/auth/session';

const SECRET = 'a'.repeat(40);

describe('Sign in with Cloudflare', () => {
  it('asks Cloudflare for a PKCE code with the AI scopes', async () => {
    const url = new URL(
      await authorizeUrl(
        {
          clientId: 'client',
          clientSecret: 's',
          redirectUri: 'https://coil.example/oauth/callback',
        },
        'state-1',
        'verifier-1',
      ),
    );

    expect(url.origin + url.pathname).toBe('https://dash.cloudflare.com/oauth2/auth');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('state-1');
    expect(url.searchParams.get('scope')?.split(' ')).toEqual([...SCOPES]);
    expect(SCOPES).toContain('aig.run');
    expect(SCOPES).toContain('ai.write');
    expect(SCOPES).toContain('offline_access');
  });

  it('exchanges the code with the client secret and the verifier', async () => {
    const seen: Request[] = [];
    const tokens = await exchangeCode(
      {
        clientId: 'client',
        clientSecret: 'shh',
        redirectUri: 'https://coil.example/oauth/callback',
      },
      'the-code',
      'the-verifier',
      async (input, init) => {
        seen.push(new Request(input, init));
        return Response.json({
          access_token: 'at',
          refresh_token: 'rt',
          expires_in: 600,
          scope: 'ai.write',
        });
      },
      1000,
    );
    const body = new URLSearchParams(await seen[0]?.text());

    expect(tokens).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: 601_000,
      scope: 'ai.write',
    });
    expect(seen[0]?.headers.get('authorization')).toBe(`Basic ${btoa('client:shh')}`);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code_verifier')).toBe('the-verifier');
  });

  it('signs sessions so a changed cookie is refused', async () => {
    const value = await sign(
      SECRET,
      JSON.stringify({ owner: 'cf:1', id: 'x', expires: Date.now() + 1000 }),
    );

    expect(parseSession(await unsign(SECRET, value))?.owner).toBe('cf:1');
    expect(await unsign(SECRET, value.replace(/^./u, 'Z'))).toBeNull();
    expect(await unsign('b'.repeat(40), value)).toBeNull();
    expect(parseSession(JSON.stringify({ owner: 'cf:1', id: 'x', expires: 1 }))).toBeNull();
    expect(
      readCookie(
        new Request('https://x', { headers: { cookie: `a=1; s=${encodeURIComponent(value)}` } }),
        's',
      ),
    ).toBe(value);
  });
});

describe('models for a signed-in Cloudflare account', () => {
  const credentials = { accountId: 'acct-123', gateway: 'gw', token: async () => 'user-token' };

  const captured = async (id: string) => {
    const seen: Request[] = [];
    const model = accountModel(credentials, id, async (input, init) => {
      seen.push(new Request(input, init));
      return new Response('{}', { status: 500 });
    });
    const resolved = model.provider.getModels().find((each) => each.id === model.modelId);

    const stream = model.provider.streamSimple(
      resolved as never,
      normalizeContext({ messages: [{ role: 'user', content: 'hi', timestamp: 0 }] }),
      { apiKey: 'resolved-by-the-harness' },
    );

    for await (const _event of stream);

    return { model, seen };
  };

  it('sends Claude Opus 5.5 to the user account AI Gateway with their token', async () => {
    const { model, seen } = await captured('gateway/claude-opus-5-5');

    expect(model.modelId).toBe('claude-opus-5-5');
    expect(seen[0]?.url.split('?')[0]).toBe(
      'https://gateway.ai.cloudflare.com/v1/acct-123/gw/anthropic/v1/messages',
    );
    expect(seen[0]?.headers.get('cf-aig-authorization')).toBe('Bearer user-token');
    expect(seen[0]?.headers.get('authorization')).toBeNull();
  });

  it('sends Workers AI models to the user account with their token, never the AI binding', async () => {
    const { seen } = await captured('@cf/deepseek-ai/deepseek-v4-flash-0731');

    expect(
      seen[0]?.url.startsWith('https://api.cloudflare.com/client/v4/accounts/acct-123/ai/v1'),
    ).toBe(true);
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer user-token');
  });
});
