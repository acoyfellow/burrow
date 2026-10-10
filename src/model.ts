import { cloudflareWorkersAIProvider } from '@earendil-works/pi-ai/providers/cloudflare-workers-ai';
import type { ModelChoice } from './agent';

const ANSWERED_BY_BINDING = 'answered-in-process-by-the-ai-binding';

const CREDENTIAL_NAMES = new Set(['CLOUDFLARE_API_KEY', 'CLOUDFLARE_ACCOUNT_ID']);

const CHAT_COMPLETIONS = /^https:\/\/api\.cloudflare\.com\/.*\/ai\/v1\/chat\/completions$/;

const bindingAuthContext = {
  env: async (name: string): Promise<string | undefined> =>
    CREDENTIAL_NAMES.has(name) ? ANSWERED_BY_BINDING : undefined,
  fileExists: async (): Promise<boolean> => false,
};

type Bridge = { ai: Ai };

let bridge: Bridge | undefined;

const urlOf = (input: RequestInfo | URL): string =>
  input instanceof Request ? input.url : String(input);

const answer = async (ai: Ai, request: Request): Promise<Response> => {
  try {
    const { model, ...inputs } = (await request.json()) as { model: string } & Record<
      string,
      unknown
    >;
    const result = await ai.run(model as keyof AiModels, inputs as never);

    return result instanceof ReadableStream
      ? new Response(result, { headers: { 'content-type': 'text/event-stream' } })
      : Response.json(result);
  } catch (cause) {
    return Response.json({ error: { message: String(cause) } }, { status: 502 });
  }
};

const routeThroughBinding = (ai: Ai) => {
  if (bridge !== undefined) {
    bridge.ai = ai;

    return;
  }

  const current: Bridge = { ai };
  const original = globalThis.fetch.bind(globalThis);

  bridge = current;
  globalThis.fetch = (input, init) =>
    CHAT_COMPLETIONS.test(urlOf(input))
      ? answer(current.ai, new Request(input, init))
      : original(input, init);
};

export const workersAI = (ai: Ai, modelId: string): ModelChoice => {
  routeThroughBinding(ai);

  return {
    provider: cloudflareWorkersAIProvider(),
    modelId,
    options: { authContext: bindingAuthContext },
  };
};
