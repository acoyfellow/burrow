import { describe, expect, test } from 'vitest';
import { byteSpan, withRanges } from '../src/player';

const video = () =>
  new Response(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), {
    headers: { 'content-type': 'video/mp4' },
  });
const asked = (range?: string) =>
  new Request('https://x.test/v.mp4', range === undefined ? {} : { headers: { range } });

describe('byteSpan', () => {
  test('reads open, closed and suffix ranges', () => {
    expect(byteSpan('bytes=0-1', 10)).toEqual({ start: 0, end: 1 });
    expect(byteSpan('bytes=4-', 10)).toEqual({ start: 4, end: 9 });
    expect(byteSpan('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(byteSpan('bytes=2-99', 10)).toEqual({ start: 2, end: 9 });
    expect(byteSpan(null, 10)).toBeNull();
    expect(byteSpan('bytes=-', 10)).toBeNull();
  });
});

describe('withRanges', () => {
  test('returns 206 with only the asked bytes', async () => {
    const response = await withRanges(asked('bytes=2-4'), video());
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe('bytes 2-4/10');
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([2, 3, 4]);
  });

  test('returns the whole file with accept-ranges when no range is asked', async () => {
    const response = await withRanges(asked(), video());
    expect(response.status).toBe(200);
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect((await response.arrayBuffer()).byteLength).toBe(10);
  });

  test('refuses a range past the end', async () => {
    expect((await withRanges(asked('bytes=20-'), video())).status).toBe(416);
  });
});
