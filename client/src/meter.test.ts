import { describe, expect, test } from 'vitest';
import { ranFor } from './view/feed';
import { ringColor } from './view/meter';

describe('turn footer', () => {
  test('reads like a stopwatch', () => {
    expect(ranFor(400)).toBe('1s');
    expect(ranFor(41_000)).toBe('41s');
    expect(ranFor(193_000)).toBe('3m 13s');
    expect(ranFor(3_900_000)).toBe('1h 5m');
  });
});

describe('context ring', () => {
  test('is gray when empty, then green, amber, orange and red as it fills', () => {
    expect(ringColor(0)).toBe('var(--line2)');
    expect(ringColor(10)).toBe('var(--ok)');
    expect(ringColor(60)).toBe('var(--warn)');
    expect(ringColor(75)).toBe('var(--orange)');
    expect(ringColor(92)).toBe('var(--bad)');
  });
});
