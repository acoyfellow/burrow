export type Edge = 'side' | 'panel';

export type Layout = {
  readonly side: number;
  readonly panel: number;
  readonly sideHidden: boolean;
  readonly panelHidden: boolean;
};

export const MOBILE_MAX = 720;

export const MAIN_MIN = 360;

const KEY = 'coil.layout';

const LIMITS: Record<Edge, { readonly min: number; readonly max: number; readonly start: number }> =
  {
    side: { min: 180, max: 420, start: 248 },
    panel: { min: 320, max: 1600, start: 480 },
  };

const DEFAULT: Layout = {
  side: LIMITS.side.start,
  panel: LIMITS.panel.start,
  sideHidden: false,
  panelHidden: false,
};

const hiddenKey = (edge: Edge) => (edge === 'side' ? 'sideHidden' : 'panelHidden');

export const clampWidth = (edge: Edge, width: number): number =>
  Math.round(Math.min(LIMITS[edge].max, Math.max(LIMITS[edge].min, width)));

export const readLayout = (raw: string | null): Layout => {
  if (raw === null) return DEFAULT;

  try {
    const parsed = JSON.parse(raw) as Partial<Layout>;

    return {
      side: clampWidth('side', Number(parsed.side ?? DEFAULT.side)),
      panel: clampWidth('panel', Number(parsed.panel ?? DEFAULT.panel)),
      sideHidden: parsed.sideHidden === true,
      panelHidden: parsed.panelHidden === true,
    };
  } catch {
    return DEFAULT;
  }
};

export type Fitted = { readonly side: number; readonly panel: number };

const shrink = (width: number, over: number, min: number): [number, number] => {
  if (over <= 0 || width === 0) return [width, over];

  const cut = Math.min(over, Math.max(0, width - min));

  return [width - cut, over - cut];
};

export const fitColumns = (layout: Layout, viewport: number): Fitted => {
  if (viewport <= MOBILE_MAX) return { side: 0, panel: 0 };

  const side = layout.sideHidden ? 0 : layout.side;
  const panel = layout.panelHidden ? 0 : layout.panel;
  const over = side + panel + MAIN_MIN - viewport;
  const [fitPanel, left] = shrink(panel, over, LIMITS.panel.min);
  const [fitSide, rest] = shrink(side, left, LIMITS.side.min);

  if (rest <= 0) return { side: fitSide, panel: fitPanel };

  if (panel > 0) return fitColumns({ ...layout, panelHidden: true }, viewport);

  return { side: 0, panel: 0 };
};

export const toggled = (layout: Layout, edge: Edge, viewport: number): Layout => {
  const visible = fitColumns(layout, viewport)[edge] > 0;

  if (visible) return { ...layout, [hiddenKey(edge)]: true };

  const opened = { ...layout, [hiddenKey(edge)]: false };

  if (fitColumns(opened, viewport)[edge] > 0) return opened;

  return { ...opened, [hiddenKey(edge === 'side' ? 'panel' : 'side')]: true };
};

export const dragged = (layout: Layout, edge: Edge, wanted: number, viewport: number): Layout => {
  const other = fitColumns(layout, viewport)[edge === 'side' ? 'panel' : 'side'];
  const room = viewport - other - MAIN_MIN;

  return { ...layout, [edge]: clampWidth(edge, Math.min(wanted, room)) };
};

let layout: Layout = DEFAULT;

const viewport = () => globalThis.innerWidth;

const apply = () => {
  const root = document.documentElement;
  const fitted = fitColumns(layout, viewport());

  root.style.setProperty('--side-w', `${fitted.side}px`);
  root.style.setProperty('--panel-w', `${fitted.panel}px`);
  root.classList.toggle('side-hidden', fitted.side === 0);
  root.classList.toggle('panel-hidden', fitted.panel === 0);
};

const save = (next: Layout) => {
  layout = next;
  apply();
  localStorage.setItem(KEY, JSON.stringify(layout));
};

const startDrag = (edge: Edge, handle: HTMLElement, event: PointerEvent) => {
  const startX = event.clientX;
  const startWidth = fitColumns(layout, viewport())[edge];
  const direction = edge === 'side' ? 1 : -1;

  event.preventDefault();
  handle.classList.add('active');
  document.documentElement.classList.add('resizing');

  const move = (next: PointerEvent) => {
    layout = dragged(layout, edge, startWidth + (next.clientX - startX) * direction, viewport());
    apply();
  };
  const end = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', end);
    document.removeEventListener('pointercancel', end);
    handle.classList.remove('active');
    document.documentElement.classList.remove('resizing');
    save(layout);
  };

  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
};

const closest = (target: EventTarget | null, selector: string): HTMLElement | null =>
  target instanceof Element ? target.closest<HTMLElement>(selector) : null;

const edgeAttr = (element: HTMLElement | null, name: 'resize' | 'collapse'): Edge | null => {
  const value = element?.dataset[name];

  return value === 'side' || value === 'panel' ? value : null;
};

export const installLayout = () => {
  layout = readLayout(localStorage.getItem(KEY));
  apply();
  globalThis.addEventListener('resize', apply);

  document.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || viewport() <= MOBILE_MAX) return;

    const handle = closest(event.target, '[data-resize]');
    const edge = edgeAttr(handle, 'resize');

    if (handle !== null && edge !== null) startDrag(edge, handle, event);
  });
  document.addEventListener('dblclick', (event) => {
    const edge = edgeAttr(closest(event.target, '[data-resize]'), 'resize');

    if (edge !== null) save({ ...layout, [edge]: LIMITS[edge].start });
  });
  document.addEventListener('click', (event) => {
    const edge = edgeAttr(closest(event.target, '[data-collapse]'), 'collapse');

    if (edge !== null) save(toggled(layout, edge, viewport()));
  });
  document.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
    if (viewport() <= MOBILE_MAX) return;

    const edge = event.key === 'b' ? 'side' : event.key === 'j' ? 'panel' : null;

    if (edge === null) return;

    event.preventDefault();
    save(toggled(layout, edge, viewport()));
  });
};
