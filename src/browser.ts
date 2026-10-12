import { SHELL_ENV } from './env';

export const VIEWPORT = { width: 1280, height: 800 } as const;

export type BrowserMode = 'screencast' | 'vnc' | 'webrtc';

export const BROWSER_MODES: readonly BrowserMode[] = ['screencast', 'vnc', 'webrtc'];

export const VNC_PORT = 5900;

export const DISPLAY = ':99';

const chromium = (headed: boolean) =>
  [
    '/usr/bin/chromium',
    ...(headed
      ? ['--start-maximized', '--window-position=0,0']
      : ['--headless=new', '--disable-gpu']),
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-pipe',
    `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    '--user-data-dir=/root/.browser',
    'about:blank',
  ].join(' ');

const startDisplay = [
  'pkill -x Xvfb; pkill -x x11vnc; pkill -x openbox; true',
  'rm -f /tmp/.X99-lock /tmp/.X11-unix/X99',
  `Xvfb ${DISPLAY} -screen 0 ${VIEWPORT.width}x${VIEWPORT.height}x24 -nolisten tcp -ac >/tmp/xvfb.log 2>&1 &`,
  'for i in $(seq 1 50); do [ -e /tmp/.X11-unix/X99 ] && break; sleep 0.1; done',
  `DISPLAY=${DISPLAY} openbox >/tmp/openbox.log 2>&1 &`,
  `x11vnc -display ${DISPLAY} -rfbport ${VNC_PORT} -localhost -forever -shared -nopw -noxdamage -quiet >/tmp/x11vnc.log 2>&1 &`,
].join('\n');

export const browserArgs = (mode: BrowserMode = 'screencast') =>
  mode === 'screencast'
    ? ['bash', '-c', `exec ${chromium(false)} 3<&0 4>&1 1>&2 2>/tmp/browser.log`]
    : [
        'bash',
        '-c',
        `${startDisplay}\nDISPLAY=${DISPLAY} exec ${chromium(true)} 3<&0 4>&1 1>&2 2>/tmp/browser.log`,
      ];

export const browserEnv = () => ({ ...SHELL_ENV, HOME: '/root' });

type CdpMessage = {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message: string };
  sessionId?: string;
};

export type Frame = { readonly bytes: Uint8Array; readonly width: number; readonly height: number };

const fromBase64 = (data: string) => Uint8Array.from(atob(data), (c) => c.charCodeAt(0));

export type PageState = { readonly url: string; readonly title: string };

export const nulFrames = () => {
  const decoder = new TextDecoder();
  let pending = '';

  return (chunk: Uint8Array): string[] => {
    pending += decoder.decode(chunk, { stream: true });
    const parts = pending.split('\0');

    pending = parts.pop() ?? '';

    return parts.filter((part) => part !== '');
  };
};

export const normalizeUrl = (input: string) => {
  const url = input.trim();

  return /^(https?|about|data|file):/i.test(url) ? url : `http://${url}`;
};

const LOG_LINES = 200;

export class Browser {
  private next = 0;
  private readonly waiting = new Map<number, (m: CdpMessage) => void>();
  private readonly input: WritableStreamDefaultWriter<Uint8Array>;
  private readonly encoder = new TextEncoder();
  private session = '';
  private casting = false;
  private closed = false;
  readonly frames = new Set<(frame: Frame) => void>();
  private pendingAck: number | null = null;
  private readonly busyViewers = new Set<object>();
  readonly closedListeners = new Set<() => void>();
  readonly pages = new Set<(page: PageState) => void>();
  page: PageState = { url: 'about:blank', title: '' };
  last: Frame | null = null;

  constructor(
    process: ExecProcess,
    private readonly abort: AbortController,
  ) {
    if (process.stdin === null || process.stdout === null)
      throw new Error('Chromium did not return its pipes');

    this.input = process.stdin.getWriter();
    this.pump(process.stdout as ReadableStream<Uint8Array>).catch(() => this.fail());
    process.exitCode.then(
      () => this.fail(),
      () => this.fail(),
    );
  }

  static async launch(container: Container, mode: BrowserMode = 'screencast'): Promise<Browser> {
    const abort = new AbortController();
    const process = await container.exec(browserArgs(mode), {
      env: browserEnv(),
      cwd: '/root',
      signal: abort.signal,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const browser = new Browser(process, abort);

    await browser.attach();

    return browser;
  }

  get alive() {
    return !this.closed;
  }

  private fail() {
    if (this.closed) return;

    this.closed = true;

    for (const listener of this.closedListeners) listener();

    for (const resolve of this.waiting.values()) resolve({ error: { message: 'browser exited' } });

    this.waiting.clear();
  }

  private async pump(stdout: ReadableStream<Uint8Array>) {
    const split = nulFrames();

    const processEnded = () => this.fail();

    try {
      for await (const chunk of stdout)
        for (const text of split(chunk)) this.dispatch(JSON.parse(text) as CdpMessage);
    } finally {
      processEnded();
    }
  }

  private dispatch(message: CdpMessage) {
    if (message.id !== undefined) {
      this.waiting.get(message.id)?.(message);
      this.waiting.delete(message.id);

      return;
    }

    if (message.method === 'Page.screencastFrame') {
      const params = message.params as {
        data: string;
        sessionId: number;
        metadata: { deviceWidth: number; deviceHeight: number };
      };

      this.last = {
        bytes: fromBase64(params.data),
        width: params.metadata.deviceWidth,
        height: params.metadata.deviceHeight,
      };

      for (const listener of this.frames) listener(this.last);

      this.pendingAck = params.sessionId;
      this.ackIfViewersReady();

      return;
    }

    if (
      message.method === 'Page.frameNavigated' &&
      (message.params as { frame?: { parentId?: string } })?.frame?.parentId === undefined
    ) {
      void this.refreshPage();

      return;
    }

    if (message.method === 'Page.loadEventFired') void this.refreshPage();

    if (message.method === 'Runtime.consoleAPICalled') {
      const params = message.params as {
        type?: string;
        args?: { value?: unknown; description?: string }[];
      };
      const text = (params.args ?? [])
        .map((arg) => (arg.value === undefined ? (arg.description ?? '') : String(arg.value)))
        .join(' ');

      this.remember(`[${params.type ?? 'log'}] ${text}`);
    }

    if (message.method === 'Runtime.exceptionThrown') {
      const params = message.params as {
        exceptionDetails?: { text?: string; exception?: { description?: string } };
      };

      this.remember(
        `[error] ${params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? 'exception'}`,
      );
    }
  }

  private logs: string[] = [];

  private remember(line: string) {
    this.logs.push(line.slice(0, 2000));
    if (this.logs.length > LOG_LINES) this.logs.splice(0, this.logs.length - LOG_LINES);
  }

  consoleLogs(clear: boolean): string[] {
    const lines = [...this.logs];

    if (clear) this.logs = [];

    return lines;
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
    browserLevel = false,
  ): Promise<CdpMessage> {
    if (this.closed) return Promise.resolve({ error: { message: 'browser exited' } });

    const id = ++this.next;
    const message = { id, method, params, ...(browserLevel ? {} : { sessionId: this.session }) };

    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.input
        .write(this.encoder.encode(`${JSON.stringify(message)}\0`))
        .catch(() => resolve({ error: { message: 'browser pipe closed' } }));
    });
  }

  private async call(method: string, params: Record<string, unknown> = {}) {
    const reply = await this.send(method, params);

    if (reply.error) throw new Error(`${method}: ${reply.error.message}`);

    return reply.result ?? {};
  }

  private async attach() {
    const targets = await this.send('Target.getTargets', {}, true);
    const infos = (targets.result?.targetInfos ?? []) as { targetId: string; type: string }[];
    const page = infos.find((t) => t.type === 'page');
    const targetId =
      page?.targetId ??
      ((await this.send('Target.createTarget', { url: 'about:blank' }, true)).result
        ?.targetId as string);
    const attached = await this.send('Target.attachToTarget', { targetId, flatten: true }, true);

    this.session = attached.result?.sessionId as string;
    await this.call('Page.enable');
    await this.call('Runtime.enable');
    await this.call('Emulation.setDeviceMetricsOverride', {
      ...VIEWPORT,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }

  private async refreshPage() {
    const reply = await this.send('Runtime.evaluate', {
      expression: 'JSON.stringify([location.href, document.title])',
      returnByValue: true,
    });
    const value = (reply.result?.result as { value?: string } | undefined)?.value;

    if (value === undefined) return;

    const [url, title] = JSON.parse(value) as [string, string];

    this.page = { url, title };

    for (const listener of this.pages) listener(this.page);
  }

  viewport: { width: number; height: number } = { ...VIEWPORT };

  async resize(width: number, height: number) {
    const w = Math.max(320, Math.min(1920, Math.round(width)));
    const h = Math.max(240, Math.min(1400, Math.round(height)));

    if (w === this.viewport.width && h === this.viewport.height) return this.viewport;

    this.viewport = { width: w, height: h };
    await this.call('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: 1,
      mobile: w < 600,
    });

    if (this.casting) {
      await this.call('Page.stopScreencast');
      await this.call('Page.startScreencast', {
        format: 'jpeg',
        quality: 60,
        maxWidth: w,
        maxHeight: h,
        everyNthFrame: 1,
      });
      await this.paintNow();
    }

    return this.viewport;
  }

  viewerBusy(viewer: object) {
    this.busyViewers.add(viewer);
  }

  viewerReady(viewer: object) {
    this.busyViewers.delete(viewer);
    this.ackIfViewersReady();
  }

  private ackIfViewersReady() {
    if (this.pendingAck === null || this.busyViewers.size > 0) return;

    const sessionId = this.pendingAck;

    this.pendingAck = null;
    void this.send('Page.screencastFrameAck', { sessionId });
  }

  async paintNow() {
    const shot = (await this.call('Page.captureScreenshot', { format: 'jpeg', quality: 60 })) as {
      data?: string;
    };
    const data = shot.data;

    if (data === undefined) return;

    this.last = {
      bytes: fromBase64(data),
      width: this.viewport.width,
      height: this.viewport.height,
    };

    for (const listener of this.frames) listener(this.last);
  }

  async cast(on: boolean) {
    if (on === this.casting) return;

    this.casting = on;

    if (on)
      await this.call('Page.startScreencast', {
        format: 'jpeg',
        quality: 60,
        maxWidth: this.viewport.width,
        maxHeight: this.viewport.height,
        everyNthFrame: 1,
      });
    else await this.call('Page.stopScreencast');
  }

  async open(url: string): Promise<PageState> {
    const target = normalizeUrl(url);
    const loaded = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 15_000);
      const listener = () => {
        clearTimeout(timer);
        this.pages.delete(listener);
        resolve();
      };

      this.pages.add(listener);
    });
    const reply = await this.call('Page.navigate', { url: target });

    if (typeof reply.errorText === 'string' && reply.errorText !== '')
      throw new Error(`Could not open ${target}: ${reply.errorText}`);

    await loaded;
    await this.refreshPage();

    return this.page;
  }

  async back() {
    await this.call('Runtime.evaluate', { expression: 'history.back()' });
  }

  async reload() {
    await this.call('Page.reload');
  }

  async click(x: number, y: number) {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
      await this.call('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }

  async scroll(x: number, y: number, dx: number, dy: number) {
    await this.call('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x,
      y,
      deltaX: dx,
      deltaY: dy,
    });
  }

  async key(event: {
    type: 'keyDown' | 'keyUp' | 'char';
    key?: string;
    code?: string;
    text?: string;
    keyCode?: number;
    modifiers?: number;
  }) {
    await this.call('Input.dispatchKeyEvent', {
      type: event.type,
      key: event.key,
      code: event.code,
      text: event.text,
      windowsVirtualKeyCode: event.keyCode,
      modifiers: event.modifiers ?? 0,
    });
  }

  async type(text: string) {
    await this.call('Input.insertText', { text });
  }

  async evaluate(expression: string): Promise<string> {
    const reply = await this.call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    const exception = reply.exceptionDetails as { text?: string } | undefined;

    if (exception) throw new Error(exception.text ?? 'evaluation failed');

    const value = (reply.result as { value?: unknown } | undefined)?.value;

    return typeof value === 'string' ? value : JSON.stringify(value ?? null);
  }

  async snapshot(): Promise<string> {
    return this.evaluate(`(() => {
      const out = [];
      let n = 0;
      document.querySelectorAll('[data-coil-ref]').forEach((el) => el.removeAttribute('data-coil-ref'));
      for (const el of document.querySelectorAll('a,button,input,textarea,select,[role=button],[onclick],summary,label')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight) continue;
        const ref = 'e' + (++n);
        el.setAttribute('data-coil-ref', ref);
        const text = (el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || el.title || '').trim().replace(/\\s+/g, ' ').slice(0, 80);
        out.push(ref + ' ' + el.tagName.toLowerCase() + (el.type ? '[' + el.type + ']' : '') + ' "' + text + '" @' + Math.round(r.x + r.width / 2) + ',' + Math.round(r.y + r.height / 2));
        if (n >= 80) break;
      }
      const body = (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 2500);
      return 'url: ' + location.href + '\\ntitle: ' + document.title + '\\n\\n' + out.join('\\n') + '\\n\\ntext:\\n' + body;
    })()`);
  }

  async clickRef(ref: string) {
    const at = await this.evaluate(
      `(() => { const el = document.querySelector('[data-coil-ref="${ref.replace(/[^a-z0-9]/gi, '')}"]'); if (!el) return ''; el.scrollIntoView({block:'center'}); const r = el.getBoundingClientRect(); return Math.round(r.x + r.width / 2) + ',' + Math.round(r.y + r.height / 2); })()`,
    );

    if (at === '') throw new Error(`No element ${ref}. Take a new snapshot.`);

    const [x, y] = at.split(',').map(Number);

    await this.click(x ?? 0, y ?? 0);
  }

  async screenshot(): Promise<string> {
    const shot = await this.call('Page.captureScreenshot', { format: 'jpeg', quality: 70 });

    return shot.data as string;
  }

  close() {
    this.fail();
    this.abort.abort();
  }
}
