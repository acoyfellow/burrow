import { describe, expect, it } from 'vitest';
import { COMPACT_AT, compactionPolicy } from '../src/compaction';

describe('compaction at 75%', () => {
  it('blocks to compact once the context passes 75% of the budget', () => {
    const policy = compactionPolicy(1_000_000, 8_000, 20_000);

    expect(COMPACT_AT).toBe(0.75);
    expect(1_000_000 - (policy.reserveTokens ?? 0)).toBe(6_000);
    expect(policy.backgroundTokens).toBe(0);
    expect(policy.keepRecentTokens).toBe(2_000);
  });

  it('uses the model window when no budget is set', () => {
    const policy = compactionPolicy(200_000, null, 20_000);

    expect(200_000 - (policy.reserveTokens ?? 0)).toBe(150_000);
    expect(policy.keepRecentTokens).toBe(20_000);
  });

  it('never raises the limit above the model window', () => {
    const policy = compactionPolicy(100_000, 5_000_000, 20_000);

    expect(100_000 - (policy.reserveTokens ?? 0)).toBe(75_000);
  });
});
