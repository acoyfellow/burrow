import { describe, expect, it } from 'vitest';
import { accessAuth } from '../src/auth/access';
import { authMode, isCloudflareOwner } from '../src/auth/types';

describe('auth mode', () => {
  it('defaults to access and accepts only the two modes', () => {
    expect(authMode(undefined)).toBe('access');
    expect(authMode('')).toBe('access');
    expect(authMode('access')).toBe('access');
    expect(authMode('cloudflare')).toBe('cloudflare');
    expect(authMode('both')).toBeNull();
  });

  it('access mode owns no routes, so /oauth/* falls through to the Access check', async () => {
    const auth = accessAuth({});

    expect(await auth.routes(new Request('https://coil.example/oauth/login'))).toBeNull();
    expect(await auth.routes(new Request('https://coil.example/oauth/callback?code=x'))).toBeNull();
  });

  it('access mode refuses when Access is not configured', async () => {
    const admitted = await accessAuth({}).admit(new Request('https://coil.example/'));

    expect('refused' in admitted && admitted.refused.status).toBe(503);
  });

  it('keeps Cloudflare-account owners apart from Access emails', () => {
    expect(isCloudflareOwner('cf:abc123')).toBe(true);
    expect(isCloudflareOwner('someone@example.com')).toBe(false);
  });
});
