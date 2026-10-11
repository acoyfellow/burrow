import { DurableObject } from 'cloudflare:workers';
import type { AgentEvent, HarnessSettings } from '@earendil-works/pi-durable';
import { modelInfo } from '../shared/models';
import {
  type Agent,
  type BrowserTools,
  type Children,
  type Message,
  type ModelChoice,
  openAgent,
} from './agent';
import { Browser, type Frame, type PageState } from './browser';
import {
  type Computer,
  type Entry,
  type ExecResult,
  type Snapshot,
  sandboxComputer,
  WORKSPACE,
} from './computer';
import type { Directory, ThreadUpdate } from './directory';
import {
  type ExecRecord,
  Ledger,
  type Origin,
  type Pair,
  type Phase,
  type Surface,
} from './ledger';
import { workersAI } from './model';
import { bounded, HUMAN_LIMIT_SECONDS } from './shell';
import { DEFAULT_SIZE, type Size } from './size';
import { bridge, parseSize, SESSION, terminalEnv, tmuxArgs } from './terminal';

export type ThreadView = {
  readonly name: string;
  readonly title: string;
  readonly phase: Phase;
  readonly busy: boolean;
  readonly repo: string | null;
  readonly running: boolean;
  readonly origin: Origin;
  readonly owner: string;
  readonly size: Size;
  readonly messages: Message[];
  readonly pairs: Pair[];
  readonly execs: ExecRecord[];
  readonly surfaces: Surface[];
  readonly model: string;
  readonly usage: Usage;
};

export type Usage = {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cost: number;
  readonly contextTokens: number;
  readonly contextWindow: number;
};

export type CreateOptions = {
  readonly repo?: string | null;
  readonly title?: string;
  readonly createdBy?: string;
  readonly parent?: string;
  readonly forkedFrom?: string;
  readonly base?: string;
  readonly seed?: string;
  readonly owner?: string;
  readonly size?: Size;
};

export type Env = {
  readonly THREAD: DurableObjectNamespace<Thread>;
  readonly DIRECTORY: DurableObjectNamespace<Directory>;
  readonly AI: Ai;
  readonly ASSETS: Fetcher;
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
  | { readonly type: 'exec'; readonly record: ExecRecord }
  | { readonly type: 'surfaces'; readonly surfaces: Surface[] }
  | { readonly type: 'page'; readonly page: PageState };

const IMAGE = 'computer';

const DIRECTORY = 'all';

const IDLE_CHECK_MS = 1000;

const AUTO_PAUSE_AFTER_MS = 9 * 60 * 1000;

const VIEWER_ACK_TIMEOUT_MS = 2000;

export class ThreadBusy extends Error {
  override readonly name = 'ThreadBusy';
}

const KEY_CODES: Record<string, number> = {
  Enter: 13,
  Tab: 9,
  Escape: 27,
  Backspace: 8,
  ArrowUp: 38,
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  Delete: 46,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
};

const MANUAL_KEEP_TOKENS = 200;

const AUTO_KEEP_TOKENS = 20_000;

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

  private browser: Promise<Browser> | undefined;

  private lifecycle: Promise<unknown> = Promise.resolve();

  private viewers = 0;

  private inFlight = 0;

  private pausing: Promise<unknown> | undefined;

  private async using<T>(work: () => Promise<T>): Promise<T> {
    this.inFlight += 1;

    try {
      return await work();
    } finally {
      this.inFlight -= 1;
      await this.touch();
    }
  }

  private watched(socket: WebSocket) {
    this.viewers += 1;

    const done = () => {
      socket.removeEventListener('close', done);
      socket.removeEventListener('error', done);
      this.viewers -= 1;
      void this.touch();
    };

    socket.addEventListener('close', done);
    socket.addEventListener('error', done);
  }

  private serialized<T>(step: () => Promise<T>): Promise<T> {
    const run = this.lifecycle.then(step, step);

    this.lifecycle = run.catch(() => undefined);

    return run;
  }

  private async touch() {
    this.ledger.lastActivity = Date.now();
    await this.ctx.storage.setAlarm(
      Date.now() + (this.ledger.busy ? IDLE_CHECK_MS : AUTO_PAUSE_AFTER_MS),
    );
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ledger = new Ledger(ctx.storage.sql);
  }

  protected model(): ModelChoice {
    return workersAI(this.env.AI, this.currentModel());
  }

  protected settings(): HarnessSettings {
    const ledger = this.ledger;

    return {
      get compaction() {
        return { keepRecentTokens: ledger.compacting ? MANUAL_KEEP_TOKENS : AUTO_KEEP_TOKENS };
      },
    };
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

  private async awake(): Promise<Computer> {
    while (this.pausing !== undefined) await this.pausing.catch(() => undefined);

    return this.awakeInsideLifecycle();
  }

  private awakeInsideLifecycle(): Promise<Computer> {
    this.booting ??= (async () => {
      const box = this.computer();

      if (!box.running()) {
        const from = this.ledger.bootSnapshot();

        if (this.ledger.phase === 'awake') await this.recordLostComputer(from);

        await box.boot(from, this.ledger.size);

        if (from === undefined && this.ledger.repo !== null) {
          const cloned = await box.exec(
            [
              'bash',
              '-c',
              `cd ${WORKSPACE} && git clone --depth 50 "$1" .`,
              'clone',
              this.ledger.repo,
            ],
            '/',
          );

          if (cloned.exitCode !== 0)
            throw new Error(
              `Could not clone ${this.ledger.repo}: ${cloned.stderr.trim().slice(-300)}`,
            );
        } else if (from === undefined)
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

      await this.touch();

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
        const snapshot = await box.snapshot(`coil-${parent}-child-${index}-${Date.now()}`);
        const child = this.env.THREAD.getByName(name);

        await child.create(name, {
          repo: this.ledger.repo,
          title: task.slice(0, 80),
          createdBy: 'agent',
          parent,
          base: snapshot.id,
          owner: await this.ownerEmail(),
          size: this.ledger.size,
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

  private surfacesChanged(next: Surface[]) {
    this.ledger.surfaces = next;
    this.emit({ type: 'surfaces', surfaces: next });
  }

  private ensureBrowserSurface() {
    const current = this.ledger.surfaces;

    if (!current.some((s) => s.kind === 'browser'))
      this.surfacesChanged([...current, { id: 'b1', kind: 'browser', title: 'browser' }]);
  }

  private openBrowser(): Promise<Browser> {
    const existing = this.browser;

    if (existing !== undefined)
      return existing.then((b) => {
        if (b.alive) return b;

        this.browser = undefined;

        return this.openBrowser();
      });

    this.browser = (async () => {
      await this.awake();

      const container = this.ctx.container;

      if (container === undefined) throw new Error('This Durable Object has no container binding');

      const browser = await Browser.launch(container);

      browser.pages.add((page) => this.emit({ type: 'page', page }));
      this.ensureBrowserSurface();

      return browser;
    })().catch((cause) => {
      this.browser = undefined;
      throw cause;
    });

    return this.browser;
  }

  private browserTools(): BrowserTools {
    const page = (p: PageState) => `${p.title === '' ? '(no title)' : p.title}\n${p.url}`;

    return {
      open: async (url) => page(await (await this.openBrowser()).open(url)),
      snapshot: async () => (await this.openBrowser()).snapshot(),
      click: async (ref) => {
        const browser = await this.openBrowser();

        await browser.clickRef(ref);
        await new Promise((r) => setTimeout(r, 400));

        return `clicked ${ref}; now at ${page(browser.page)}`;
      },
      type: async (text, ref) => {
        const browser = await this.openBrowser();

        if (ref !== undefined) await browser.clickRef(ref);
        await browser.type(text);

        return `typed ${text.length} chars`;
      },
      key: async (key) => {
        const browser = await this.openBrowser();

        await browser.key({ type: 'keyDown', key, code: key, keyCode: KEY_CODES[key] });
        await browser.key({ type: 'keyUp', key, code: key, keyCode: KEY_CODES[key] });
        await new Promise((r) => setTimeout(r, 300));

        return `pressed ${key}; now at ${page(browser.page)}`;
      },
      evaluate: async (expression) => (await this.openBrowser()).evaluate(expression),
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
      this.browserTools(),
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
      this.ledger.owner = options.owner ?? '';
      this.ledger.size = options.size ?? DEFAULT_SIZE;
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
        owner: options.owner ?? '',
      });
    }

    await this.open();

    return this.view();
  }

  async start(requestId: string, input: string): Promise<{ requestId: string }> {
    while (this.pausing !== undefined) await this.pausing.catch(() => undefined);

    this.inFlight += 1;

    try {
      const agent = await this.open();

      await agent.submit(requestId, input);
      this.ledger.busy = true;
    } finally {
      this.inFlight -= 1;
    }

    this.ledger.lastActivity = Date.now();
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
    await this.publish({ spend: (await this.usage()).cost });
    this.state();
  }

  private async recordLostComputer(from: Snapshot | undefined) {
    const restored =
      from === undefined
        ? 'an empty disk'
        : `the disk saved at ${new Date(this.ledger.latest()?.at ?? 0).toISOString()}`;
    const record = await this.ledger.logExec(
      ['coil', 'computer-lost'],
      1,
      `The computer stopped without being paused. It was restarted from ${restored}; changes made after that are gone.`,
      'agent',
    );

    this.emit({ type: 'exec', record });
  }

  override async alarm(): Promise<void> {
    if (this.ledger.busy) {
      const agent = await this.open();
      const finished = await Promise.race([
        agent.idle().then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 20_000)),
      ]);

      if (!finished) {
        await this.ctx.storage.setAlarm(Date.now() + IDLE_CHECK_MS);

        return;
      }

      await this.settle();
      await this.touch();

      return;
    }

    const idleFor = Date.now() - this.ledger.lastActivity;

    if (idleFor < AUTO_PAUSE_AFTER_MS || this.viewers > 0 || this.inFlight > 0) {
      await this.ctx.storage.setAlarm(
        Date.now() + Math.max(IDLE_CHECK_MS, AUTO_PAUSE_AFTER_MS - idleFor),
      );

      return;
    }

    if (!this.computer().running()) return;

    try {
      await this.pause();
    } catch (cause) {
      if (!(cause instanceof ThreadBusy)) throw cause;

      await this.ctx.storage.setAlarm(Date.now() + AUTO_PAUSE_AFTER_MS);
    }
  }

  exec(argv: string[]): Promise<ExecResult & { seq: number }> {
    return this.using(() => this.execNow(argv));
  }

  private async execNow(argv: string[]): Promise<ExecResult & { seq: number }> {
    const box = await this.awake();
    const result = await box.exec(bounded(argv, HUMAN_LIMIT_SECONDS));
    const record = await this.ledger.logExec(
      argv,
      result.exitCode,
      `${result.stdout}${result.stderr}`,
    );

    this.emit({ type: 'exec', record });

    return { ...result, seq: record.seq };
  }

  readFile(path: string): Promise<string> {
    return this.using(async () => (await this.awake()).readFile(path));
  }

  list(path: string): Promise<Entry[]> {
    return this.using(async () => (await this.awake()).list(path));
  }

  compact(instructions?: string): Promise<Pair> {
    if (this.ledger.busy)
      return Promise.reject(new ThreadBusy('The agent is working. Compact after the turn ends.'));

    return this.using(() => this.serialized(() => this.compactNow(instructions)));
  }

  private async compactNow(instructions?: string): Promise<Pair> {
    const agent = await this.open();

    this.ledger.compacting = true;

    const summaryEntry = await agent.compact(instructions).finally(() => {
      this.ledger.compacting = false;
    });
    const box = await this.awakeInsideLifecycle();
    const pair: Pair = {
      at: Date.now(),
      reason: 'compaction',
      snapshot: await box.snapshot(`coil-${this.ledger.name ?? 'thread'}-c-${Date.now()}`),
      summaryEntry,
    };

    this.ledger.record(pair);
    await this.publish();

    return pair;
  }

  snapshot(): Promise<Snapshot> {
    return this.serialized(async () => {
      const box = await this.awakeInsideLifecycle();

      return box.snapshot(`coil-${this.ledger.name ?? 'thread'}-s-${Date.now()}`);
    });
  }

  pause(): Promise<Pair | null> {
    const run = this.serialized(() => this.pauseNow());
    const settled = run.finally(() => {
      if (this.pausing === settled) this.pausing = undefined;
    });

    this.pausing = settled;

    return settled;
  }

  private async pauseNow(): Promise<Pair | null> {
    if (this.booting !== undefined) await this.booting.catch(() => undefined);

    if (this.ledger.busy) throw new ThreadBusy('The agent is working. Pause after the turn ends.');

    if (this.inFlight > 0) throw new ThreadBusy('A command is running. Pause after it ends.');

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
      snapshot: await box.snapshot(`coil-${this.ledger.name ?? 'thread'}-p-${Date.now()}`),
      summaryEntry: null,
    };

    this.ledger.record(pair);
    void this.browser?.then((b) => b.close()).catch(() => undefined);
    this.browser = undefined;
    await box.destroy();
    await this.ctx.storage.deleteAlarm();
    this.ledger.phase = 'paused';
    await this.publish();
    this.state();

    return pair;
  }

  private async ownerEmail(): Promise<string> {
    if (this.ledger.owner !== '') return this.ledger.owner;

    const listed = (await this.directory.get(this.ledger.name ?? ''))?.owner ?? '';

    if (listed !== '') this.ledger.owner = listed;

    return listed;
  }

  async resize(next: Size): Promise<{ size: Size; restarted: boolean }> {
    if (next === this.ledger.size) return { size: next, restarted: false };

    if (this.ledger.busy) throw new ThreadBusy('The agent is working. Resize after the turn ends.');

    const wasRunning = this.computer().running();

    if (wasRunning) await this.pause();

    this.ledger.size = next;
    await this.publish();

    if (wasRunning) await this.awake();

    return { size: next, restarted: wasRunning };
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

  private currentModel(): string {
    return this.ledger.model ?? this.env.MODEL;
  }

  async usage(): Promise<Usage> {
    const agent = await this.open();
    const totals = await agent.usage();
    const contextTokens = await agent.contextTokens();
    const model = this.currentModel();

    return {
      ...totals,
      contextTokens,
      contextWindow: modelInfo(model)?.context ?? 0,
    };
  }

  async stop(): Promise<null> {
    const agent = await this.open();

    await agent.stop();
    await this.settle();

    return null;
  }

  async setModel(id: string): Promise<Usage> {
    if (modelInfo(id) === undefined) throw new Error(`Invalid model ${id}`);

    if (this.ledger.busy)
      throw new ThreadBusy('The agent is working. Change the model after the turn ends.');

    const agent = await this.open();

    await agent.setModel(id);
    this.ledger.model = id;
    await this.publish({ model: id });

    return this.usage();
  }

  async destroyAll(): Promise<null> {
    await this.ctx.storage.deleteAlarm();
    void this.browser?.then((b) => b.close()).catch(() => undefined);
    this.browser = undefined;
    if (this.ctx.container?.running) await this.computer().destroy();
    await this.agent?.then((a) => a.close()).catch(() => undefined);
    this.agent = undefined;
    await this.ctx.storage.deleteAll();

    return null;
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
      owner: await this.ownerEmail(),
      size: this.ledger.size,
      messages: await agent.messages(),
      pairs: this.ledger.pairs(),
      execs: this.ledger.execs(),
      surfaces: this.ledger.surfaces,
      model: this.currentModel(),
      usage: await this.usage(),
    };
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/terminal')) return this.terminalSocket(url);

    if (url.pathname.endsWith('/browser')) return this.browserSocket();

    if (!url.pathname.endsWith('/events')) return new Response('not found', { status: 404 });

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

  async addTerminal(): Promise<Surface[]> {
    const current = this.ledger.surfaces;
    let n = 1;

    while (current.some((s) => s.id === `t${n}`)) n += 1;

    this.surfacesChanged([...current, { id: `t${n}`, kind: 'terminal', title: `shell ${n}` }]);

    return this.ledger.surfaces;
  }

  async addBrowser(): Promise<Surface[]> {
    this.ensureBrowserSurface();

    return this.ledger.surfaces;
  }

  async closeSurface(id: string): Promise<Surface[]> {
    const surface = this.ledger.surfaces.find((s) => s.id === id);

    if (surface === undefined) return this.ledger.surfaces;

    if (surface.kind === 'terminal' && this.ctx.container?.running && this.pausing === undefined)
      await this.using(() =>
        this.computer()
          .exec(['tmux', 'kill-session', '-t', `=${id}`])
          .catch(() => undefined),
      );

    if (surface.kind === 'browser') {
      void this.browser?.then((b) => b.close()).catch(() => undefined);
      this.browser = undefined;
    }

    this.surfacesChanged(this.ledger.surfaces.filter((s) => s.id !== id));

    return this.ledger.surfaces;
  }

  private async terminalSocket(url: URL): Promise<Response> {
    const id = url.searchParams.get('id') ?? 't1';
    const size = parseSize(url.searchParams.get('cols') ?? 100, url.searchParams.get('rows') ?? 30);

    if (!SESSION.test(id) || size === null) return new Response('bad terminal', { status: 400 });

    if (!this.ledger.surfaces.some((s) => s.id === id && s.kind === 'terminal'))
      return new Response('unknown terminal', { status: 404 });

    const container = this.ctx.container;

    if (container === undefined) return new Response('no container', { status: 500 });

    const abort = new AbortController();
    const process = await this.using(async () => {
      await this.awake();

      return container.exec(tmuxArgs(id), {
        pty: size,
        env: terminalEnv(),
        cwd: WORKSPACE,
        signal: abort.signal,
      });
    });
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];

    server.binaryType = 'arraybuffer';
    server.accept();
    this.watched(server);
    bridge(server, process, abort);

    return new Response(null, { status: 101, webSocket: client });
  }

  private async browserSocket(): Promise<Response> {
    const browser = await this.openBrowser();
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    let waiting: Frame | null = null;
    let inFlight = false;
    let stuck: ReturnType<typeof setTimeout> | undefined;
    const viewer = {};
    const giveUpOnViewer = () => {
      inFlight = false;
      waiting = null;
      browser.viewerReady(viewer);
    };
    const deliver = (f: Frame) => {
      inFlight = true;
      browser.viewerBusy(viewer);
      clearTimeout(stuck);
      stuck = setTimeout(giveUpOnViewer, VIEWER_ACK_TIMEOUT_MS);

      try {
        server.send(f.bytes);
      } catch {
        stop();
      }
    };
    const frameSeen = () => {
      clearTimeout(stuck);
      inFlight = false;

      if (waiting !== null) {
        const next = waiting;

        waiting = null;
        deliver(next);

        return;
      }

      browser.viewerReady(viewer);
    };
    const frame = (f: Frame) => {
      if (inFlight) {
        waiting = f;

        return;
      }

      try {
        deliver(f);
      } catch {
        stop();
      }
    };
    const page = (p: PageState) => {
      try {
        server.send(JSON.stringify({ page: p }));
      } catch {
        stop();
      }
    };
    const browserDied = () => server.close(1011, 'browser exited');
    const stop = () => {
      browser.frames.delete(frame);
      browser.pages.delete(page);
      clearTimeout(stuck);
      browser.viewerReady(viewer);
      browser.closedListeners.delete(browserDied);

      if (browser.frames.size === 0) void browser.cast(false).catch(() => undefined);
    };

    server.accept();
    this.watched(server);
    browser.closedListeners.add(browserDied);
    server.send(JSON.stringify({ page: browser.page, viewport: browser.viewport }));

    if (browser.last !== null) frame(browser.last);

    browser.frames.add(frame);
    browser.pages.add(page);
    await browser.cast(true);
    await browser.paintNow().catch(() => undefined);

    server.addEventListener('message', (event) => {
      void (async () => {
        const input = JSON.parse(String(event.data)) as {
          seen?: true;
          click?: [number, number];
          scroll?: [number, number, number, number];
          key?: {
            type: 'keyDown' | 'keyUp' | 'char';
            key?: string;
            code?: string;
            text?: string;
            keyCode?: number;
            modifiers?: number;
          };
          text?: string;
          open?: string;
          back?: true;
          reload?: true;
          viewport?: [number, number];
        };

        if (input.seen) frameSeen();
        else if (input.click) await browser.click(input.click[0], input.click[1]);
        else if (input.scroll) await browser.scroll(...input.scroll);
        else if (input.key) await browser.key(input.key);
        else if (input.text !== undefined) await browser.type(input.text);
        else if (input.open) await browser.open(input.open);
        else if (input.back) await browser.back();
        else if (input.reload) await browser.reload();
        else if (input.viewport) {
          const viewport = await browser.resize(input.viewport[0], input.viewport[1]);

          server.send(JSON.stringify({ viewport }));
        }
      })().catch((cause) => {
        try {
          server.send(
            JSON.stringify({ error: String(cause instanceof Error ? cause.message : cause) }),
          );
        } catch {
          stop();
        }
      });
    });
    server.addEventListener('close', stop);
    server.addEventListener('error', stop);

    return new Response(null, { status: 101, webSocket: client });
  }

  async kill(reason: string): Promise<void> {
    this.ctx.abort(reason);
  }
}
