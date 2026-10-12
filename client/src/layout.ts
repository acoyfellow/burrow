export type Edge = 'side' | 'panel';

type Layout = {
  readonly side: number;
  readonly panel: number;
  readonly sideHidden: boolean;
  readonly panelHidden: boolean;
};

const KEY = 'coil.layout';

const LIMITS: Record<Edge, { readonly min: number; readonly max: number; readonly start: number }> =
  {
    side: { min: 180, max: 480, start: 248 },
    panel: { min: 300, max: 1400, start: 440 },
  };

const DEFAULT: Layout = {
  side: LIMITS.side.start,
  panel: LIMITS.panel.start,
  sideHidden: false,
  panelHidden: false,
};

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

let layout: Layout = DEFAULT;

const apply = () => {
  const root = document.documentElement;

  root.style.setProperty('--side-w', `${layout.side}px`);
  root.style.setProperty('--panel-w', `${layout.panel}px`);
  root.classList.toggle('side-hidden', layout.sideHidden);
  root.classList.toggle('panel-hidden', layout.panelHidden);
};

const save = (next: Layout) => {
  layout = next;
  apply();
  localStorage.setItem(KEY, JSON.stringify(layout));
};

export const toggleEdge = (edge: Edge) =>
  save(
    edge === 'side'
      ? { ...layout, sideHidden: !layout.sideHidden }
      : { ...layout, panelHidden: !layout.panelHidden },
  );

const startDrag = (edge: Edge, event: PointerEvent) => {
  const handle = event.currentTarget as HTMLElement;
  const startX = event.clientX;
  const startWidth = layout[edge];
  const direction = edge === 'side' ? 1 : -1;

  event.preventDefault();
  handle.setPointerCapture(event.pointerId);
  document.documentElement.classList.add('resizing');

  const move = (next: PointerEvent) => {
    layout = {
      ...layout,
      [edge]: clampWidth(edge, startWidth + (next.clientX - startX) * direction),
    };
    apply();
  };
  const end = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', end);
    handle.removeEventListener('pointercancel', end);
    document.documentElement.classList.remove('resizing');
    save(layout);
  };

  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
};

const edgeOf = (target: EventTarget | null): Edge | null => {
  const element =
    target instanceof Element ? target.closest<HTMLElement>('[data-resize],[data-collapse]') : null;
  const value = element?.dataset.resize ?? element?.dataset.collapse;

  return value === 'side' || value === 'panel' ? value : null;
};

export const installLayout = () => {
  layout = readLayout(localStorage.getItem(KEY));
  apply();

  document.addEventListener('pointerdown', (event) => {
    const target =
      event.target instanceof Element ? event.target.closest<HTMLElement>('[data-resize]') : null;
    const edge = edgeOf(target);

    if (target !== null && edge !== null) startDrag(edge, event);
  });
  document.addEventListener('dblclick', (event) => {
    const target =
      event.target instanceof Element ? event.target.closest<HTMLElement>('[data-resize]') : null;
    const edge = edgeOf(target);

    if (target !== null && edge !== null) save({ ...layout, [edge]: LIMITS[edge].start });
  });
  document.addEventListener('click', (event) => {
    const target =
      event.target instanceof Element ? event.target.closest<HTMLElement>('[data-collapse]') : null;
    const edge = edgeOf(target);

    if (target !== null && edge !== null) toggleEdge(edge);
  });
  document.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;

    if (event.key === 'b') {
      event.preventDefault();
      toggleEdge('side');
    } else if (event.key === 'j' || event.key === '.') {
      event.preventDefault();
      toggleEdge('panel');
    }
  });
};
