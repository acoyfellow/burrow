import type { Computer, ExecResult, Snapshot } from '../src/computer';

type Disk = Map<string, string>;

const snapshots = new Map<string, Disk>();

const running = new Map<string, Disk>();

const ok = (stdout = ''): ExecResult => ({ exitCode: 0, stdout, stderr: '' });

const fail = (stderr: string): ExecResult => ({ exitCode: 1, stdout: '', stderr });

const resolvePath = (path: string) => (path.startsWith('/') ? path : `/workspace/${path}`);

const shell = (disk: Disk, script: string): ExecResult => {
  const write = /^printf %s '([^']*)' > (\S+)$/.exec(script);

  if (write !== null && write[1] !== undefined && write[2] !== undefined) {
    disk.set(resolvePath(write[2]), write[1]);

    return ok();
  }

  const cat = /^cat (\S+)$/.exec(script);

  if (cat !== null && cat[1] !== undefined) {
    const value = disk.get(resolvePath(cat[1]));

    return value === undefined ? fail(`cat: ${cat[1]}: No such file`) : ok(value);
  }

  if (script === 'ls')
    return ok(
      [...disk.keys()]
        .map((path) => path.replace('/workspace/', ''))
        .sort()
        .join('\n'),
    );

  if (script === 'hostname')
    return ok([...running.entries()].find(([, value]) => value === disk)?.[0] ?? '?');

  return ok();
};

export const memoryComputer = (owner: string): Computer => ({
  running: () => running.has(owner),
  boot: async (from) => {
    if (running.has(owner)) return;

    running.set(owner, new Map(from === undefined ? [] : (snapshots.get(from.id) ?? [])));
  },
  exec: async (argv) => {
    const disk = running.get(owner);

    if (disk === undefined) throw new Error('computer is not running');

    if (argv[0] === 'cat' && argv[1] !== undefined) return shell(disk, `cat ${argv[1]}`);

    if (
      argv[0] === 'sh' &&
      argv[1] === '-c' &&
      argv[3] === 'write' &&
      argv[4] !== undefined &&
      argv[5] !== undefined
    ) {
      disk.set(
        argv[4],
        new TextDecoder().decode(Uint8Array.from(atob(argv[5]), (c) => c.charCodeAt(0))),
      );

      return ok();
    }

    if (argv[0] === 'sh' && argv[2] !== undefined) return shell(disk, argv[2]);

    return ok();
  },
  snapshot: async (name): Promise<Snapshot> => {
    const disk = running.get(owner);

    if (disk === undefined) throw new Error('computer is not running');

    const id = `${name}-${crypto.randomUUID()}`;

    snapshots.set(id, new Map(disk));

    return { id, size: [...disk.values()].reduce((sum, value) => sum + value.length, 0) };
  },
  destroy: async () => {
    running.delete(owner);
  },
});
