export type ModelInfo = {
  readonly id: string;
  readonly label: string;
  readonly context: number;
  readonly inputPerMtok: number;
  readonly outputPerMtok: number;
  readonly vision: boolean;
  readonly gateway?: true;
};

export const GATEWAY_MODELS: readonly ModelInfo[] = [
  {
    id: 'gateway/claude-fable-5-1',
    label: 'Claude Fable 5.1',
    context: 1000000,
    inputPerMtok: 10,
    outputPerMtok: 50,
    vision: true,
    gateway: true,
  },
  {
    id: 'gateway/gpt-6-astra',
    label: 'GPT-6 Astra',
    context: 1050000,
    inputPerMtok: 10,
    outputPerMtok: 50,
    vision: true,
    gateway: true,
  },
  {
    id: 'gateway/gpt-6.1-sol',
    label: 'GPT-6.1 Sol',
    context: 1050000,
    inputPerMtok: 2,
    outputPerMtok: 10,
    vision: true,
    gateway: true,
  },
  {
    id: 'gateway/claude-opus-5-5',
    label: 'Claude Opus 5.5',
    context: 1000000,
    inputPerMtok: 4,
    outputPerMtok: 20,
    vision: true,
    gateway: true,
  },
  {
    id: 'gateway/gpt-6-luna',
    label: 'GPT-6 Luna',
    context: 1050000,
    inputPerMtok: 0.1,
    outputPerMtok: 0.5,
    vision: true,
    gateway: true,
  },
];

const WORKERS_AI_MODELS: readonly ModelInfo[] = [
  {
    id: '@cf/zai-org/glm-5.3',
    label: 'GLM 5.3',
    context: 1048576,
    inputPerMtok: 1.4,
    outputPerMtok: 4.4,
    vision: false,
  },
  {
    id: '@cf/zai-org/glm-5.3-flash',
    label: 'GLM 5.3 Flash',
    context: 1048576,
    inputPerMtok: 0.15,
    outputPerMtok: 0.5,
    vision: true,
  },
  {
    id: '@cf/moonshotai/kimi-k2.7-code',
    label: 'Kimi K2.7 Code',
    context: 262144,
    inputPerMtok: 0.95,
    outputPerMtok: 4,
    vision: true,
  },
  {
    id: '@cf/deepseek-ai/deepseek-v4-pro-0813',
    label: 'DeepSeek V4 Pro',
    context: 1048576,
    inputPerMtok: 1.32,
    outputPerMtok: 3.96,
    vision: false,
  },
  {
    id: '@cf/qwen/qwen3.8-27b',
    label: 'Qwen 3.8 27B',
    context: 262144,
    inputPerMtok: 0.45,
    outputPerMtok: 3.2,
    vision: true,
  },
  {
    id: '@cf/openai/gpt-oss-120b',
    label: 'gpt-oss 120B',
    context: 128000,
    inputPerMtok: 0.35,
    outputPerMtok: 0.75,
    vision: false,
  },
];

export const MODELS: readonly ModelInfo[] = [...GATEWAY_MODELS, ...WORKERS_AI_MODELS];

export const modelInfo = (id: string): ModelInfo | undefined => MODELS.find((m) => m.id === id);

export const isKnownModel = (id: string): boolean => modelInfo(id) !== undefined;
