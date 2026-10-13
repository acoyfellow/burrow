export const COMPACT_AT = 0.75;

export const compactionPolicy = (
  modelWindow: number,
  budget: number | null,
  keepRecentTokens: number,
) => {
  const limit = Math.min(budget ?? modelWindow, modelWindow);

  if (limit <= 0) return { keepRecentTokens };

  return {
    keepRecentTokens: Math.min(keepRecentTokens, Math.floor(limit * 0.25)),
    reserveTokens: Math.max(1, modelWindow - Math.floor(limit * COMPACT_AT)),
    backgroundTokens: 0,
  };
};
