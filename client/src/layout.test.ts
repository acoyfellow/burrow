import { describe, expect, it } from 'vitest';
import { clampWidth, dragged, fitColumns, readLayout, toggled } from './layout';

const base = { side: 248, panel: 480, sideHidden: false, panelHidden: false };

describe('panel layout', () => {
  it('keeps widths inside the allowed range', () => {
    expect(clampWidth('side', 20)).toBe(180);
    expect(clampWidth('side', 9999)).toBe(420);
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
  });

  it('always leaves the chat at least 360 px', () => {
    for (const width of [721, 900, 1100, 1280, 1600, 2400]) {
      const fitted = fitColumns({ ...base, side: 420, panel: 1600 }, width);

      expect(width - fitted.side - fitted.panel).toBeGreaterThanOrEqual(360);
    }
  });

  it('shrinks the panel first, then hides it before the threads list', () => {
    expect(fitColumns(base, 1088)).toEqual({ side: 248, panel: 480 });
    expect(fitColumns(base, 1000)).toEqual({ side: 248, panel: 392 });
    expect(fitColumns(base, 800)).toEqual({ side: 248, panel: 0 });
  });

  it('hides both side columns on a phone', () => {
    expect(fitColumns(base, 390)).toEqual({ side: 0, panel: 0 });
  });

  it('toggles a column and makes room by hiding the other when needed', () => {
    expect(toggled(base, 'side', 1400).sideHidden).toBe(true);
    expect(toggled({ ...base, sideHidden: true }, 'side', 1400).sideHidden).toBe(false);

    const narrow = toggled(base, 'panel', 800);

    expect(narrow.panelHidden).toBe(false);
    expect(narrow.sideHidden).toBe(true);
  });

  it('stops a drag where the chat would get too narrow', () => {
    expect(dragged(base, 'panel', 5000, 1400).panel).toBe(1400 - 248 - 360);
  });
});
