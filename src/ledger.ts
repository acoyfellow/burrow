import type { Snapshot } from './computer';

export type Phase = 'new' | 'awake' | 'paused';

export type Pair = {
  readonly at: number;
  readonly reason: 'pause' | 'compaction';
  readonly snapshot: Snapshot;
  readonly summaryEntry: string | null;
};

export type ExecRecord = {
  readonly seq: number;
  readonly at: number;
  readonly argv: readonly string[];
  readonly exitCode: number;
  readonly bytes: number;
  readonly sha256: string;
  readonly output: string;
  readonly by: 'agent' | 'human';
};

export type Origin = {
  readonly parent: string | null;
  readonly forkedFrom: string | null;
  readonly base: string | null;
  readonly seed: string | null;
};

const OUTPUT_KEPT = 16 * 1024;

const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

export const sha256 = async (text: string) =>
  hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

export type Surface = {
  readonly id: string;
  readonly kind: 'terminal' | 'browser';
  readonly title: string;
};

export class Ledger {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(`CREATE TABLE IF NOT EXISTS coil_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    sql.exec(
      `CREATE TABLE IF NOT EXISTS coil_pairs (at INTEGER NOT NULL, reason TEXT NOT NULL, snapshot_id TEXT NOT NULL, snapshot_size INTEGER NOT NULL, summary_entry TEXT)`,
    );
    sql.exec(
      `CREATE TABLE IF NOT EXISTS coil_exec (seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, argv TEXT NOT NULL, exit_code INTEGER NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL, output TEXT NOT NULL, by TEXT NOT NULL DEFAULT 'human')`,
    );
  }

  private get(key: string): string | null {
    const row = this.sql
      .exec<{ value: string }>('SELECT value FROM coil_kv WHERE key = ?', key)
      .toArray()[0];

    return row === undefined ? null : row.value;
  }

  private put(key: string, value: string) {
    this.sql.exec(
      'INSERT INTO coil_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }

  get phase(): Phase {
    const value = this.get('phase');

    return value === 'awake' || value === 'paused' ? value : 'new';
  }

  set phase(next: Phase) {
    this.put('phase', next);
  }

  get name(): string | null {
    return this.get('name');
  }

  claim(name: string) {
    if (this.name === null) this.put('name', name);
  }

  get repo(): string | null {
    return this.get('repo');
  }

  set repo(url: string | null) {
    if (url !== null) this.put('repo', url);
  }

  get origin(): Origin {
    return {
      parent: this.get('parent'),
      forkedFrom: this.get('forkedFrom'),
      base: this.get('base'),
      seed: this.get('seed'),
    };
  }

  set origin(next: Partial<Origin>) {
    for (const [key, value] of Object.entries(next))
      if (typeof value === 'string') this.put(key, value);
  }

  get surfaces(): Surface[] {
    const raw = this.get('surfaces');

    return raw === null
      ? [{ id: 't1', kind: 'terminal', title: 'shell' }]
      : (JSON.parse(raw) as Surface[]);
  }

  set surfaces(next: Surface[]) {
    this.put('surfaces', JSON.stringify(next));
  }

  get busy(): boolean {
    return this.get('busy') === '1';
  }

  set busy(next: boolean) {
    this.put('busy', next ? '1' : '0');
  }

  get compacting(): boolean {
    return this.get('compacting') === '1';
  }

  set compacting(next: boolean) {
    this.put('compacting', next ? '1' : '0');
  }

  get titled(): boolean {
    return this.get('titled') === '1';
  }

  set titled(next: boolean) {
    this.put('titled', next ? '1' : '0');
  }

  nextChild(): number {
    const next = Number(this.get('children') ?? '0') + 1;

    this.put('children', String(next));

    return next;
  }

  bootSnapshot(): Snapshot | undefined {
    const latest = this.latest()?.snapshot;

    if (latest !== undefined) return latest;

    const base = this.get('base');

    return base === null ? undefined : { id: base, size: 0 };
  }

  record(pair: Pair) {
    this.sql.exec(
      'INSERT INTO coil_pairs (at, reason, snapshot_id, snapshot_size, summary_entry) VALUES (?, ?, ?, ?, ?)',
      pair.at,
      pair.reason,
      pair.snapshot.id,
      pair.snapshot.size,
      pair.summaryEntry,
    );
  }

  pairs(): Pair[] {
    return this.sql
      .exec<{
        at: number;
        reason: string;
        snapshot_id: string;
        snapshot_size: number;
        summary_entry: string | null;
      }>(
        'SELECT at, reason, snapshot_id, snapshot_size, summary_entry FROM coil_pairs ORDER BY at ASC, rowid ASC',
      )
      .toArray()
      .map((row) => ({
        at: row.at,
        reason: row.reason === 'compaction' ? 'compaction' : 'pause',
        snapshot: { id: row.snapshot_id, size: row.snapshot_size },
        summaryEntry: row.summary_entry,
      }));
  }

  latest(): Pair | undefined {
    return this.pairs().at(-1);
  }

  async logExec(
    argv: readonly string[],
    exitCode: number,
    output: string,
    by: 'agent' | 'human' = 'human',
  ): Promise<ExecRecord> {
    const at = Date.now();
    const bytes = new TextEncoder().encode(output).length;
    const hash = await sha256(output);
    const kept =
      output.length > OUTPUT_KEPT
        ? `${output.slice(0, OUTPUT_KEPT)}\n[truncated: ${bytes} bytes, sha256 ${hash}]`
        : output;
    const row = this.sql
      .exec<{ seq: number }>(
        'INSERT INTO coil_exec (at, argv, exit_code, bytes, sha256, output, by) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING seq',
        at,
        JSON.stringify(argv),
        exitCode,
        bytes,
        hash,
        kept,
        by,
      )
      .one();

    return { seq: row.seq, at, argv, exitCode, bytes, sha256: hash, output: kept, by };
  }

  execs(limit = 50): ExecRecord[] {
    return this.sql
      .exec<{
        seq: number;
        at: number;
        argv: string;
        exit_code: number;
        bytes: number;
        sha256: string;
        output: string;
        by: string;
      }>(
        'SELECT seq, at, argv, exit_code, bytes, sha256, output, by FROM coil_exec ORDER BY seq DESC LIMIT ?',
        limit,
      )
      .toArray()
      .reverse()
      .map((row) => ({
        seq: row.seq,
        at: row.at,
        argv: JSON.parse(row.argv),
        exitCode: row.exit_code,
        bytes: row.bytes,
        sha256: row.sha256,
        output: row.output,
        by: row.by === 'agent' ? 'agent' : 'human',
      }));
  }
}
