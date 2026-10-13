import type { Directory, Grant } from '../directory';
import { refreshTokens } from './oauth';

export const TOKEN_REFRESH_MARGIN_MS = 60_000;

export class SignedOut extends Error {}

export type RefreshEnv = {
  readonly OAUTH_CLIENT_ID?: string;
  readonly OAUTH_CLIENT_SECRET?: string;
};

export const refreshedToken = async (
  env: RefreshEnv,
  grant: Grant,
  directory: DurableObjectStub<Directory>,
  send: typeof fetch = fetch,
): Promise<string> => {
  if (grant.refreshToken === null)
    throw new SignedOut('Your Cloudflare sign-in expired. Sign in with Cloudflare again.');

  const tokens = await refreshTokens(
    {
      clientId: env.OAUTH_CLIENT_ID ?? '',
      clientSecret: env.OAUTH_CLIENT_SECRET ?? '',
      redirectUri: '',
    },
    grant.refreshToken,
    send,
  ).catch(() => {
    throw new SignedOut('Your Cloudflare sign-in expired. Sign in with Cloudflare again.');
  });

  await directory.saveGrant({
    ...grant,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? grant.refreshToken,
    expiresAt: tokens.expiresAt,
    scope: tokens.scope === '' ? grant.scope : tokens.scope,
  });

  return tokens.accessToken;
};
