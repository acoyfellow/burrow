import { Effect } from 'effect';
import { client } from '../rpc';
import { attachBrowser } from './browser';
import { attachVnc } from './vnc';
import { attachWebrtc } from './webrtc';

type Mode = 'screencast' | 'vnc' | 'webrtc';

const MODES: readonly { readonly mode: Mode; readonly label: string; readonly hint: string }[] = [
  {
    mode: 'screencast',
    label: 'Screencast',
    hint: 'Headless Chromium streamed as images. Lightest.',
  },
  {
    mode: 'vnc',
    label: 'VNC',
    hint: 'Real Chromium window over VNC. Right-click and DevTools work.',
  },
  { mode: 'webrtc', label: 'WebRTC', hint: 'Real Chromium window as live video. Smoothest.' },
];

const viewerFor = (mode: Mode) =>
  mode === 'vnc' ? attachVnc : mode === 'webrtc' ? attachWebrtc : attachBrowser;

const picker = (current: Mode, choose: (mode: Mode) => void): HTMLElement => {
  const select = document.createElement('select');

  select.className = 'browser-mode';
  select.title = 'How the browser is shown';
  select.setAttribute('aria-label', 'Browser mode');

  for (const option of MODES) {
    const element = document.createElement('option');

    element.value = option.mode;
    element.textContent = option.label;
    element.title = option.hint;
    element.selected = option.mode === current;
    select.append(element);
  }

  select.onchange = () => choose(select.value as Mode);

  return select;
};

export const attachBrowserHost = (
  host: HTMLElement,
  thread: string,
  onError: (text: string) => void,
): (() => void) => {
  const top = document.createElement('div');
  const body = document.createElement('div');
  let detach: () => void = () => undefined;
  let stopped = false;

  top.className = 'browser-modes';
  body.className = 'browser-body';
  host.replaceChildren(top, body);

  const show = (mode: Mode) => {
    detach();
    top.replaceChildren(picker(mode, (next) => void change(next)));
    detach = viewerFor(mode)(body, thread, onError);
  };

  const change = async (next: Mode) => {
    detach();
    detach = () => undefined;
    body.replaceChildren(document.createTextNode('Restarting the browser…'));

    try {
      const mode = await Effect.runPromise(client.SetBrowserMode({ name: thread, mode: next }));

      if (!stopped) show(mode);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  Effect.runPromise(client.GetBrowserMode({ name: thread })).then(
    (mode) => {
      if (!stopped) show(mode);
    },
    () => {
      if (!stopped) show('screencast');
    },
  );

  return () => {
    stopped = true;
    detach();
  };
};
