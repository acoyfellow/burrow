import { DurableObject } from 'cloudflare:workers';
import type { HarnessSettings } from '@earendil-works/pi-durable';
import { type Agent, type Message, type ModelChoice, openAgent } from './agent';
import { type Computer, containerComputer, type ExecResult, WORKSPACE } from './computer';
import { type ExecRecord, Ledger, type Pair, type Phase } from './ledger';
import { workersAI } from './model';

export type ThreadView = {
  readonly name: string;
  readonly phase: Phase;
  readonly repo: string | null;
  readonly running: boolean;
  readonly messages: Message[];
  readonly pairs: Pair[];
  readonly execs: ExecRecord[];
};

export type Env = {
  readonly THREAD: DurableObjectNamespace<Thread>;
  readonly AI: Ai;
  readonly MODEL: string;
  readonly LOCAL_DEV_WITHOUT_ACCESS?: string;
  readonly ACCESS_TEAM_DOMAIN?: string;
  readonly ACCESS_AUD?: string;
};

const IMAGE = 'computer';

export class Thread extends DurableObject<Env> {
  protected readonly ledger: Ledger;

  private agent: Promise<Agent> | undefined;

  private booting: Promise<Computer> | undefined;

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

    return containerComputer(container, container.images[IMAGE] ?? IMAGE);
  }

  private awake(): Promise<Computer> {
    this.booting ??= (async () => {
      const box = this.computer();

      if (!box.running()) {
        const from = this.ledger.latest()?.snapshot;

        await box.boot(from);

        if (from === undefined && this.ledger.repo !== null)
          await box.exec(['git', 'clone', '--depth', '50', this.ledger.repo, WORKSPACE], '/');
        else if (from === undefined)
          await box.exec(
            ['sh', '-c', `mkdir -p ${WORKSPACE} && cd ${WORKSPACE} && git init -q`],
            '/',
          );
      }

      this.ledger.phase = 'awake';

      return box;
    })().finally(() => {
      this.booting = undefined;
    });

    return this.booting;
  }

  private open(): Promise<Agent> {
    this.agent ??= openAgent(
      this.ctx.storage,
      this.model(),
      () => this.awake(),
      this.ledger,
      this.settings(),
    ).catch((cause) => {
      this.agent = undefined;
      throw cause;
    });

    return this.agent;
  }

  async create(name: string, repo: string | null): Promise<ThreadView> {
    this.ledger.claim(name);
    this.ledger.repo = repo;
    await this.open();

    return this.view();
  }

  async send(requestId: string, input: string): Promise<{ status: string }> {
    const agent = await this.open();

    return { status: await agent.send(requestId, input) };
  }

  async exec(argv: string[]): Promise<ExecResult & { seq: number }> {
    const box = await this.awake();
    const result = await box.exec(argv);
    const record = await this.ledger.logExec(
      argv,
      result.exitCode,
      `${result.stdout}${result.stderr}`,
    );

    return { ...result, seq: record.seq };
  }

  async readFile(path: string): Promise<string> {
    const box = await this.awake();
    const result = await box.exec(['cat', path.startsWith('/') ? path : `${WORKSPACE}/${path}`]);

    if (result.exitCode !== 0) throw new Error(`No such file: ${path}`);

    return result.stdout;
  }

  async compact(instructions?: string): Promise<Pair> {
    const agent = await this.open();
    const summaryEntry = await agent.compact(instructions);
    const box = await this.awake();
    const pair: Pair = {
      at: Date.now(),
      reason: 'compaction',
      snapshot: await box.snapshot(`burrow-${this.ledger.name ?? 'thread'}-c`),
      summaryEntry,
    };

    this.ledger.record(pair);

    return pair;
  }

  async pause(): Promise<Pair | null> {
    const box = this.computer();

    if (!box.running()) {
      this.ledger.phase = 'paused';

      return null;
    }

    const pair: Pair = {
      at: Date.now(),
      reason: 'pause',
      snapshot: await box.snapshot(`burrow-${this.ledger.name ?? 'thread'}-p`),
      summaryEntry: null,
    };

    this.ledger.record(pair);
    await box.destroy();
    this.ledger.phase = 'paused';

    return pair;
  }

  async view(): Promise<ThreadView> {
    const agent = await this.open();

    return {
      name: this.ledger.name ?? '',
      phase: this.ledger.phase,
      repo: this.ledger.repo,
      running: this.ctx.container?.running ?? false,
      messages: await agent.messages(),
      pairs: this.ledger.pairs(),
      execs: this.ledger.execs(),
    };
  }

  async kill(reason: string): Promise<void> {
    this.ctx.abort(reason);
  }
}
