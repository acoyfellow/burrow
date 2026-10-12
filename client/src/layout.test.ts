import { describe, expect, it } from 'vitest';
import { clampWidth, readLayout } from './layout';

describe('panel layout', () => {
  it('keeps widths inside the allowed range', () => {
    expect(clampWidth('side', 20)).toBe(180);
    expect(clampWidth('side', 9999)).toBe(480);
    expect(clampWidth('panel', 600.4)).toBe(600);
  });

  it('reads a saved layout and falls back on junk', () => {
    expect(readLayout('{"side":300,"panel":700,"sideHidden":true}')).toEqual({
      side: 300,
      panel: 700,
      sideHidden: true,
      panelHidden: false,
    });
    expect(readLayout('not json').side).toBe(248);
    expect(readLayout(null).panelHidden).toBe(false);
  });
});
