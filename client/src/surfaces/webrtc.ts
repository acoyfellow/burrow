import { socketUrl, spinnerNode } from './dom';

export const webrtcPath = (thread: string) => `/api/threads/${thread}/webrtc`;

const ICE: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];

const MAX_RETRY_MS = 8000;

const KEYSYMS: Record<string, string> = {
  Enter: 'Return',
  Backspace: 'BackSpace',
  Tab: 'Tab',
  Escape: 'Escape',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'Prior',
  PageDown: 'Next',
  Shift: 'Shift_L',
  Control: 'Control_L',
  Alt: 'Alt_L',
  Meta: 'Super_L',
  ' ': 'space',
};

const keysym = (key: string) => KEYSYMS[key] ?? (key.length === 1 ? key : null);

type Signal = {
  readonly sdp?: RTCSessionDescriptionInit;
  readonly ice?: RTCIceCandidateInit;
  readonly error?: string;
};

export const attachWebrtc = (
  host: HTMLElement,
  thread: string,
  onError: (text: string) => void,
): (() => void) => {
  const video = document.createElement('video');
  const status = document.createElement('div');
  const stage = document.createElement('div');
  let socket: WebSocket | null = null;
  let peer: RTCPeerConnection | null = null;
  let stopped = false;
  let retry = 500;
  let timer: ReturnType<typeof setTimeout> | undefined;

  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.tabIndex = 0;
  video.className = 'rtc-video';
  stage.className = 'vnc-stage';
  status.className = 'browser-status';
  status.append(spinnerNode(), document.createTextNode(' Connecting video…'));
  stage.append(video);
  host.replaceChildren(stage, status);

  const send = (message: unknown) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(`${JSON.stringify(message)}\n`);
  };

  const point = (event: MouseEvent) => {
    const rect = video.getBoundingClientRect();
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 800;
    const scale = Math.min(rect.width / width, rect.height / height);
    const left = rect.left + (rect.width - width * scale) / 2;
    const top = rect.top + (rect.height - height * scale) / 2;

    return {
      x: Math.max(0, Math.min(width - 1, (event.clientX - left) / scale)),
      y: Math.max(0, Math.min(height - 1, (event.clientY - top) / scale)),
    };
  };

  let lastMove = 0;
  const onMove = (event: MouseEvent) => {
    const now = performance.now();

    if (now - lastMove < 16) return;

    lastMove = now;
    send({ input: { type: 'move', ...point(event) } });
  };
  const onDown = (event: MouseEvent) => {
    video.focus();
    event.preventDefault();
    send({ input: { type: 'down', button: event.button, ...point(event) } });
  };
  const onUp = (event: MouseEvent) =>
    send({ input: { type: 'up', button: event.button, ...point(event) } });
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    send({ input: { type: 'wheel', dy: event.deltaY } });
  };
  const onKey = (down: boolean) => (event: KeyboardEvent) => {
    const sym = keysym(event.key);

    if (sym === null) return;

    event.preventDefault();
    send({ input: { type: 'key', down, keysym: sym } });
  };
  const onKeyDown = onKey(true);
  const onKeyUp = onKey(false);
  const onPaste = (event: ClipboardEvent) => {
    const text = event.clipboardData?.getData('text/plain');

    if (text) send({ input: { type: 'text', text } });
  };
  const onContext = (event: MouseEvent) => event.preventDefault();

  video.addEventListener('mousemove', onMove);
  video.addEventListener('mousedown', onDown);
  video.addEventListener('mouseup', onUp);
  video.addEventListener('wheel', onWheel, { passive: false });
  video.addEventListener('keydown', onKeyDown);
  video.addEventListener('keyup', onKeyUp);
  video.addEventListener('paste', onPaste);
  video.addEventListener('contextmenu', onContext);

  const teardown = () => {
    peer?.close();
    peer = null;
    socket?.close();
    socket = null;
  };

  const reconnect = () => {
    teardown();

    if (stopped) return;

    status.hidden = false;
    timer = setTimeout(connect, retry);
    retry = Math.min(retry * 2, MAX_RETRY_MS);
  };

  const connect = () => {
    const ws = new WebSocket(socketUrl(webrtcPath(thread)));
    const pc = new RTCPeerConnection({ iceServers: ICE });
    let buffer = '';

    socket = ws;
    peer = pc;
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.ontrack = (event) => {
      video.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      retry = 500;
      status.hidden = true;
    };
    pc.onicecandidate = (event) => {
      if (event.candidate !== null) send({ ice: event.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        onError('The video connection failed. Pick VNC if this keeps happening.');
        reconnect();
      }
    };

    const handle = async (signal: Signal) => {
      if (signal.error !== undefined) {
        onError(signal.error);
        return;
      }

      if (signal.sdp !== undefined) {
        await pc.setRemoteDescription(signal.sdp);
        const answer = await pc.createAnswer();

        await pc.setLocalDescription(answer);
        send({ sdp: pc.localDescription?.toJSON() });
      } else if (signal.ice !== undefined) {
        await pc.addIceCandidate(signal.ice).catch(() => undefined);
      }
    };

    ws.onmessage = (event) => {
      buffer +=
        typeof event.data === 'string'
          ? event.data
          : new TextDecoder().decode(event.data as ArrayBuffer);
      const lines = buffer.split('\n');

      buffer = lines.pop() ?? '';

      for (const line of lines)
        if (line.trim() !== '')
          void handle(JSON.parse(line) as Signal).catch((cause) => onError(String(cause)));
    };
    ws.binaryType = 'arraybuffer';
    ws.onclose = () => {
      if (socket === ws) reconnect();
    };
  };

  connect();

  return () => {
    stopped = true;
    clearTimeout(timer);
    teardown();
    video.removeEventListener('mousemove', onMove);
    video.removeEventListener('mousedown', onDown);
    video.removeEventListener('mouseup', onUp);
    video.removeEventListener('wheel', onWheel);
    video.removeEventListener('keydown', onKeyDown);
    video.removeEventListener('keyup', onKeyUp);
    video.removeEventListener('paste', onPaste);
    video.removeEventListener('contextmenu', onContext);
  };
};
