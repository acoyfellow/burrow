import { DurableObject } from 'cloudflare:workers';
import type { AgentEvent, HarnessSettings } from '@earendil-works/pi-durable';
import { type Agent, type Children, type Message, type ModelChoice, openAgent } from './agent';
import {
  type Computer,
  type Entry,
  type ExecResult,
  type Snapshot,
  sandboxComputer,
  WORKSPACE,
} from './computer';
import type { Directory, ThreadUpdate } from './directory';
import { type ExecRecord, Ledger, type Origin, type Pair, type Phase } from './ledger';
import { workersAI } from './model';

export type ThreadView = {
  readonly name: string;
  readonly title: string;
  readonly phase: Phase;
  readonly busy: boolean;
  readonly repo: string | null;
  readonly running: boolean;
  readonly origin: Origin;
  readonly messages: Message[];
  readonly pairs: Pair[];
  readonly execs: ExecRecord[];
};

export type CreateOptions = {
  readonly repo?: string | null;
  readonly title?: string;
  readonly createdBy?: string;
  readonly parent?: string;
  readonly forkedFrom?: string;
  readonly base?: string;
  readonly seed?: string;
};

export type Env = {
  readonly THREAD: DurableObjectNamespace<Thread>;
  readonly DIRECTORY: DurableObjectNamespace<Directory>;
  readonly AI: Ai;
  readonly MODEL: string;
  readonly LOCAL_DEV_WITHOUT_ACCESS?: string;
  readonly ACCESS_TEAM_DOMAIN?: string;
  readonly ACCESS_AUD?: string;
};

export type LiveEvent =
  | { readonly type: 'text'; readonly delta: string }
  | {
      readonly type: 'tool_start';
      readonly id: string;
      readonly name: string;
      readonly args: string;
    }
  | { readonly type: 'tool_output'; readonly id: string; readonly append: string }
  | { readonly type: 'tool_end'; readonly id: string; readonly name: string }
  | { readonly type: 'turn_end' }
  | { readonly type: 'compaction'; readonly phase: 'start' | 'end' }
  | {
      readonly type: 'state';
      readonly phase: Phase;
      readonly busy: boolean;
      readonly running: boolean;
    }
  | { readonly type: 'exec'; readonly record: ExecRecord };

const IMAGE = 'computer';

const DIRECTORY = 'all';

const IDLE_CHECK_MS = 1000;

export const childName = (parent: string, index: number) =>
  `${parent.slice(0, 50)}-c${index}`.replace(/-+/g, '-');

const toLive = (event: AgentEvent): LiveEvent[] => {
  switch (event.type) {
    case 'message_update':
      return event.changes.flatMap((change) =>
        change.type === 'text_delta' ? [{ type: 'text' as const, delta: change.delta }] : [],
      );
    case 'tool_execution_start':
      return [
        {
          type: 'tool_start',
          id: event.toolCallId,
          name: event.toolName,
          args: JSON.stringify(event.args),
        },
      ];
    case 'tool_execution_update':
      return event.output !== undefined && 'append' in event.output && event.output.append
        ? [{ type: 'tool_output', id: event.toolCallId, append: event.output.append }]
        : [];
    case 'tool_execution_end':
      return [{ type: 'tool_end', id: event.toolCallId, name: event.toolName }];
    case 'turn_end':
      return [{ type: 'turn_end' }];
    case 'compaction_start':
      return [{ type: 'compaction', phase: 'start' }];
    case 'compaction_end':
      return [{ type: 'compaction', phase: 'end' }];
    default:
      return [];
  }
};

export class Thread extends DurableObject<Env> {
  protected readonly ledger: Ledger;

  private agent: Promise<Agent> | undefined;

  private booting: Promise<Computer> | undefined;

  private readonly listeners = new Set<(event: LiveEvent) => void>();

  private unwatch: (() => void) | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ledger = new Ledger(ctx.storage.sql);
  }

  protected model(): ModelChoice {
    return workersAI(this.env.AI, this.env.MODEL);
  }

  protected settings(): HarnessSettings {
    return {};
  }

  protected computer(): Computer {
    const container = this.ctx.container;

    if (container === undefined) throw new Error('This Durable Object has no container binding');

    return sandboxComputer(container, container.images[IMAGE] ?? IMAGE);
  }

  private get directory() {
    return this.env.DIRECTORY.getByName(DIRECTORY);
  }

  private async publish(update: Omit<ThreadUpdate, 'name'> = {}) {
    const name = this.ledger.name;

    if (name === null) return;

    await this.directory.upsert({
      name,
      phase: this.ledger.phase,
      busy: this.ledger.busy,
      ...update,
    });
  }

  private emit(event: LiveEvent) {
    for (const listener of this.listeners) listener(event);
  }

  private state() {
    this.emit({
      type: 'state',
      phase: this.ledger.phase,
      busy: this.ledger.busy,
      running: this.ctx.container?.running ?? false,
    });
  }

  private awake(): Promise<Computer> {
    this.booting ??= (async () => {
      const box = this.computer();

      if (!box.running()) {
        const from = this.ledger.bootSnapshot();

        await box.boot(from);

        if (from === undefined && this.ledger.repo !== null)
          await box.exec(['git', 'clone', '--depth', '50', this.ledger.repo, WORKSPACE], '/');
        else if (from === undefined)
          await box.exec(
            ['bash', '-c', `mkdir -p ${WORKSPACE} && cd ${WORKSPACE} && git init -q`],
            '/',
          );
      }

      if (this.ledger.phase !== 'awake') {
        this.ledger.phase = 'awake';
        await this.publish();
        this.state();
      }

      return box;
    })().finally(() => {
      this.booting = undefined;
    });

    return this.booting;
  }

  private children(): Children {
    return {
      spawn: async (task) => {
        const parent = this.ledger.name ?? 'thread';
        const index = this.ledger.nextChild();
        const name = childName(parent, index);
        const box = await this.awake();
        const snapshot = await box.snapshot(`burrow-${parent}-child-${index}-${Date.now()}`);
        const child = this.env.THREAD.getByName(name);

        await child.create(name, {
          repo: this.ledger.repo,
          title: task.slice(0, 80),
          createdBy: 'agent',
          parent,
          base: snapshot.id,
        });
        await child.start(`${name}-task`, task);

        return name;
      },
      result: async (name) => {
        const answer = await this.env.THREAD.getByName(name).waitForAnswer();

        return answer === '' ? `${name} finished with no answer` : answer;
      },
    };
  }

  private open(): Promise<Agent> {
    this.agent ??= openAgent(
      this.ctx.storage,
      this.model(),
      () => this.awake(),
      this.ledger,
      this.children(),
      this.settings(),
      () => this.ledger.origin.seed,
    )
      .then(async (agent) => {
        this.unwatch ??= await agent.watch((events) => {
          for (const event of events) for (const live of toLive(event)) this.emit(live);
        });

        return agent;
      })
      .catch((cause) => {
        this.agent = undefined;
        throw cause;
      });

    return this.agent;
  }

  async create(name: string, options: CreateOptions = {}): Promise<ThreadView> {
    const fresh = this.ledger.name === null;

    this.ledger.claim(name);

    if (fresh) {
      this.ledger.repo = options.repo ?? null;
      this.ledger.origin = {
        parent: options.parent ?? null,
        forkedFrom: options.forkedFrom ?? null,
        base: options.base ?? null,
        seed: options.seed ?? null,
      };
      await this.directory.upsert({
        name,
        title: options.title ?? name,
        phase: 'new',
        busy: false,
        repo: options.repo ?? null,
        parent: options.parent ?? null,
        forkedFrom: options.forkedFrom ?? null,
        createdBy: options.createdBy ?? 'api',
      });
    }

    await this.open();

    return this.view();
  }

  async start(requestId: string, input: string): Promise<{ requestId: string }> {
    const agent = await this.open();

    await agent.submit(requestId, input);
    this.ledger.busy = true;
    await this.publish({ title: this.ledger.titled ? undefined : input.slice(0, 80) });
    this.ledger.titled = true;
    this.state();
    await this.ctx.storage.setAlarm(Date.now() + IDLE_CHECK_MS);

    return { requestId };
  }

  async send(requestId: string, input: string): Promise<{ status: string; answer: string }> {
    await this.start(requestId, input);

    return { status: 'done', answer: await this.waitForAnswer() };
  }

  async waitForAnswer(): Promise<string> {
    const agent = await this.open();

    await agent.idle();
    await this.settle();

    return agent.lastAnswer();
  }

  private async settle() {
    if (!this.ledger.busy) return;

    this.ledger.busy = false;
    await this.publish();
    this.state();
  }

  override async alarm(): Promise<void> {
    const agent = await this.open();

    await agent.idle();
    await this.settle();
  }

  async exec(argv: string[]): Promise<ExecResult & { seq: number }> {
    const box = await this.awake();
    const result = await box.exec(argv);
    const record = await this.ledger.logExec(
      argv,
      result.exitCode,
      `${result.stdout}${result.stderr}`,
    );

    this.emit({ type: 'exec', record });

    return { ...result, seq: record.seq };
  }

  async readFile(path: string): Promise<string> {
    return (await this.awake()).readFile(path);
  }

  async list(path: string): Promise<Entry[]> {
    return (await this.awake()).list(path);
  }

  async compact(instructions?: string): Promise<Pair> {
    const agent = await this.open();
    const summaryEntry = await agent.compact(instructions);
    const box = await this.awake();
    const pair: Pair = {
      at: Date.now(),
      reason: 'compaction',
      snapshot: await box.snapshot(`burrow-${this.ledger.name ?? 'thread'}-c-${Date.now()}`),
      summaryEntry,
    };

    this.ledger.record(pair);
    await this.publish();

    return pair;
  }

  async snapshot(): Promise<Snapshot> {
    const box = await this.awake();

    return box.snapshot(`burrow-${this.ledger.name ?? 'thread'}-s-${Date.now()}`);
  }

  async pause(): Promise<Pair | null> {
    const box = this.computer();

    if (!box.running()) {
      this.ledger.phase = 'paused';
      await this.publish();
      this.state();

      return null;
    }

    const pair: Pair = {
      at: Date.now(),
      reason: 'pause',
      snapshot: await box.snapshot(`burrow-${this.ledger.name ?? 'thread'}-p-${Date.now()}`),
      summaryEntry: null,
    };

    this.ledger.record(pair);
    await box.destroy();
    this.ledger.phase = 'paused';
    await this.publish();
    this.state();

    return pair;
  }

  async forkContext(): Promise<string> {
    const messages = await (await this.open()).messages();
    const compaction = messages.filter((m) => m.kind === 'pi.compaction').at(-1);
    const recent = messages
      .filter((m) => m.text !== '' && (m.role === 'user' || m.role === 'assistant'))
      .slice(-12)
      .map((m) => `${m.role}: ${m.text.slice(0, 600)}`)
      .join('\n');

    return [
      `This thread is a fork of "${this.ledger.name}". Its computer starts from that thread's disk.`,
      compaction === undefined ? '' : `Summary of the earlier work:\n${compaction.text}`,
      recent === '' ? '' : `Most recent messages there:\n${recent}`,
    ]
      .filter((part) => part !== '')
      .join('\n\n');
  }

  async view(): Promise<ThreadView> {
    const agent = await this.open();

    return {
      name: this.ledger.name ?? '',
      title: (await this.directory.get(this.ledger.name ?? ''))?.title ?? this.ledger.name ?? '',
      phase: this.ledger.phase,
      busy: this.ledger.busy,
      repo: this.ledger.repo,
      running: this.ctx.container?.running ?? false,
      origin: this.ledger.origin,
      messages: await agent.messages(),
      pairs: this.ledger.pairs(),
      execs: this.ledger.execs(),
    };
  }

  override async fetch(request: Request): Promise<Response> {
    if (!new URL(request.url).pathname.endsWith('/events'))
      return new Response('not found', { status: 404 });

    await this.open();

    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const send = (event: LiveEvent | { type: 'hello' }) =>
      writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)).catch(() => close());
    const listener = (event: LiveEvent) => void send(event);
    const heartbeat = setInterval(
      () => void writer.write(encoder.encode(': ping\n\n')).catch(() => close()),
      15_000,
    );
    const close = () => {
      clearInterval(heartbeat);
      this.listeners.delete(listener);
      void writer.close().catch(() => undefined);
    };

    this.listeners.add(listener);
    request.signal.addEventListener('abort', close);
    void send({ type: 'hello' });
    this.state();

    return new Response(readable, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      },
    });
  }

  async kill(reason: string): Promise<void> {
    this.ctx.abort(reason);
  }
}
