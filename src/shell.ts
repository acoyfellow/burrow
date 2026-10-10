export const RUN_LIMIT_SECONDS = 120;

export const TIMED_OUT_EXIT = 124;

const BOUNDED_SHELL_SCRIPT = [
  'out=$(mktemp) err=$(mktemp)',
  `timeout --kill-after=5 ${RUN_LIMIT_SECONDS} bash -lc "$1" >"$out" 2>"$err" <${['', 'dev', 'null'].join('/')}`,
  'code=$?',
  'cat "$out"',
  'cat "$err" >&2',
  'rm -f "$out" "$err"',
  'exit $code',
].join('\n');

export const boundedShell = (command: string) => [
  'bash',
  '-c',
  BOUNDED_SHELL_SCRIPT,
  'run',
  command,
];
