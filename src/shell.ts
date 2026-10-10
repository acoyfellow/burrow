export const RUN_LIMIT_SECONDS = 120;

export const HUMAN_LIMIT_SECONDS = 600;

export const OUTPUT_CAP_BYTES = 256 * 1024;

export const TIMED_OUT_EXIT = 124;

const NO_INPUT = ['', 'dev', 'null'].join('/');

const BOUNDED_SCRIPT = [
  'limit=$1',
  'shift',
  'out=$(mktemp) err=$(mktemp)',
  `timeout --kill-after=5 "$limit" "$@" >"$out" 2>"$err" <${NO_INPUT}`,
  'code=$?',
  `head -c ${OUTPUT_CAP_BYTES} "$out"`,
  'total=$(wc -c <"$out")',
  `if [ "$total" -gt ${OUTPUT_CAP_BYTES} ]; then printf '\\n[output truncated: %s bytes in total]\\n' "$total"; fi`,
  `head -c ${OUTPUT_CAP_BYTES} "$err" >&2`,
  'rm -f "$out" "$err"',
  'exit $code',
].join('\n');

export const bounded = (argv: readonly string[], seconds: number) => [
  'bash',
  '-c',
  BOUNDED_SCRIPT,
  'bounded',
  String(seconds),
  ...argv,
];

export const boundedShell = (command: string) =>
  bounded(['bash', '-lc', command], RUN_LIMIT_SECONDS);
