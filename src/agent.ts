import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { Type } from '@earendil-works/pi-ai';
import {
  type CreateModelsOptions,
  createModels,
  type Provider,
} from '@earendil-works/pi-ai/models';
import {
  CompactionEntry,
  type Conversation,
  createRegistry,
  defineExtension,
  defineTool,
  Harness,
  type HarnessSettings,
  section,
} from '@earendil-works/pi-durable';
import { openDurableObjectSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/cloudflare';
import { type Computer, WORKSPACE } from './computer';
import type { Ledger } from './ledger';

export const CONTEXT = BACKGROUND_CONTEXT;

export type ModelChoice = {
  readonly provider: Provider;
  readonly modelId: string;
  readonly options: CreateModelsOptions;
};

export type Message = {
  readonly id: string;
  readonly kind: string;
  readonly role: string;
  readonly text: string;
};

const PROMPT = [
  'You are a coding agent working inside your own Linux computer. The repository is checked out in /workspace.',
  'Use run to execute shell commands there. Use write_file to create or replace a file. Read before you change.',
  'The computer is yours alone; other threads cannot see it. It may pause and resume between turns; its disk persists.',
  'Do the work, check it with a command, then reply in one or two short sentences.',
].join('\n');

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });

const clip = (value: string, max = 12_000) =>
  value.length > max ? `${value.slice(0, max)}\n[... ${value.length - max} more chars]` : value;

const tools = (computer: () => Promise<Computer>, ledger: Ledger) => [
  defineTool({
    name: 'run',
    description: 'Run a shell command in /workspace and return its exit code and output.',
    parameters: Type.Object({ command: Type.String() }),
    replay: 'unsafe',
    executionMode: 'sequential',
    execute: async (args) => {
      const box = await computer();
      const result = await box.exec(['sh', '-lc', args.command]);
      const output = `${result.stdout}${result.stderr === '' ? '' : `\n[stderr]\n${result.stderr}`}`;

      await ledger.logExec(['sh', '-lc', args.command], result.exitCode, output);

      return text(`exit ${result.exitCode}\n${clip(output)}`);
    },
  }),
  defineTool({
    name: 'write_file',
    description: 'Create or replace a whole file, relative to /workspace.',
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    replay: 'safe',
    executionMode: 'sequential',
    execute: async (args) => {
      const box = await computer();
      const target = args.path.startsWith('/') ? args.path : `${WORKSPACE}/${args.path}`;
      const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(args.content)));
      const result = await box.exec([
        'sh',
        '-c',
        'mkdir -p "$(dirname "$1")" && printf %s "$2" | base64 -d > "$1"',
        'write',
        target,
        encoded,
      ]);

      return text(
        result.exitCode === 0
          ? `Wrote ${args.path}`
          : `Could not write ${args.path}: ${result.stderr}`,
      );
    },
  }),
];

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;

  if (!Array.isArray(content)) return '';

  return content
    .map((part) => {
      if (typeof part !== 'object' || part === null) return '';

      const typed = part as { type?: string; text?: string; name?: string; arguments?: unknown };

      if (typed.type === 'text') return typed.text ?? '';

      if (typed.type === 'toolCall') return `→ ${typed.name}(${JSON.stringify(typed.arguments)})`;

      return '';
    })
    .filter((line) => line !== '')
    .join('\n');
};

export type Agent = {
  readonly conversation: Conversation;
  readonly send: (requestId: string, input: string) => Promise<string>;
  readonly compact: (instructions?: string) => Promise<string | null>;
  readonly messages: () => Promise<Message[]>;
  readonly close: () => Promise<void>;
};

export const openAgent = async (
  storage: DurableObjectStorage,
  model: ModelChoice,
  computer: () => Promise<Computer>,
  ledger: Ledger,
  settings: HarnessSettings = {},
): Promise<Agent> => {
  const models = createModels(model.options);

  models.setProvider(model.provider);

  const registry = createRegistry();

  registry.install(
    defineExtension({
      name: 'burrow',
      sections: [section('preamble', () => PROMPT, { tag: false })],
      tools: tools(computer, ledger),
    }),
  );

  const harness = await Harness.open(
    await openDurableObjectSqliteStorage(storage),
    { models, registry, settings },
    CONTEXT,
  );
  const conversation = await harness.root(CONTEXT, {
    agent: { model: { provider: model.provider.id, modelId: model.modelId } },
  });

  harness.resume();

  return {
    conversation,
    send: async (requestId, input) => {
      const submission = await conversation.submit(
        { type: 'input', content: input, requestId },
        CONTEXT,
      );
      const settled = await submission.wait(CONTEXT);

      return settled.status;
    },
    compact: async (instructions) => {
      const task = await conversation.compact(instructions, CONTEXT);
      const settled = await harness.waitForTask(task, CONTEXT);

      if (settled.state.outcome?.status !== 'completed') return null;

      const page = await conversation.entries({}, 50, undefined, CONTEXT);
      const summary = page.items.find((entry) => CompactionEntry.is(entry));

      return summary === undefined ? null : String(summary.id);
    },
    messages: async () => {
      const page = await conversation.entries({}, 500, undefined, CONTEXT);

      return [...page.items].reverse().flatMap((entry) =>
        (entry.model ?? []).map((message) => ({
          id: String(entry.id),
          kind: entry.kind,
          role: message.role,
          text: textOf((message as { content?: unknown }).content),
        })),
      );
    },
    close: () => harness.close(CONTEXT),
  };
};
