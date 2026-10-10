import type { Env } from './thread';

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

const DIRECTORY = 'all';

export type CreateInput = {
  readonly name?: string;
  readonly repo?: string | null;
  readonly title?: string;
  readonly createdBy: string;
  readonly warm?: boolean;
};

const fresh = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 6)}`;

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'thread';

export const burrow = (env: Env) => {
  const directory = env.DIRECTORY.getByName(DIRECTORY);

  const thread = (name: string) => {
    if (!NAME.test(name)) throw new Error('Thread names are lowercase letters, digits, and dashes');

    return env.THREAD.getByName(name);
  };

  const known = async (name: string) => {
    if ((await directory.get(name)) === null) throw new Error(`unknown thread ${name}`);

    return thread(name);
  };

  const create = async (input: CreateInput) => {
    const name = input.name ?? fresh(slug(input.title ?? input.repo?.split('/').pop() ?? 'thread'));
    const base = input.repo && input.warm !== false ? await directory.base(input.repo) : null;

    return thread(name).create(name, {
      repo: input.repo ?? null,
      title: input.title,
      createdBy: input.createdBy,
      base: base?.snapshotId,
    });
  };

  return {
    list: () => directory.list(),
    create,
    view: async (name: string) => (await known(name)).view(),
    events: async (name: string, request: Request) =>
      (await known(name)).fetch(new Request('https://thread/events', { signal: request.signal })),
    start: async (name: string, requestId: string, text: string) =>
      (await known(name)).start(requestId, text),
    send: async (name: string, requestId: string, text: string) =>
      (await known(name)).send(requestId, text),
    exec: async (name: string, argv: string[]) => (await known(name)).exec(argv),
    read: async (name: string, path: string) => (await known(name)).readFile(path),
    list_dir: async (name: string, path: string) => (await known(name)).list(path),
    compact: async (name: string) => (await known(name)).compact(),
    pause: async (name: string) => (await known(name)).pause(),
    answer: async (name: string) => (await known(name)).waitForAnswer(),
    fork: async (name: string, forkName: string | undefined, createdBy: string) => {
      const source = await known(name);
      const summary = await directory.get(name);
      const snapshot = await source.snapshot();
      const seed = await source.forkContext();
      const target = forkName ?? fresh(`${name.slice(0, 40)}-fork`);

      return thread(target).create(target, {
        repo: summary?.repo ?? null,
        title: `Fork of ${summary?.title ?? name}`,
        createdBy,
        forkedFrom: name,
        base: snapshot.id,
        seed,
      });
    },
    bases: () => directory.bases(),
    prepare: async (repo: string, setup: string) => {
      const name = fresh(`base-${slug(repo.split('/').pop() ?? 'repo')}`);
      const box = thread(name);

      await box.create(name, { repo, title: `Warm base for ${repo}`, createdBy: 'base' });

      const ran =
        setup.trim() === ''
          ? { exitCode: 0, stdout: '', stderr: '' }
          : await box.exec(['bash', '-lc', setup]);

      if (ran.exitCode !== 0)
        throw new Error(`setup failed (exit ${ran.exitCode}): ${ran.stderr.slice(0, 400)}`);

      const snapshot = await box.snapshot();

      await directory.setBase(repo, snapshot.id, name, setup);
      await box.pause();

      return { repo, thread: name, snapshot };
    },
  };
};

export type Burrow = ReturnType<typeof burrow>;
