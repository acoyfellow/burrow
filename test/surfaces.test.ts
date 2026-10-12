import { describe, expect, it } from 'vitest';
import { Browser, normalizeUrl, nulFrames } from '../src/browser';
import { inWorkspace } from '../src/env';
import {
  bounded,
  boundedShell,
  HUMAN_LIMIT_SECONDS,
  OUTPUT_CAP_BYTES,
  RUN_LIMIT_SECONDS,
  TIMED_OUT_EXIT,
} from '../src/shell';
import { parseSize, resizeRequest, SESSION, tmuxArgs } from '../src/terminal';

describe('browser pipe framing', () => {
  it('splits NUL-separated CDP messages across chunk boundaries', () => {
    const split = nulFrames();
    const encode = (s: string) => new TextEncoder().encode(s);

    expect(split(encode('{"id":1}\0{"id"'))).toEqual(['{"id":1}']);
    expect(split(encode(':2}\0'))).toEqual(['{"id":2}']);
    expect(split(encode(''))).toEqual([]);
  });

  it('keeps multi-byte characters split across chunks intact', () => {
    const split = nulFrames();
    const bytes = new TextEncoder().encode('{"t":"é"}\0');

    expect(split(bytes.slice(0, 7))).toEqual([]);
    expect(split(bytes.slice(7))).toEqual(['{"t":"é"}']);
  });
});

describe('browser URLs', () => {
  it('treats host:port as a host, not a scheme', () => {
    expect(normalizeUrl('localhost:8080')).toBe('http://localhost:8080');
    expect(normalizeUrl(' example.com/a ')).toBe('http://example.com/a');
  });

  it('keeps real schemes', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com');
    expect(normalizeUrl('about:blank')).toBe('about:blank');
  });
});

describe('terminal sessions', () => {
  it('accepts sane sizes and rejects bad ones', () => {
    expect(parseSize('80', '24')).toEqual({ cols: 80, rows: 24 });
    expect(parseSize(1, 24)).toBeNull();
    expect(parseSize(80, 9999)).toBeNull();
    expect(parseSize('8.5', 24)).toBeNull();
  });

  it('reads resize control frames and ignores junk', () => {
    expect(resizeRequest('{"resize":[120,40]}')).toEqual({ cols: 120, rows: 40 });
    expect(resizeRequest('not json')).toBeNull();
    expect(resizeRequest('{"resize":[0,0]}')).toBeNull();
  });

  it('only allows plain session names', () => {
    expect(SESSION.test('t1')).toBe(true);
    expect(SESSION.test('t1;rm')).toBe(false);
    expect(SESSION.test('a.b')).toBe(false);
  });

  it('passes the session name as an argument, never inside the script', () => {
    const args = tmuxArgs('t2');

    expect(args.at(-1)).toBe('t2');
    expect(args[2]).not.toContain('t2');
    expect(args[2]).toContain('new-session -A');
    expect(args[2]).toContain('capture-pane');
  });
});

describe('bounded shell', () => {
  it('wraps the command with a time limit, no stdin, and capped output', () => {
    const argv = boundedShell('npm run dev &');

    expect(argv.slice(0, 2)).toEqual(['bash', '-c']);
    expect(argv.slice(3)).toEqual([
      'bounded',
      String(RUN_LIMIT_SECONDS),
      'bash',
      '-lc',
      'npm run dev &',
    ]);
    expect(argv[2]).toContain('timeout --kill-after=5 "$limit" "$@"');
    expect(argv[2]).toContain(`head -c ${OUTPUT_CAP_BYTES}`);
    expect(TIMED_OUT_EXIT).toBe(124);
  });

  it('gives humans a longer limit than the agent', () => {
    expect(bounded(['ls'], HUMAN_LIMIT_SECONDS)[4]).toBe(String(HUMAN_LIMIT_SECONDS));
    expect(HUMAN_LIMIT_SECONDS).toBeGreaterThan(RUN_LIMIT_SECONDS);
  });
});

describe('workspace paths', () => {
  it('keeps dot-files and dot-folders such as .git', () => {
    expect(inWorkspace('.git')).toBe('/workspace/.git');
    expect(inWorkspace('.github/workflows')).toBe('/workspace/.github/workflows');
    expect(inWorkspace('./src/a.ts')).toBe('/workspace/src/a.ts');
    expect(inWorkspace('.')).toBe('/workspace');
    expect(inWorkspace('')).toBe('/workspace');
    expect(inWorkspace('/etc/hosts')).toBe('/etc/hosts');
  });
});

describe('closing the browser', () => {
  const fakeChromium = () => {
    const stdout = new TransformStream<Uint8Array, Uint8Array>();
    const stdin = new WritableStream<Uint8Array>();
    let exit: (code: number) => void = () => undefined;
    const exitCode = new Promise<number>((resolve) => {
      exit = resolve;
    });

    return {
      process: { stdin, stdout: stdout.readable, exitCode } as unknown as ExecProcess,
      exit,
    };
  };

  it('fails calls that are waiting and tells every viewer, instead of hanging', async () => {
    const chromium = fakeChromium();
    const browser = new Browser(chromium.process, new AbortController());
    let viewerClosed = false;

    browser.closedListeners.add(() => {
      viewerClosed = true;
    });

    const pending = browser.send('Page.navigate', { url: 'http://localhost:3000' });

    browser.close();

    await expect(pending).resolves.toEqual({ error: { message: 'browser exited' } });
    expect(viewerClosed).toBe(true);
    expect(browser.alive).toBe(false);
  });
});

describe('browser modes', () => {
  it('runs headless for the screencast and headed on a virtual display for vnc and webrtc', async () => {
    const { browserArgs } = await import('../src/browser');
    const screencast = browserArgs('screencast').join(' ');
    const vnc = browserArgs('vnc').join(' ');

    expect(screencast).toContain('--headless=new');
    expect(screencast).not.toContain('Xvfb');
    expect(vnc).not.toContain('--headless');
    expect(vnc).toContain('Xvfb :99');
    expect(vnc).toContain('x11vnc -display :99 -rfbport 5900 -localhost');
    expect(vnc).toContain('DISPLAY=:99 exec /usr/bin/chromium');
  });
});
