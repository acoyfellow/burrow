import { DurableObject } from 'cloudflare:workers';

export type ThreadSummary = {
  readonly name: string;
  readonly title: string;
  readonly phase: string;
  readonly busy: boolean;
  readonly repo: string | null;
  readonly parent: string | null;
  readonly forkedFrom: string | null;
  readonly createdBy: string;
  readonly owner: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly archived: boolean;
  readonly model: string;
  readonly spend: number;
  readonly looping: boolean;
};

export type ThreadUpdate = Partial<Omit<ThreadSummary, 'name' | 'createdAt'>> & {
  readonly name: string;
};

type Row = {
  name: string;
  title: string;
  phase: string;
  busy: number;
  repo: string | null;
  parent: string | null;
  forked_from: string | null;
  created_by: string;
  owner: string;
  created_at: number;
  updated_at: number;
  archived: number;
  model: string;
  spend: number;
  looping: number;
};

const fromRow = (row: Row): ThreadSummary => ({
  name: row.name,
  title: row.title,
  phase: row.phase,
  busy: row.busy === 1,
  repo: row.repo,
  parent: row.parent,
  forkedFrom: row.forked_from,
  createdBy: row.created_by,
  owner: row.owner,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  archived: row.archived === 1,
  model: row.model,
  spend: row.spend,
  looping: row.looping === 1,
});

export const TURN_RESERVE = 0.5;

export class Directory extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS threads (name TEXT PRIMARY KEY, title TEXT NOT NULL, phase TEXT NOT NULL, busy INTEGER NOT NULL DEFAULT 0, repo TEXT, parent TEXT, forked_from TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
    );
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS shares (token TEXT PRIMARY KEY, name TEXT NOT NULL, owner TEXT NOT NULL, created_at INTEGER NOT NULL)`,
    );
    this.ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS bases (repo TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL, thread TEXT NOT NULL, setup TEXT NOT NULL, at INTEGER NOT NULL)`,
    );
    this.migrate();
  }

  private migrate() {
    const columns = this.ctx.storage.sql
      .exec<{ name: string }>('PRAGMA table_info(threads)')
      .toArray()
      .map((c) => c.name);

    if (!columns.includes('owner'))
      this.ctx.storage.sql.exec(`ALTER TABLE threads ADD COLUMN owner TEXT NOT NULL DEFAULT ''`);
    if (!columns.includes('archived'))
      this.ctx.storage.sql.exec(
        `ALTER TABLE threads ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`,
      );
    if (!columns.includes('model'))
      this.ctx.storage.sql.exec(`ALTER TABLE threads ADD COLUMN model TEXT NOT NULL DEFAULT ''`);
    if (!columns.includes('looping'))
      this.ctx.storage.sql.exec(
        `ALTER TABLE threads ADD COLUMN looping INTEGER NOT NULL DEFAULT 0`,
      );
    if (!columns.includes('spend'))
      this.ctx.storage.sql.exec(`ALTER TABLE threads ADD COLUMN spend REAL NOT NULL DEFAULT 0`);
  }

  upsert(update: ThreadUpdate): void {
    const now = Date.now();
    const current = this.get(update.name);
    const next = {
      title: update.title ?? current?.title ?? update.name,
      phase: update.phase ?? current?.phase ?? 'new',
      busy: (update.busy ?? current?.busy ?? false) ? 1 : 0,
      repo: update.repo ?? current?.repo ?? null,
      parent: update.parent ?? current?.parent ?? null,
      forkedFrom: update.forkedFrom ?? current?.forkedFrom ?? null,
      createdBy: update.createdBy ?? current?.createdBy ?? 'api',
      owner: current?.owner || update.owner || '',
      archived: (update.archived ?? current?.archived ?? false) ? 1 : 0,
      model: update.model ?? current?.model ?? '',
      spend: update.spend ?? current?.spend ?? 0,
      looping: (update.looping ?? current?.looping ?? false) ? 1 : 0,
    };

    this.ctx.storage.sql.exec(
      `INSERT INTO threads (name, title, phase, busy, repo, parent, forked_from, created_by, owner, created_at, updated_at, archived, model, spend, looping) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET title = excluded.title, phase = excluded.phase, busy = excluded.busy, repo = excluded.repo, parent = excluded.parent, forked_from = excluded.forked_from, owner = excluded.owner, updated_at = excluded.updated_at, archived = excluded.archived, model = excluded.model, spend = excluded.spend, looping = excluded.looping`,
      update.name,
      next.title,
      next.phase,
      next.busy,
      next.repo,
      next.parent,
      next.forkedFrom,
      next.createdBy,
      next.owner,
      current?.createdAt ?? now,
      now,
      next.archived,
      next.model,
      next.spend,
      next.looping,
    );
  }

  loopingFor(owner: string): string[] {
    return this.ctx.storage.sql
      .exec<{ name: string }>('SELECT name FROM threads WHERE owner = ? AND looping = 1', owner)
      .toArray()
      .map((row) => row.name);
  }

  share(name: string, owner: string): string {
    const existing = this.ctx.storage.sql
      .exec<{ token: string }>('SELECT token FROM shares WHERE name = ? AND owner = ?', name, owner)
      .toArray()[0];

    if (existing !== undefined) return existing.token;

    const bytes = crypto.getRandomValues(new Uint8Array(18));
    const token = btoa(String.fromCharCode(...bytes))
      .replace(/[+]/g, '-')
      .replace(/[/]/g, '_')
      .replace(/=+$/, '');

    this.ctx.storage.sql.exec(
      'INSERT INTO shares (token, name, owner, created_at) VALUES (?, ?, ?, ?)',
      token,
      name,
      owner,
      Date.now(),
    );

    return token;
  }

  unshare(name: string, owner: string): void {
    this.ctx.storage.sql.exec('DELETE FROM shares WHERE name = ? AND owner = ?', name, owner);
  }

  shared(token: string): { name: string; owner: string } | null {
    return (
      this.ctx.storage.sql
        .exec<{ name: string; owner: string }>(
          'SELECT name, owner FROM shares WHERE token = ?',
          token,
        )
        .toArray()[0] ?? null
    );
  }

  spendFor(owner: string): number {
    const row = this.ctx.storage.sql
      .exec<{ total: number | null; working: number | null }>(
        'SELECT SUM(spend) AS total, SUM(busy) AS working FROM threads WHERE owner = ?',
        owner,
      )
      .toArray()[0];

    return (row?.total ?? 0) + (row?.working ?? 0) * TURN_RESERVE;
  }

  agentThreadsFor(owner: string): number {
    return (
      this.ctx.storage.sql
        .exec<{ n: number }>(
          "SELECT COUNT(*) AS n FROM threads WHERE owner = ? AND created_by LIKE 'thread:%'",
          owner,
        )
        .toArray()[0]?.n ?? 0
    );
  }

  workingFor(owner: string): number {
    return (
      this.ctx.storage.sql
        .exec<{ n: number }>(
          'SELECT COUNT(*) AS n FROM threads WHERE owner = ? AND busy = 1',
          owner,
        )
        .toArray()[0]?.n ?? 0
    );
  }

  get(name: string): ThreadSummary | null {
    const row = this.ctx.storage.sql
      .exec<Row>('SELECT * FROM threads WHERE name = ?', name)
      .toArray()[0];

    return row === undefined ? null : fromRow(row);
  }

  list(owner: string, limit = 200): ThreadSummary[] {
    return this.ctx.storage.sql
      .exec<Row>(
        'SELECT * FROM threads WHERE owner = ? ORDER BY updated_at DESC LIMIT ?',
        owner,
        limit,
      )
      .toArray()
      .map(fromRow);
  }

  remove(name: string): void {
    this.ctx.storage.sql.exec('DELETE FROM threads WHERE name = ?', name);
  }

  setBase(repo: string, snapshotId: string, thread: string, setup: string): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO bases (repo, snapshot_id, thread, setup, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(repo) DO UPDATE SET snapshot_id = excluded.snapshot_id, thread = excluded.thread, setup = excluded.setup, at = excluded.at',
      repo,
      snapshotId,
      thread,
      setup,
      Date.now(),
    );
  }

  base(repo: string): { snapshotId: string; thread: string; setup: string; at: number } | null {
    const row = this.ctx.storage.sql
      .exec<{ snapshot_id: string; thread: string; setup: string; at: number }>(
        'SELECT snapshot_id, thread, setup, at FROM bases WHERE repo = ?',
        repo,
      )
      .toArray()[0];

    return row === undefined
      ? null
      : { snapshotId: row.snapshot_id, thread: row.thread, setup: row.setup, at: row.at };
  }

  bases(): { repo: string; thread: string; setup: string; at: number }[] {
    return this.ctx.storage.sql
      .exec<{ repo: string; thread: string; setup: string; at: number }>(
        'SELECT repo, thread, setup, at FROM bases ORDER BY at DESC',
      )
      .toArray();
  }
}
