import { describe, expect, it } from 'vitest';
import { mayUseHostInference } from '../src/auth/types';

describe('host inference policy', () => {
  it('never runs host inference on a Sign in with Cloudflare instance', () => {
    expect(mayUseHostInference('cloudflare', 'cf:user-1')).toBe(false);
    expect(mayUseHostInference('cloudflare', 'someone@example.com')).toBe(false);
    expect(mayUseHostInference('cloudflare', '')).toBe(false);
  });

  it('never runs host inference for a Cloudflare-signed-in owner, in any mode', () => {
    expect(mayUseHostInference('access', 'cf:user-1')).toBe(false);
    expect(mayUseHostInference(undefined, 'cf:user-1')).toBe(false);
  });

  it('allows host inference only for Access owners on an Access instance', () => {
    expect(mayUseHostInference('access', 'someone@example.com')).toBe(true);
  });

  it('refuses an unknown auth mode', () => {
    expect(mayUseHostInference('both', 'someone@example.com')).toBe(false);
  });
});
