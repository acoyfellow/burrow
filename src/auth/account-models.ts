import type { Provider } from '@earendil-works/pi-ai';
import { cloudflareAIGatewayProvider } from '@earendil-works/pi-ai/providers/cloudflare-ai-gateway';
import { cloudflareWorkersAIProvider } from '@earendil-works/pi-ai/providers/cloudflare-workers-ai';
import type { ModelChoice } from '../agent';
import { isGatewayModel, upstreamId } from '../gateway';

export type AccountCredentials = {
  readonly accountId: string;
  readonly gateway: string;
  readonly token: () => Promise<string>;
};

const STRIPPED = ['cf-aig-authorization', 'authorization', 'x-api-key'];

const ACCOUNT_SLOT = '{CLOUDFLARE_ACCOUNT_ID}';

const GATEWAY_SLOT = '{CLOUDFLARE_GATEWAY_ID}';

const withToken =
  (
    credentials: AccountCredentials,
    header: 'authorization' | 'cf-aig-authorization',
    send: typeof fetch,
  ): typeof fetch =>
  async (input, init) => {
    const request = new Request(input, init);
    const headers = new Headers(request.headers);

    for (const name of STRIPPED) headers.delete(name);
    headers.set(header, `Bearer ${await credentials.token()}`);

    return send(new Request(request, { headers }));
  };

const filled = (url: string, credentials: AccountCredentials) =>
  url
    .replaceAll(ACCOUNT_SLOT, encodeURIComponent(credentials.accountId))
    .replaceAll(GATEWAY_SLOT, encodeURIComponent(credentials.gateway));

const accountProvider = (
  stock: Provider,
  credentials: AccountCredentials,
  header: 'authorization' | 'cf-aig-authorization',
  send: typeof fetch,
): Provider => {
  const models = stock
    .getModels()
    .map((model) => ({ ...model, baseUrl: filled(model.baseUrl, credentials) }));
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
