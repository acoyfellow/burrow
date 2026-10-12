import { browserPath } from '../../../shared/protocol';
import { socketUrl } from './dom';
import { attachVnc } from './vnc';

type ServerNote = {
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
  const bar = document.createElement('div');
  const body = document.createElement('div');
  let socket: WebSocket | null = null;
  let closed = false;
  let retry = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const send = (message: unknown) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  url.className = 'url';
  url.autocomplete = 'off';
  url.spellcheck = false;
  url.enterKeyHint = 'go';
  url.placeholder = 'localhost:3000 or a URL';
  url.setAttribute('aria-label', 'Address');
  url.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;

    const target = url.value.trim();

    if (target !== '') send({ open: target });
    url.blur();
  });
  url.addEventListener('focus', () => url.select());

  bar.className = 'urlbar';
  bar.append(
    button('←', 'Back', () => send({ back: true })),
    button('→', 'Forward', () => send({ forward: true })),
    button('↻', 'Reload', () => send({ reload: true })),
    url,
    button('+', 'New tab', () => send({ tab: true })),
  );
  body.className = 'browser-body';
  host.replaceChildren(bar, body);

  const detachVnc = attachVnc(body, thread, onError);

  const open = () => {
    if (closed) return;

    const ws = new WebSocket(socketUrl(browserPath(thread)));

    socket = ws;
    ws.onmessage = (incoming: MessageEvent<string>) => {
      const note = parseNote(incoming.data);

      retry = 0;

      if (note.page !== undefined && document.activeElement !== url)
        url.value = note.page.url === 'about:blank' ? '' : note.page.url;
      if (note.error !== undefined) onError(note.error);
    };
    ws.onclose = () => {
      socket = null;

      if (closed) return;

      retry += 1;
      retryTimer = setTimeout(open, Math.min(MAX_RETRY_MS, 500 * 2 ** retry));
    };
  };

  open();

  return () => {
    closed = true;
    clearTimeout(retryTimer);
    socket?.close();
    detachVnc();
  };
};
