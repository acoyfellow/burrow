export const attachWebrtc = (
  host: HTMLElement,
  _thread: string,
  _onError: (text: string) => void,
): (() => void) => {
  const note = document.createElement('div');

  note.className = 'browser-status';
  note.textContent =
    'WebRTC streaming is being built. Pick VNC for a real Chromium window with right-click and DevTools.';
  host.replaceChildren(note);

  return () => undefined;
};
