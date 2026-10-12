type SurfaceLike = { readonly id: string; readonly kind: string };

export const browserTabFor = (
  surfaces: readonly SurfaceLike[],
  current: string,
  tool: string,
): string => {
  if (!tool.startsWith('browser_')) return current;

  return surfaces.find((surface) => surface.kind === 'browser')?.id ?? current;
};
