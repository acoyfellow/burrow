import { SHELL_ENV, WORKSPACE } from './env';

export const SESSION = /^[a-z0-9][a-z0-9-]{0,30}$/;

export type Size = { readonly cols: number; readonly rows: number };

export const parseSize = (cols: unknown, rows: unknown): Size | null => {
  const c = Number(cols);
  const r = Number(rows);

  return Number.isInteger(c) && Number.isInteger(r) && c >= 2 && c <= 500 && r >= 2 && r <= 300
    ? { cols: c, rows: r }
    : null;
};

const TMUX_CONF = [
  'set -g status off',
  'set -g mouse off',
  "set -ga terminal-overrides ',xterm*:smcup@:rmcup@'",
  'set -g history-limit 20000',
  'set -g default-terminal xterm-256color',
  'set -sg escape-time 0',
  'set -g window-size latest',
  'set -g aggressive-resize on',
].join('\n');

export const tmuxArgs = (session: string) => [
  'bash',
  '-c',
  [
    `mkdir -p /root && printf '%s\\n' "$1" > /root/.tmux.conf`,
    `if tmux has-session -t "=$2" 2>/dev/null; then tmux capture-pane -p -e -J -S -3000 -t "=$2"; fi`,
    `exec tmux -f /root/.tmux.conf new-session -A -s "$2" -c ${WORKSPACE}`,
  ].join('; '),
  'attach',
  TMUX_CONF,
  session,
];

export const terminalEnv = (): Record<string, string> => ({
  ...SHELL_ENV,
  TERM: 'xterm-256color',
  LANG: 'C.UTF-8',
});

export const resizeRequest = (frame: string): Size | null => {
  try {
    const control = JSON.parse(frame) as { resize?: [number, number] };

    return control.resize ? parseSize(control.resize[0], control.resize[1]) : null;
  } catch {
    return null;
  }
};

export const bridge = (socket: WebSocket, process: ExecProcess, abort: AbortController) => {
  const stdin = process.stdin;
  const stdout = process.stdout;

  if (stdin === null || stdout === null) {
    abort.abort();
    socket.close(1011, 'no terminal streams');

    return;
  }

  const input = stdin.getWriter();
  let exited = false;

  process.exitCode.then(
    () => {
      exited = true;
    },
    () => {
      exited = true;
    },
  );

  const stop = () => {
    if (!exited) abort.abort();
  };

  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') {
      input.write(new Uint8Array(event.data as ArrayBuffer)).catch(stop);

      return;
    }

    const size = resizeRequest(event.data);

    if (size !== null) process.resize(size.cols, size.rows);
  });
  socket.addEventListener('close', stop);
  socket.addEventListener('error', stop);

  void (async () => {
    try {
      for await (const chunk of stdout as ReadableStream<Uint8Array>) socket.send(chunk);
      socket.close(1000, `exit ${await process.exitCode}`);
    } catch {
      if (!abort.signal.aborted) socket.close(1011, 'terminal output failed');
      stop();
    }
  })();
};
