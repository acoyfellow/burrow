import type { Provider } from '@earendil-works/pi-ai';
import { cloudflareAIGatewayProvider } from '@earendil-works/pi-ai/providers/cloudflare-ai-gateway';
import { cloudflareWorkersAIProvider } from '@earendil-works/pi-ai/providers/cloudflare-workers-ai';
import type { ModelChoice } from '../agent';
import { isGatewayModel, rewriteBody, upstreamId } from '../gateway';

export type AccountRoute = {
  readonly accountId: string;
  readonly gateway: string;
  readonly token: string;
};

export type AccountCredentials = {
  readonly route: () => Promise<AccountRoute>;
};

const STRIPPED = ['cf-aig-authorization', 'authorization', 'x-api-key'];

const ACCOUNT_SLOT = '{CLOUDFLARE_ACCOUNT_ID}';

const GATEWAY_SLOT = '{CLOUDFLARE_GATEWAY_ID}';

const filled = (url: string, route: Pick<AccountRoute, 'accountId' | 'gateway'>) =>
  url
    .replaceAll(encodeURIComponent(ACCOUNT_SLOT), encodeURIComponent(route.accountId))
    .replaceAll(encodeURIComponent(GATEWAY_SLOT), encodeURIComponent(route.gateway))
    .replaceAll(ACCOUNT_SLOT, encodeURIComponent(route.accountId))
    .replaceAll(GATEWAY_SLOT, encodeURIComponent(route.gateway));

const withToken =
  (
    credentials: AccountCredentials,
    header: 'authorization' | 'cf-aig-authorization',
    send: typeof fetch,
  ): typeof fetch =>
  async (input, init) => {
    const request = new Request(input, init);
    const route = await credentials.route();
    const headers = new Headers(request.headers);

    for (const name of STRIPPED) headers.delete(name);
    headers.set(header, `Bearer ${route.token}`);

    return send(
      new Request(filled(request.url, route), {
        method: request.method,
        headers,
        body: await rewriteBody(request),
        signal: request.signal,
      }),
    );
  };

const accountProvider = (
  stock: Provider,
  credentials: AccountCredentials,
  header: 'authorization' | 'cf-aig-authorization',
  send: typeof fetch,
): Provider => {
  const models = stock.getModels();
  const routed = withToken(credentials, header, send);

  return {
    ...stock,
    auth: {
      apiKey: {
        name: 'signed-in Cloudflare account',
        resolve: async () => ({
          auth: {
            headers: { [header]: 'set-per-request', Authorization: null, 'x-api-key': null },
          },
        }),
      },
    },
    getModels: () => models,
    getAllModels: () => models,
    stream: (model, context, options) =>
      stock.stream(model as never, context, { ...options, fetch: routed } as never),
    streamSimple: (model, context, options) =>
      stock.streamSimple(model, context, { ...options, fetch: routed }),
  };
};

export const accountModel = (
  credentials: AccountCredentials,
  id: string,
  send: typeof fetch = (input, init) => globalThis.fetch(input, init),
): ModelChoice =>
  isGatewayModel(id)
    ? {
        provider: accountProvider(
          cloudflareAIGatewayProvider(),
          credentials,
          'cf-aig-authorization',
          send,
        ),
        modelId: upstreamId(id),
        options: {},
      }
    : {
        provider: accountProvider(
          cloudflareWorkersAIProvider(),
          credentials,
          'authorization',
          send,
        ),
        modelId: id,
        options: {},
      };
