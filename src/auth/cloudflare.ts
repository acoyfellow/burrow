import type { Auth } from './types';

export type CloudflareAuthEnv = Record<string, unknown>;

export const cloudflareAuth = (_env: CloudflareAuthEnv): Auth => ({
  mode: 'cloudflare',
  routes: async () => null,
  admit: async () => ({
    refused: new Response('Sign in with Cloudflare is not ready', { status: 503 }),
  }),
});
