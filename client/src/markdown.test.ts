import { describe, expect, it } from 'vitest';
import { parseBlocks } from './view/markdown';

describe('streaming markdown', () => {
  it('keeps an unclosed fence as an open code block while text streams', () => {
    const blocks = parseBlocks('Here:\n```ts\nconst a = 1');

    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'Here:' },
      { kind: 'code', lang: 'ts', text: 'const a = 1', open: true },
    ]);
  });

  it('closes the fence once it arrives', () => {
    expect(parseBlocks('```\nx\n```\nafter')).toEqual([
      { kind: 'code', lang: '', text: 'x', open: false },
      { kind: 'paragraph', text: 'after' },
    ]);
  });

  it('reads headings, lists, quotes and rules', () => {
    const kinds = parseBlocks('## Title\n\n- a\n- b\n\n1. one\n\n> said\n\n---').map((b) => b.kind);

    expect(kinds).toEqual(['heading', 'list', 'list', 'quote', 'rule']);
  });
});
