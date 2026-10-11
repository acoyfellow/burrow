import { type Computer, type ExecResult, inWorkspace, type Snapshot } from '../src/computer';

type Disk = Map<string, string>;

const snapshots = new Map<string, Disk>();

const running = new Map<string, Disk>();

export const crash = (owner: string) => running.delete(owner);

const bootedAt = new Map<string, string[]>();

export const bootSizes = (owner: string) => bootedAt.get(owner) ?? [];

const ok = (stdout = ''): ExecResult => ({ exitCode: 0, stdout, stderr: '' });

const live = (owner: string): Disk => {
  const disk = running.get(owner);

  if (disk === undefined) throw new Error('computer is not running');

  return disk;
};

const listing = (disk: Disk) =>
  [...disk.keys()]
    .map((path) => path.replace('/workspace/', ''))
    .sort()
    .join('\n');

export const memoryComputer = (owner: string): Computer => ({
  running: () => running.has(owner),
  boot: async (from, size) => {
    if (running.has(owner)) return;

    bootedAt.set(owner, [...(bootedAt.get(owner) ?? []), size]);

    running.set(owner, new Map(from === undefined ? [] : (snapshots.get(from.id) ?? [])));
  },
  exec: async (wrapped) => {
    const disk = live(owner);
    const argv = wrapped[3] === 'bounded' ? wrapped.slice(5) : wrapped;
    const script = argv[0] === 'bash' || argv[0] === 'sh' ? argv[2] : undefined;

    if (script === 'ls') return ok(listing(disk));

    if (script === 'hostname') return ok(owner);

    return ok();
  },
  readFile: async (path) => {
    const value = live(owner).get(inWorkspace(path));

    if (value === undefined) throw new Error(`No such file: ${path}`);

    return value;
  },
  writeFile: async (path, content) => {
    live(owner).set(
      inWorkspace(path),
      typeof content === 'string' ? content : new TextDecoder().decode(content),
    );
  },
  list: async () =>
    [...live(owner).keys()].map((path) => ({
      name: path.replace('/workspace/', ''),
      type: 'file',
    })),
  snapshot: async (name): Promise<Snapshot> => {
    const disk = live(owner);
    const id = `${name}-${crypto.randomUUID()}`;

    snapshots.set(id, new Map(disk));

    return { id, size: [...disk.values()].reduce((sum, value) => sum + value.length, 0) };
  },
  destroy: async () => {
    running.delete(owner);
  },
});
