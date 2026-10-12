import { describe, expect, it } from 'vitest';
import { browserTabFor } from './focus';

const surfaces = [
  { id: 't1', kind: 'terminal' },
  { id: 'b1', kind: 'browser' },
];

describe('browser focus', () => {
  it('shows the browser tab when the agent uses a browser tool', () => {
    expect(browserTabFor(surfaces, 't1', 'browser_open')).toBe('b1');
    expect(browserTabFor(surfaces, 'files', 'browser_click')).toBe('b1');
  });

  it('leaves the tab alone for other tools or when there is no browser', () => {
    expect(browserTabFor(surfaces, 't1', 'run')).toBe('t1');
    expect(browserTabFor([{ id: 't1', kind: 'terminal' }], 't1', 'browser_open')).toBe('t1');
  });
});
