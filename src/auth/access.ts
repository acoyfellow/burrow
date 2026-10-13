import { AccessDenied, accessConfig, verifyAccess } from './access-jwt';
import type { Auth } from './types';

export type AccessEnv = {
  readonly ACCESS_TEAM_DOMAIN?: string;
  readonly ACCESS_AUD?: string;
};

export const accessAuth = (env: AccessEnv): Auth => ({
  mode: 'access',
  routes: async () => null,
  admit: async (request) => {
    const config = accessConfig(env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);

    if (config === null)
      return { refused: new Response('Access is not configured', { status: 503 }) };

    try {
      const identity = await verifyAccess(request.headers.get('Cf-Access-Jwt-Assertion'), config);

      if (identity.email === null)
        return {
          refused: new Response('Forbidden: the Access token has no email', { status: 403 }),
        };

      return { identity: { who: identity.email.toLowerCase() } };
    } catch (cause) {
      if (cause instanceof AccessDenied)
        return { refused: new Response(`Forbidden: ${cause.message}`, { status: 403 }) };

      throw cause;
    }
  },
});
