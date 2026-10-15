import { describe, expect, it } from 'vitest';
import { gatewayPage } from '../src/auth/gateway-page';
import { listGateways } from '../src/auth/oauth';

const respond =
  (status: number, body: unknown): typeof fetch =>
  async () =>
    new Response(JSON.stringify(body), { status });

describe('listGateways', () => {
  it('reports the Cloudflare error when the list call is refused', async () => {
    const listing = await listGateways(
      'token',
      'acct',
      respond(403, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] }),
    );

    expect(listing).toEqual({
      gateways: [],
      problem: 'Cloudflare returned 403: Authentication error',
    });
  });

  it('refuses an empty account without calling Cloudflare', async () => {
    let called = false;
    const listing = await listGateways('token', '', async () => {
      called = true;
      return new Response('{}');
    });

    expect(called).toBe(false);
    expect(listing.problem).toContain('no account');
  });

  it('lists gateways and marks the ones with authentication on', async () => {
    const listing = await listGateways(
      'token',
      'acct',
      respond(200, { result: [{ id: 'my-ax', authentication: true }, { id: 'open' }] }),
    );

    expect(listing).toEqual({
      gateways: [
        { id: 'my-ax', authenticated: true },
        { id: 'open', authenticated: false },
      ],
      problem: null,
    });
  });
});

describe('gatewayPage', () => {
  it('shows the listing problem instead of an empty picker', () => {
    const page = gatewayPage({
      accountName: 'Acme',
      current: null,
      gateways: [],
      problem: 'Cloudflare returned 403',
    });

    expect(page).toContain('could not list AI Gateways on Acme');
    expect(page).toContain('Cloudflare returned 403');
  });

  it('explains how to create a gateway when the account has none', () => {
    const page = gatewayPage({ accountName: 'Acme', current: null, gateways: [], problem: null });

    expect(page).toContain('Acme has no AI Gateways');
  });
});
