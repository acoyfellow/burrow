import { browserPath } from '../../../shared/protocol';
import { socketUrl, spinnerNode } from './dom';

declare global {
  interface Window {
    __coilFrames?: number;
  }
}

const KEYS: Record<string, number> = {
  Enter: 13,
  Tab: 9,
  Escape: 27,
  Backspace: 8,
  Delete: 46,
  ArrowUp: 38,
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
};

type Viewport = { width: number; height: number };

type ServerNote = {
  readonly viewport?: Viewport;
  readonly page?: { readonly url: string; readonly title: string };
  readonly error?: string;
};

const MAX_RETRY_MS = 8000;

const button = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
  const element = document.createElement('button');

  element.textContent = label;
  element.title = title;
  element.setAttribute('aria-label', title);
  element.onclick = onClick;

  return element;
};

const parseNote = (raw: string): ServerNote => {
  const parsed: unknown = JSON.parse(raw);

  return typeof parsed === 'object' && parsed !== null ? (parsed as ServerNote) : {};
};

export const attachBrowser = (
  host: HTMLElement,
  thread: string,
  onError: (text: string) => void,
): (() => void) => {
  const url = document.createElement('input');
  const canvas = document.createElement('canvas');
  const status = document.createElement('div');
  const stage = document.createElement('div');
  const context = canvas.getContext('2d');
  let viewport: Viewport = { width: 1280, height: 800 };
  let socket: WebSocket | null = null;
  let closed = false;
  let retry = 0;
  let lastFrame: ImageBitmap | null = null;
  let sized = '';
  let fitTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const send = (message: unknown) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  url.className = 'url';
  url.autocomplete = 'off';
  url.spellcheck = false;
  url.placeholder = 'localhost:3000 or a URL';
  canvas.className = 'screen';
  canvas.tabIndex = 0;
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  status.className = 'term-status';
  status.replaceChildren(spinnerNode(), 'Starting the browser');
  stage.className = 'stage';
  stage.append(canvas, status);

  const go = () => {
    const target = url.value.trim();

    if (target === '') return;

    send({ open: target });
    canvas.focus();
  };

  url.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') go();
  });

  const bar = document.createElement('div');

  bar.className = 'urlbar';
  bar.append(
    button('←', 'Back', () => send({ back: true })),
    button('↻', 'Reload', () => send({ reload: true })),
    url,
  );
  host.replaceChildren(bar, stage);

  const paint = () => {
    if (lastFrame !== null) context?.drawImage(lastFrame, 0, 0, canvas.width, canvas.height);
  };

  const resizeCanvas = (next: Viewport) => {
    viewport = next;

    if (canvas.width === next.width && canvas.height === next.height) return;

    canvas.width = next.width;
    canvas.height = next.height;
    paint();
  };

  const point = (event: MouseEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();

    return [
      Math.round(((event.clientX - rect.left) * viewport.width) / rect.width),
      Math.round(((event.clientY - rect.top) * viewport.height) / rect.height),
    ];
  };

  canvas.addEventListener('mousedown', (event) => {
    canvas.focus();
    send({ click: point(event) });
    event.preventDefault();
  });
  canvas.addEventListener(
    'wheel',
    (event) => {
      const [x, y] = point(event);

      send({ scroll: [x, y, event.deltaX, event.deltaY] });
      event.preventDefault();
    },
    { passive: false },
  );
  canvas.addEventListener('keydown', (event) => {
    if (event.metaKey) return;

    const modifiers = (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.shiftKey ? 8 : 0);
    const keyCode = KEYS[event.key] ?? event.key.toUpperCase().charCodeAt(0);

    if (event.key.length === 1 && !event.ctrlKey && !event.altKey) send({ text: event.key });
    else if (KEYS[event.key] !== undefined || event.ctrlKey) {
      send({ key: { type: 'keyDown', key: event.key, code: event.code, keyCode, modifiers } });
      send({ key: { type: 'keyUp', key: event.key, code: event.code, keyCode, modifiers } });
    } else return;

    event.preventDefault();
  });
  canvas.addEventListener('paste', (event) => {
    const text = event.clipboardData?.getData('text') ?? '';

    if (text !== '') send({ text });
    event.preventDefault();
  });

  const fitViewport = () => {
    const width = Math.round(stage.clientWidth);
    const height = Math.round(stage.clientHeight);

    if (width < 50 || height < 50) return;

    const next = `${width}x${height}`;

    if (next === sized) return;

    sized = next;
    send({ viewport: [width, height] });
  };

  const observer = new ResizeObserver(() => {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(fitViewport, 150);
  });

  observer.observe(stage);

  const open = () => {
    if (closed) return;

    const ws = new WebSocket(socketUrl(browserPath(thread)));

    ws.binaryType = 'blob';
    socket = ws;
    ws.onmessage = async (incoming: MessageEvent<string | Blob>) => {
      if (typeof incoming.data === 'string') {
        const note = parseNote(incoming.data);

        if (note.viewport !== undefined) resizeCanvas(note.viewport);
        if (note.page !== undefined && document.activeElement !== url)
          url.value = note.page.url === 'about:blank' ? '' : note.page.url;
        if (note.error !== undefined) onError(note.error);
        if (note.page !== undefined && note.viewport !== undefined) {
          sized = '';
          fitViewport();
        }

        retry = 0;
        status.hidden = true;

        return;
      }

      const bitmap = await createImageBitmap(incoming.data);

      lastFrame?.close();
      lastFrame = bitmap;
      paint();
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ seen: true }));
      globalThis.window.__coilFrames = (globalThis.window.__coilFrames ?? 0) + 1;
      status.hidden = true;
    };
    ws.onclose = () => {
      socket = null;

      if (closed) return;

      retry += 1;
      status.hidden = false;
      status.replaceChildren(spinnerNode(), 'Reconnecting to the browser…');
      retryTimer = setTimeout(open, Math.min(MAX_RETRY_MS, 500 * 2 ** retry));
    };
  };

  open();

  return () => {
    closed = true;
    clearTimeout(fitTimer);
    clearTimeout(retryTimer);
    observer.disconnect();
    socket?.close();
    lastFrame?.close();
  };
};
