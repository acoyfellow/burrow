export type LoopSpec = {
  readonly prompt: string;
  readonly everySeconds: number;
  readonly maxRuns: number;
  readonly maxSpend: number;
  readonly gate: string | null;
};

export type LoopRun = {
  readonly at: number;
  readonly costBefore: number;
  readonly gateExit: number | null;
};

export type LoopState = LoopSpec & {
  readonly enabled: boolean;
  readonly runs: readonly LoopRun[];
  readonly startedCost: number;
  readonly nextAt: number;
  readonly stoppedBecause: string | null;
};

export const MIN_EVERY_SECONDS = 30;

export const MAX_RUNS_LIMIT = 200;

export const MAX_LOOP_SPEND = 20;

export const validSpec = (spec: LoopSpec): string | null => {
  if (spec.prompt.trim() === '') return 'prompt is required';
  if (!(spec.everySeconds >= MIN_EVERY_SECONDS))
    return `every must be at least ${MIN_EVERY_SECONDS} seconds`;
  if (!(spec.maxRuns >= 1 && spec.maxRuns <= MAX_RUNS_LIMIT))
    return `max runs must be 1 to ${MAX_RUNS_LIMIT}`;
  if (!(spec.maxSpend > 0 && spec.maxSpend <= MAX_LOOP_SPEND))
    return `max spend must be above 0 and at most $${MAX_LOOP_SPEND}`;

  return null;
};

export type LoopDecision =
  | { readonly kind: 'wait'; readonly at: number }
  | { readonly kind: 'check-gate' }
  | { readonly kind: 'run' }
  | { readonly kind: 'stop'; readonly reason: string };

export const decide = (
  loop: LoopState,
  now: number,
  cost: number,
  busy: boolean,
  ownerSpend: number,
  ownerCap: number,
): LoopDecision => {
  if (!loop.enabled) return { kind: 'stop', reason: loop.stoppedBecause ?? 'stopped' };
  if (ownerSpend >= ownerCap)
    return { kind: 'stop', reason: `owner spend limit $${ownerCap} reached` };
  if (cost - loop.startedCost >= loop.maxSpend)
    return { kind: 'stop', reason: `loop spend limit $${loop.maxSpend} reached` };
  if (busy) return { kind: 'wait', at: now + 5_000 };
  if (now < loop.nextAt) return { kind: 'wait', at: loop.nextAt };
  if (loop.gate !== null && loop.runs.length > 0 && loop.runs.at(-1)?.gateExit === null)
    return { kind: 'check-gate' };
  if (loop.runs.length >= loop.maxRuns)
    return { kind: 'stop', reason: `ran ${loop.maxRuns} times` };

  return { kind: 'run' };
};

export const digest = (loop: LoopState, cost: number): string => {
  const spent = Math.max(0, cost - loop.startedCost);
  const gates = loop.runs
    .map((run) => (run.gateExit === null ? '-' : String(run.gateExit)))
    .join(' ');

  return [
    `Loop digest: ${loop.runs.length} run${loop.runs.length === 1 ? '' : 's'}, $${spent.toFixed(4)} spent.`,
    `Stopped: ${loop.stoppedBecause ?? 'still running'}.`,
    loop.gate === null ? 'No gate.' : `Gate \`${loop.gate}\` exits by run: ${gates}.`,
  ].join('\n');
};
