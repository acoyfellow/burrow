export const SIZES = ['lite', 'standard-1', 'standard-2', 'standard-3', 'standard-4'] as const;

export type Size = (typeof SIZES)[number];

export const DEFAULT_SIZE: Size = 'standard-1';

export const isSize = (value: unknown): value is Size =>
  typeof value === 'string' && (SIZES as readonly string[]).includes(value);

export const sizeOrDefault = (value: unknown): Size => (isSize(value) ? value : DEFAULT_SIZE);
