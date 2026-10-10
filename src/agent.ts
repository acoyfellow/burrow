import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { Type } from '@earendil-works/pi-ai';
import {
  type CreateModelsOptions,
  createModels,
  type Provider,
} from '@earendil-works/pi-ai/models';
import {
  type AgentEvent,
  CompactionEntry,
  type Conversation,
  createRegistry,
  defineExtension,
  defineTool,
  Harness,
  type HarnessSettings,
  section,
  watchEvents,
} from '@earendil-works/pi-durable';
import { openDurableObjectSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/cloudflare';
import type { Computer } from './computer';
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
  readonly tool?: { readonly name: string; readonly args: string };
};

export type Children = {
  readonly spawn: (task: string) => Promise<string>;
  readonly result: (name: string) => Promise<string>;
};

const PROMPT = [
  'You are a coding agent working inside your own Linux computer. The repository is in /workspace.',
  'Tools: run executes a shell command there; write_file creates or replaces a file; read_file reads one.',
  'The shell has bash, coreutils, busybox (grep, sed, awk, wget, tar), and a patched git that refuses force pushes.',
  'There is no python or node. The computer is yours alone and its disk persists across pauses.',
  'For a separate side task, start_child gives it to a new thread with its own computer; wait_child returns its answer.',
  'Do the work, check it with a command, then reply in one or two short sentences.',
].join('\n');

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });

const clip = (value: string, max = 12_000) =>
  value.length > max ? `${value.slice(0, max)}\n[... ${value.length - max} more chars]` : value;

const tools = (computer: () => Promise<Computer>, ledger: Ledger, children: Children) => [
  defineTool({
    name: 'run',
    description: 'Run a shell command in /workspace and return its exit code and output.',
    parameters: Type.Object({ command: Type.String() }),
    replay: 'unsafe',
    executionMode: 'sequential',
    execute: async (args) => {
      const box = await computer();
      const result = await box.exec(['bash', '-lc', args.command]);
      const output = `${result.stdout}${result.stderr === '' ? '' : `\n[stderr]\n${result.stderr}`}`;

      await ledger.logExec(['bash', '-lc', args.command], result.exitCode, output, 'agent');

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

      await box.writeFile(args.path, args.content);

      return text(`Wrote ${args.path} (${args.content.length} chars)`);
    },
  }),
  defineTool({
    name: 'read_file',
    description: 'Read a file, relative to /workspace.',
    parameters: Type.Object({ path: Type.String() }),
    replay: 'safe',
    executionMode: 'parallel',
    execute: async (args) => text(clip(await (await computer()).readFile(args.path))),
  }),
  defineTool({
    name: 'start_child',
    description:
      'Start a child thread with its own computer, cloned from this one, to do a side task. Returns the child name.',
    parameters: Type.Object({ task: Type.String() }),
    replay: 'unsafe',
    executionMode: 'sequential',
    execute: async (args) => text(`started child ${await children.spawn(args.task)}`),
  }),
  defineTool({
    name: 'wait_child',
    description: 'Wait for a child thread to finish and return its final answer.',
    parameters: Type.Object({ name: Type.String() }),
    replay: 'safe',
    executionMode: 'parallel',
    execute: async (args) => text(await children.result(args.name)),
  }),
];

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;

  if (!Array.isArray(content)) return '';

  return content
    .map((part) =>
      typeof part === 'object' && part !== null && (part as { type?: string }).type === 'text'
        ? ((part as { text?: string }).text ?? '')
        : '',
    )
    .filter((line) => line !== '')
    .join('\n');
};

const toolCallsOf = (content: unknown) =>
  Array.isArray(content)
    ? content.flatMap((part) => {
        const typed = part as { type?: string; name?: string; arguments?: unknown };

        return typed.type === 'toolCall'
          ? [{ name: typed.name ?? '?', args: JSON.stringify(typed.arguments ?? {}) }]
          : [];
      })
    : [];

export type Agent = {
  readonly conversation: Conversation;
  readonly send: (requestId: string, input: string) => Promise<string>;
  readonly submit: (requestId: string, input: string) => Promise<void>;
  readonly idle: () => Promise<void>;
  readonly compact: (instructions?: string) => Promise<string | null>;
  readonly messages: () => Promise<Message[]>;
  readonly lastAnswer: () => Promise<string>;
  readonly watch: (listener: (events: readonly AgentEvent[]) => void) => Promise<() => void>;
  readonly close: () => Promise<void>;
};

export const openAgent = async (
  storage: DurableObjectStorage,
  model: ModelChoice,
  computer: () => Promise<Computer>,
  ledger: Ledger,
  children: Children,
  settings: HarnessSettings = {},
  seed: () => string | null = () => null,
): Promise<Agent> => {
  const models = createModels(model.options);

  models.setProvider(model.provider);

  const registry = createRegistry();

  registry.install(
    defineExtension({
      name: 'burrow',
      sections: [
        section(
          'preamble',
          () => {
            const carried = seed();

            return carried === null ? PROMPT : `${PROMPT}\n\n${carried}`;
          },
          { tag: false },
        ),
      ],
      tools: tools(computer, ledger, children),
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

  const messages = async (): Promise<Message[]> => {
    const page = await conversation.entries({}, 500, undefined, CONTEXT);

    return [...page.items].reverse().flatMap((entry) =>
      (entry.model ?? []).flatMap((message) => {
        const content = (message as { content?: unknown }).content;
        const base = { id: String(entry.id), kind: entry.kind, role: message.role };
        const calls = message.role === 'assistant' ? toolCallsOf(content) : [];
        const said = textOf(content);

        return [
          ...(said === '' && calls.length > 0 ? [] : [{ ...base, text: said }]),
          ...calls.map((tool) => ({ ...base, role: 'tool', text: '', tool })),
        ];
      }),
    );
  };

  return {
    conversation,
    send: async (requestId, input) => {
      const submission = await conversation.submit(
        { type: 'input', content: input, requestId },
        CONTEXT,
      );

      return (await submission.wait(CONTEXT)).status;
    },
    submit: async (requestId, input) => {
      await conversation.submit({ type: 'input', content: input, requestId }, CONTEXT);
    },
    idle: () => conversation.waitForIdle(CONTEXT),
    compact: async (instructions) => {
      const task = await conversation.compact(instructions, CONTEXT);
      const settled = await harness.waitForTask(task, CONTEXT);

      if (settled.state.outcome?.status !== 'completed') return null;

      const page = await conversation.entries({}, 50, undefined, CONTEXT);
      const summary = page.items.find((entry) => CompactionEntry.is(entry));

      return summary === undefined ? null : String(summary.id);
    },
    messages,
    lastAnswer: async () =>
      (await messages()).filter((m) => m.role === 'assistant' && m.text !== '').at(-1)?.text ?? '',
    watch: async (listener) => {
      const stream = await watchEvents(harness, conversation.id, CONTEXT);

      stream.start(async (events) => listener(events));

      return () => void stream.stop();
    },
    close: () => harness.close(CONTEXT),
  };
};
