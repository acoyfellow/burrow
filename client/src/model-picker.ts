import type { ModelOption } from '../../shared/protocol';

export const PICKER_LIMIT = 60;

export type PickerGroup = 'gateway' | 'workers-ai';

export type PickerOption = typeof ModelOption.Type;

const groupOf = (option: PickerOption): PickerGroup =>
  option.gateway === true ? 'gateway' : 'workers-ai';

const haystack = (option: PickerOption) =>
  `${option.label} ${option.id} ${option.vision ? 'vision images' : ''} ${option.reasoning ? 'reasoning' : ''}`.toLowerCase();

export const matchesQuery = (option: PickerOption, query: string): boolean => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = haystack(option);

  return words.every((word) => text.includes(word));
};

export const pickerOptions = (
  all: readonly PickerOption[],
  query: string,
): readonly PickerOption[] => {
  const matched = all.filter((option) => matchesQuery(option, query));
  const ordered = [
    ...matched.filter((option) => groupOf(option) === 'gateway'),
    ...matched.filter((option) => groupOf(option) === 'workers-ai'),
  ];

  return ordered.slice(0, PICKER_LIMIT);
};

export const groupLabel = (option: PickerOption): string =>
  groupOf(option) === 'gateway' ? 'AI Gateway' : 'Workers AI';

export const startsGroup = (options: readonly PickerOption[], index: number): boolean => {
  const current = options[index];
  const previous = options[index - 1];

  return (
    current !== undefined && (previous === undefined || groupOf(previous) !== groupOf(current))
  );
};

export const moveIndex = (index: number, delta: number, count: number): number =>
  count === 0 ? 0 : (index + delta + count) % count;
