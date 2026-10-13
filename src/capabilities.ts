import type { Coil } from './service';
import { isSize, SIZES } from './size';

export type Field = {
  readonly type: 'string' | 'array';
  readonly description: string;
  readonly enum?: readonly string[];
  readonly items?: { readonly type: 'string' };
};

export type Capability = {
  readonly name: string;
  readonly group: 'threads' | 'shell' | 'files' | 'browser' | 'computer' | 'bases';
  readonly summary: string;
  readonly input: Readonly<Record<string, Field>>;
  readonly required: readonly string[];
  readonly returns: string;
  readonly run: (api: Coil, args: Readonly<Record<string, unknown>>) => Promise<unknown>;
};

export class CapabilityInputError extends Error {}

const text = (args: Readonly<Record<string, unknown>>, field: string): string => {
  const value = args[field];

  if (typeof value !== 'string' || value === '')
    throw new CapabilityInputError(`${field} is required`);

  return value;
};

const optional = (args: Readonly<Record<string, unknown>>, field: string): string | undefined => {
  const value = args[field];

  return typeof value === 'string' && value !== '' ? value : undefined;
};

const NAME: Field = { type: 'string', description: 'Thread name, for example "fix-login-3a9c2e"' };

const SIZE: Field = { type: 'string', enum: SIZES, description: 'Container size' };

const sizeOf = (args: Readonly<Record<string, unknown>>) => {
  const value = args.size;

  return isSize(value) ? value : undefined;
};

export const CAPABILITIES: readonly Capability[] = [
  {
    name: 'thread_list',
    group: 'threads',
    summary: 'List your threads, newest activity first.',
    input: {},
    required: [],
    returns: 'Array of { name, title, phase, busy, repo, updatedAt }',
    run: (api) => api.list(),
  },
  {
    name: 'thread_create',
    group: 'threads',
    summary:
      'Create a thread: its own agent and its own Linux computer. repo is an optional git URL.',
    input: {
      name: { type: 'string', description: 'Optional thread name; one is made up if empty' },
      repo: { type: 'string', description: 'Optional git URL to clone into /workspace' },
      title: { type: 'string', description: 'Optional title shown in the sidebar' },
      size: SIZE,
    },
    required: [],
    returns: 'The thread view: { name, title, phase, messages, surfaces, ... }',
    run: (api, args) =>
      api.create({
        name: optional(args, 'name'),
        repo: optional(args, 'repo') ?? null,
        title: optional(args, 'title'),
        createdBy: 'mcp',
        size: sizeOf(args),
      }),
  },
  {
    name: 'thread_send',
    group: 'threads',
    summary:
      'Send a message to the thread agent and wait for the turn to finish. Reuse requestId to retry safely.',
    input: {
      name: NAME,
      text: { type: 'string', description: 'The message' },
      requestId: { type: 'string', description: 'Optional idempotency key' },
    },
    required: ['name', 'text'],
    returns: '{ status, answer }',
    run: (api, args) =>
      api.send(
        text(args, 'name'),
        optional(args, 'requestId') ?? crypto.randomUUID(),
        text(args, 'text'),
      ),
  },
  {
    name: 'thread_status',
    group: 'threads',
    summary: 'Phase, transcript, compaction pairs, turns, and recent commands of a thread.',
    input: { name: NAME },
    required: ['name'],
    returns: 'The thread view',
    run: (api, args) => api.view(text(args, 'name')),
  },
  {
    name: 'thread_fork',
    group: 'threads',
    summary: "Start a new thread from this thread's disk and a summary of its conversation.",
    input: { name: NAME, forkName: { type: 'string', description: 'Optional name for the fork' } },
    required: ['name'],
    returns: 'The new thread view',
    run: (api, args) => api.fork(text(args, 'name'), optional(args, 'forkName'), 'mcp'),
  },
  {
    name: 'thread_exec',
    group: 'shell',
    summary: 'Run a shell command in the thread computer, in /workspace.',
    input: { name: NAME, command: { type: 'string', description: 'Run with bash -lc' } },
    required: ['name', 'command'],
    returns: '{ exitCode, stdout, stderr, seq }',
    run: (api, args) => api.exec(text(args, 'name'), ['bash', '-lc', text(args, 'command')]),
  },
  {
    name: 'thread_read_file',
    group: 'files',
    summary: 'Read a file from the thread computer.',
    input: { name: NAME, path: { type: 'string', description: 'Relative to /workspace' } },
    required: ['name', 'path'],
    returns: 'The file contents as text',
    run: (api, args) => api.read(text(args, 'name'), text(args, 'path')),
  },
  {
    name: 'browser_open',
    group: 'browser',
    summary: "Load a URL in the thread's browser. localhost is the thread computer.",
    input: { name: NAME, url: { type: 'string', description: 'For example localhost:3000' } },
    required: ['name', 'url'],
    returns: 'Page title and URL',
    run: (api, args) => api.browserOpen(text(args, 'name'), text(args, 'url')),
  },
  {
    name: 'browser_snapshot',
    group: 'browser',
    summary: 'List clickable elements as refs (e1, e2, ...) plus the page text.',
    input: { name: NAME },
    required: ['name'],
    returns: 'Text with one line per element: ref, role, label',
    run: (api, args) => api.browserSnapshot(text(args, 'name')),
  },
  {
    name: 'browser_click',
    group: 'browser',
    summary: 'Click an element by its ref from browser_snapshot.',
    input: { name: NAME, ref: { type: 'string', description: 'For example e3' } },
    required: ['name', 'ref'],
    returns: 'What was clicked and the page now open',
    run: (api, args) => api.browserClick(text(args, 'name'), text(args, 'ref')),
  },
  {
    name: 'browser_type',
    group: 'browser',
    summary: 'Type text, optionally into an element ref first.',
    input: {
      name: NAME,
      text: { type: 'string', description: 'Text to type' },
      ref: { type: 'string', description: 'Optional element to click first' },
    },
    required: ['name', 'text'],
    returns: 'How many characters were typed',
    run: (api, args) =>
      api.browserType(text(args, 'name'), text(args, 'text'), optional(args, 'ref')),
  },
  {
    name: 'browser_eval',
    group: 'browser',
    summary: 'Run a JavaScript expression in the page and return the result.',
    input: {
      name: NAME,
      expression: { type: 'string', description: 'For example document.title' },
    },
    required: ['name', 'expression'],
    returns: 'The result as text',
    run: (api, args) => api.browserEval(text(args, 'name'), text(args, 'expression')),
  },
  {
    name: 'thread_compact',
    group: 'computer',
    summary: 'Summarise the conversation and save the disk, as one recorded pair.',
    input: { name: NAME },
    required: ['name'],
    returns: 'The saved pair: { at, reason, snapshot, summaryEntry }',
    run: (api, args) => api.compact(text(args, 'name')),
  },
  {
    name: 'thread_pause',
    group: 'computer',
    summary: 'Save the disk and turn the computer off. The next call resumes it.',
    input: { name: NAME },
    required: ['name'],
    returns: 'The saved pair, or null if it was already off',
    run: (api, args) => api.pause(text(args, 'name')),
  },
  {
    name: 'thread_resize',
    group: 'computer',
    summary:
      'Change the container size. A running computer is paused and restarted at the new size.',
    input: { name: NAME, size: SIZE },
    required: ['name', 'size'],
    returns: '{ size, restarted }',
    run: (api, args) => {
      const size = sizeOf(args);

      if (size === undefined)
        throw new CapabilityInputError(`size must be one of ${SIZES.join(', ')}`);

      return api.resize(text(args, 'name'), size);
    },
  },
  {
    name: 'base_prepare',
    group: 'bases',
    summary:
      'Clone a repo, run a setup command once, and snapshot it. New threads on that repo start warm.',
    input: {
      repo: { type: 'string', description: 'Git URL' },
      setup: { type: 'string', description: 'Optional setup command, for example npm ci' },
    },
    required: ['repo'],
    returns: 'The base record',
    run: (api, args) => api.prepare(text(args, 'repo'), optional(args, 'setup') ?? ''),
  },
];

export const capabilityNamed = (name: string): Capability | undefined =>
  CAPABILITIES.find((capability) => capability.name === name);

export const inputSchema = (capability: Capability) => ({
  type: 'object',
  properties: capability.input,
  required: [...capability.required],
});
