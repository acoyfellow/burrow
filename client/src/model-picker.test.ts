import { describe, expect, it } from 'vitest';
import { moveIndex, PICKER_LIMIT, pickerOptions, startsGroup } from './model-picker';

const option = (id: string, extra: { gateway?: boolean; vision?: boolean } = {}) => ({
  id,
  label: id.split('/').pop() ?? id,
  context: 1000,
  inputPerMtok: 1,
  outputPerMtok: 1,
  vision: extra.vision ?? false,
  ...(extra.gateway === undefined ? {} : { gateway: extra.gateway }),
});

describe('model picker', () => {
  const all = [
    option('@cf/moonshotai/kimi-k3'),
    option('gateway/claude-opus-5-5', { gateway: true }),
    option('@cf/zai-org/glm-5.3-flash', { vision: true }),
  ];

  it('lists gateway models first, then Workers AI', () => {
    expect(pickerOptions(all, '').map((each) => each.id)).toEqual([
      'gateway/claude-opus-5-5',
      '@cf/moonshotai/kimi-k3',
      '@cf/zai-org/glm-5.3-flash',
    ]);
  });

  it('matches every word against the label and id', () => {
    expect(pickerOptions(all, 'kimi k3').map((each) => each.id)).toEqual([
      '@cf/moonshotai/kimi-k3',
    ]);
    expect(pickerOptions(all, 'zai').map((each) => each.id)).toEqual(['@cf/zai-org/glm-5.3-flash']);
  });

  it('finds models that see images', () => {
    expect(pickerOptions(all, 'vision').map((each) => each.id)).toEqual([
      '@cf/zai-org/glm-5.3-flash',
    ]);
  });

  it('caps how many rows it renders', () => {
    const many = Array.from({ length: 500 }, (_, index) => option(`@cf/x/m${index}`));

    expect(pickerOptions(many, '')).toHaveLength(PICKER_LIMIT);
  });

  it('marks where each group starts', () => {
    const options = pickerOptions(all, '');

    expect(options.map((_, index) => startsGroup(options, index))).toEqual([true, true, false]);
  });

  it('wraps the keyboard index both ways', () => {
    expect(moveIndex(0, -1, 3)).toBe(2);
    expect(moveIndex(2, 1, 3)).toBe(0);
    expect(moveIndex(0, 1, 0)).toBe(0);
  });
});
