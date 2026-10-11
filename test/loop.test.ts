import { describe, expect, it } from 'vitest';
import { decide, digest, type LoopState, validSpec } from '../src/loop';

const loop = (over: Partial<LoopState> = {}): LoopState => ({
  prompt: 'do the next step',
  everySeconds: 60,
  maxRuns: 3,
  maxSpend: 1,
  gate: null,
  enabled: true,
  runs: [],
  startedCost: 0,
  nextAt: 0,
  stoppedBecause: null,
  ...over,
});

const run = (gateExit: number | null = null) => ({ at: 0, costBefore: 0, gateExit });

describe('loop decisions', () => {
  it('rejects unsafe specs', () => {
    expect(
      validSpec({ prompt: '', everySeconds: 60, maxRuns: 3, maxSpend: 1, gate: null }),
    ).toContain('prompt');
    expect(
      validSpec({ prompt: 'x', everySeconds: 5, maxRuns: 3, maxSpend: 1, gate: null }),
    ).toContain('30');
    expect(
      validSpec({ prompt: 'x', everySeconds: 60, maxRuns: 0, maxSpend: 1, gate: null }),
    ).toContain('max runs');
    expect(
      validSpec({ prompt: 'x', everySeconds: 60, maxRuns: 3, maxSpend: 50, gate: null }),
    ).toContain('spend');
  });

  it('runs when due, waits for the interval and for a busy agent', () => {
    expect(decide(loop(), 1000, 0, false, 0, 25)).toEqual({ kind: 'run' });
    expect(decide(loop({ nextAt: 5000 }), 1000, 0, false, 0, 25)).toEqual({
      kind: 'wait',
      at: 5000,
    });
    expect(decide(loop(), 1000, 0, true, 0, 25).kind).toBe('wait');
  });

  it('stops at the run cap', () => {
    expect(decide(loop({ runs: [run(), run(), run()] }), 1000, 0, false, 0, 25)).toEqual({
      kind: 'stop',
      reason: 'ran 3 times',
    });
  });

  it('checks the gate once after each run', () => {
    const gated = loop({ gate: 'test -f done', runs: [run()] });

    expect(decide(gated, 1000, 0, false, 0, 25)).toEqual({ kind: 'check-gate' });
    expect(decide(loop({ gate: 'test -f done', runs: [run(1)] }), 1000, 0, false, 0, 25)).toEqual({
      kind: 'run',
    });
  });

  it('stops at the loop spend limit and at the owner spend limit', () => {
    expect(decide(loop({ startedCost: 2 }), 1000, 3.5, false, 0, 25)).toEqual({
      kind: 'stop',
      reason: 'loop spend limit $1 reached',
    });
    expect(decide(loop(), 1000, 0, false, 30, 25)).toEqual({
      kind: 'stop',
      reason: 'owner spend limit $25 reached',
    });
  });

  it('a stopped loop stays stopped (kill switch)', () => {
    expect(
      decide(loop({ enabled: false, stoppedBecause: 'kill switch' }), 1000, 0, false, 0, 25),
    ).toEqual({
      kind: 'stop',
      reason: 'kill switch',
    });
  });

  it('writes an end-of-run digest', () => {
    const text = digest(
      loop({
        gate: 'test -f done',
        runs: [run(1), run(0)],
        stoppedBecause: 'gate passed after 2 runs',
      }),
      0.25,
    );

    expect(text).toContain('2 runs');
    expect(text).toContain('$0.2500');
    expect(text).toContain('gate passed after 2 runs');
    expect(text).toContain('exits by run: 1 0');
  });
});
