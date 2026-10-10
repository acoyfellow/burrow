import { Files } from '@cloudflare/sandbox';

export type ExecResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type Snapshot = { readonly id: string; readonly size: number };

export type Entry = { readonly name: string; readonly type: string };

export class ComputerLost extends Error {
  override readonly name = 'ComputerLost';
}

export type Computer = {
  readonly running: () => boolean;
  readonly boot: (from: Snapshot | undefined) => Promise<void>;
  readonly exec: (argv: readonly string[], cwd?: string) => Promise<ExecResult>;
  readonly readFile: (path: string) => Promise<string>;
  readonly writeFile: (path: string, content: string) => Promise<void>;
  readonly list: (path: string) => Promise<Entry[]>;
  readonly snapshot: (name: string) => Promise<Snapshot>;
  readonly destroy: () => Promise<void>;
};

export const WORKSPACE = '/workspace';

export const inWorkspace = (path: string) =>
  path.startsWith('/') ? path : `${WORKSPACE}/${path.replace(/^\.\/?/, '')}`;

const INACTIVITY_MS = 10 * 60 * 1000;

const LOST_LAUNCHES_BEFORE_GIVING_UP = 3;

const decode = (bytes: ArrayBuffer | Uint8Array | string | undefined): string =>
  bytes === undefined ? '' : typeof bytes === 'string' ? bytes : new TextDecoder().decode(bytes);

export const sandboxComputer = (container: Container, image: string): Computer => {
  const files = new Files(container);

  const exec = async (argv: readonly string[], cwd = WORKSPACE): Promise<ExecResult> => {
    let lost = 0;

    for (;;) {
      try {
        const process = await container.exec([...argv], { cwd });
        const output = await process.output();

        return {
          exitCode: output.exitCode,
          stdout: decode(output.stdout),
          stderr: decode(output.stderr),
        };
      } catch (cause) {
        lost += 1;

        if (lost >= LOST_LAUNCHES_BEFORE_GIVING_UP) throw new ComputerLost(String(cause));
      }
    }
  };

  return {
    running: () => container.running,
    boot: async (from) => {
      if (container.running) return;

      const base = {
        enableInternet: true,
        instance: 'standard-1' as const,
        labels: { app: 'burrow' },
      };

      container.start(
        from === undefined ? { ...base, image } : { ...base, containerSnapshot: { id: from.id } },
      );
      await container.setInactivityTimeout(INACTIVITY_MS);
    },
    exec,
    readFile: async (path) => (await files.readFile(inWorkspace(path))).text(),
    writeFile: async (path, content) => {
      const target = inWorkspace(path);

      await files.mkdir(target.slice(0, target.lastIndexOf('/')) || '/', { recursive: true });
      await files.writeFile(target, content);
    },
    list: async (path) =>
      (await files.readDirectory(inWorkspace(path)))
        .map((entry) => ({ name: entry.name, type: entry.type }))
        .sort((a, b) =>
          a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1,
        ),
    snapshot: async (name) => {
      const made = await container.snapshotContainer({ name });

      return { id: made.id, size: made.size };
    },
    destroy: async () => {
      if (container.running) await container.destroy();
    },
  };
};
