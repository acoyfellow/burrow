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
});

export class Directory extends DurableObject {
  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    ctx.storage.sql.exec(
      `CREATE TABLE IF NOT EXISTS threads (name TEXT PRIMARY KEY, title TEXT NOT NULL, phase TEXT NOT NULL, busy INTEGER NOT NULL DEFAULT 0, repo TEXT, parent TEXT, forked_from TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
    );
    ctx.storage.sql.exec(
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
    };

    this.ctx.storage.sql.exec(
      `INSERT INTO threads (name, title, phase, busy, repo, parent, forked_from, created_by, owner, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET title = excluded.title, phase = excluded.phase, busy = excluded.busy, repo = excluded.repo, parent = excluded.parent, forked_from = excluded.forked_from, owner = excluded.owner, updated_at = excluded.updated_at`,
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
