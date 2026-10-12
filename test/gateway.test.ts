import { createModels } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { GATEWAY_MODELS } from '../shared/models';
import { bindingBaseUrl, gatewayModel, isGatewayModel, upstreamId } from '../src/gateway';

type Seen = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

const fakeAi = (seen: Seen[]) =>
  ({
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);

      seen.push({
        url: request.url,
        headers: Object.fromEntries(request.headers),
        body: (await request.json()) as Record<string, unknown>,
      });

      return new Response('upstream says no', { status: 402 });
    },
  }) as unknown as Ai;

const runOnce = async (id: string) => {
  const seen: Seen[] = [];
  const choice = gatewayModel(fakeAi(seen), 'my-gw', id);
  const models = createModels(choice.options);

  models.setProvider(choice.provider);

  const model = models.getModel(choice.provider.id, choice.modelId);

  if (model === undefined) throw new Error(`no model ${choice.modelId}`);

  await models.complete(model, { messages: [{ role: 'user', content: 'hi', timestamp: 0 }] });

  return seen;
};

describe('AI Gateway models', () => {
  it('names gateway models with a prefix and strips it for the upstream id', () => {
    expect(isGatewayModel('gateway/claude-opus-5-5')).toBe(true);
    expect(isGatewayModel('@cf/zai-org/glm-5.3')).toBe(false);
    expect(upstreamId('gateway/gpt-5.6-sol')).toBe('gpt-5.6-sol');
  });

  it('routes each provider API to its gateway path on the binding', () => {
    expect(bindingBaseUrl('jordan', 'anthropic-messages')).toBe(
      'https://workers-binding.ai/ai-gateway/gateways/jordan/anthropic',
    );
    expect(bindingBaseUrl('jordan', 'openai-responses')).toBe(
      'https://workers-binding.ai/ai-gateway/gateways/jordan/openai',
    );
  });

  it('knows every listed gateway model', async () => {
    for (const info of GATEWAY_MODELS) {
      const choice = gatewayModel(fakeAi([]), 'g', info.id);

      expect(choice.provider.getModels().some((m) => m.id === choice.modelId)).toBe(true);
    }
  });

  it('sends Claude as Anthropic messages through the binding with no API key', async () => {
    const [sent] = await runOnce('gateway/claude-sonnet-5-5');

    expect(sent?.url.split('?')[0]).toBe(
      'https://workers-binding.ai/ai-gateway/gateways/my-gw/anthropic/v1/messages',
    );
    expect(sent?.body.model).toBe('claude-sonnet-5-5');
    expect(sent?.headers.authorization).toBeUndefined();
    expect(sent?.headers['x-api-key']).toBeUndefined();
  });

  it('sends GPT as OpenAI responses through the binding', async () => {
    const [sent] = await runOnce('gateway/gpt-5.6-sol');

    expect(sent?.url).toBe('https://workers-binding.ai/ai-gateway/gateways/my-gw/openai/responses');
    expect(sent?.body.model).toBe('gpt-5.6-sol');
    expect(sent?.headers.authorization).toBeUndefined();
  });
});
