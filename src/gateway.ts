import type { Provider } from '@earendil-works/pi-ai';
import {
  CLOUDFLARE_GATEWAY_BINDING_AUTH_SENTINEL,
  createAiBindingFetch,
} from '@earendil-works/pi-ai/api/cloudflare-ai-binding';
import { cloudflareAIGatewayProvider } from '@earendil-works/pi-ai/providers/cloudflare-ai-gateway';
import type { ModelChoice } from './agent';

export const GATEWAY_PREFIX = 'gateway/';

export const isGatewayModel = (id: string) => id.startsWith(GATEWAY_PREFIX);

export const upstreamId = (id: string) => id.slice(GATEWAY_PREFIX.length);

const ROUTES: Record<string, string> = {
  'anthropic-messages': 'anthropic',
  'openai-responses': 'openai',
  'openai-completions': 'compat',
};

export const bindingBaseUrl = (gateway: string, api: string) =>
  `https://workers-binding.ai/ai-gateway/gateways/${encodeURIComponent(gateway)}/${ROUTES[api] ?? 'compat'}`;

type BindingWithFetch = Ai & { fetch?: typeof fetch };

export const gatewayModel = (ai: Ai, gateway: string, id: string): ModelChoice => {
  const stock = cloudflareAIGatewayProvider();
  const bindingFetch = createAiBindingFetch(ai as BindingWithFetch);
  const routed = stock.getModels().map((model) => ({
    ...model,
    baseUrl: bindingBaseUrl(gateway, model.api),
  }));
  const provider: Provider = {
    ...stock,
    auth: {
      apiKey: {
        name: 'AI Gateway binding',
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
      stock.stream(model as never, context, { ...options, fetch: bindingFetch } as never),
    streamSimple: (model, context, options) =>
      stock.streamSimple(model as never, context, { ...options, fetch: bindingFetch }),
  };

  return { provider, modelId: upstreamId(id), options: {} };
};
