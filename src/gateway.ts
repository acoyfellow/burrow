import type { Provider } from '@earendil-works/pi-ai';
import {
  CLOUDFLARE_GATEWAY_BINDING_AUTH_SENTINEL,
  createAiBindingFetch,
} from '@earendil-works/pi-ai/api/cloudflare-ai-binding';
import { cloudflareAIGatewayProvider } from '@earendil-works/pi-ai/providers/cloudflare-ai-gateway';
import type { ModelChoice } from './agent';

export const GATEWAY_PREFIX = 'gateway/';

export const isGatewayModel = (id: string | undefined) => id?.startsWith(GATEWAY_PREFIX) === true;

export const upstreamId = (id: string) => id.slice(GATEWAY_PREFIX.length);

const ROUTES: Record<string, string> = {
  'anthropic-messages': 'anthropic',
  'openai-responses': 'openai',
  'openai-completions': 'compat',
};

export const bindingBaseUrl = (gateway: string, api: string) =>
  `https://workers-binding.ai/ai-gateway/gateways/${encodeURIComponent(gateway)}/${ROUTES[api] ?? 'compat'}`;

export type ExternalGateway = {
  readonly url: string;
  readonly header: string;
  readonly token: string;
};

export const externalBaseUrl = (gateway: ExternalGateway, api: string) =>
  `${gateway.url.replace(/\/+$/, '').replace(/\/(openai|anthropic)$/, '')}/${ROUTES[api] ?? 'openai'}`;

type BindingWithFetch = Ai & { fetch?: typeof fetch };

const STRIPPED = ['cf-aig-authorization', 'authorization', 'x-api-key'];

const withHeaders =
  (send: () => typeof fetch, extra: Record<string, string>): typeof fetch =>
  (input, init) => {
    const request = new Request(input, init);
    const headers = new Headers(request.headers);

    for (const name of STRIPPED) headers.delete(name);
    for (const [name, value] of Object.entries(extra)) headers.set(name, value);

    return send()(new Request(request, { headers }));
  };

const routedProvider = (baseUrl: (api: string) => string, send: typeof fetch): Provider => {
  const stock = cloudflareAIGatewayProvider();
  const routed = stock.getModels().map((model) => ({ ...model, baseUrl: baseUrl(model.api) }));

  return {
    ...stock,
    auth: {
      apiKey: {
        name: 'coil model gateway',
        resolve: async () => ({
          auth: {
            headers: {
              'cf-aig-authorization': `Bearer ${CLOUDFLARE_GATEWAY_BINDING_AUTH_SENTINEL}`,
              Authorization: null,
              'x-api-key': null,
            },
          },
        }),
      },
    },
    getModels: () => routed,
    getAllModels: () => routed,
    stream: (model, context, options) =>
      stock.stream(model as never, context, { ...options, fetch: send } as never),
    streamSimple: (model, context, options) =>
      stock.streamSimple(model as never, context, { ...options, fetch: send }),
  };
};

export const gatewayModel = (
  ai: Ai,
  gateway: string,
  id: string,
  external: ExternalGateway | null = null,
): ModelChoice => {
  const provider =
    external === null
      ? routedProvider(
          (api) => bindingBaseUrl(gateway, api),
          withHeaders(() => createAiBindingFetch(ai as BindingWithFetch), {}),
        )
      : routedProvider(
          (api) => externalBaseUrl(external, api),
          withHeaders(() => globalThis.fetch, {
            [external.header]: external.token,
            'x-requested-with': 'xmlhttprequest',
          }),
        );

  return { provider, modelId: upstreamId(id), options: {} };
};
