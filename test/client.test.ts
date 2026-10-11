import { beforeEach, describe, expect, it } from 'vitest';
import { CLIENT } from '../src/ui/client';
import { page } from '../src/ui/index';

type ViewShape = {
  name: string;
  title: string;
  phase: string;
  busy: boolean;
  running: boolean;
  repo: null;
  origin: Record<string, null>;
  owner: string;
  size: string;
  messages: { id: string; role: string; kind: string; text: string }[];
  pairs: never[];
  execs: never[];
  surfaces: { id: string; kind: string; title: string }[];
};

const view = (name: string, phase: string, busy: boolean): ViewShape => ({
  name,
  title: `Thread ${name}`,
  phase,
  busy,
  running: phase === 'awake',
  repo: null,
  origin: { parent: null, forkedFrom: null, base: null, seed: null },
  owner: 'you@example.com',
  size: 'standard-1',
  messages: [
    { id: 'm1', role: 'user', kind: 'message', text: 'hello' },
    { id: 'm2', role: 'assistant', kind: 'message', text: `answer from ${name}` },
  ],
  pairs: [],
  execs: [],
  surfaces: [{ id: 't1', kind: 'terminal', title: 'shell' }],
});

const threads = [
  {
    name: 'awake-one',
    title: 'Thread awake-one',
    phase: 'awake',
    busy: false,
    updatedAt: Date.now(),
  },
  { name: 'busy-one', title: 'Thread busy-one', phase: 'awake', busy: true, updatedAt: Date.now() },
  {
    name: 'paused-one',
    title: 'Thread paused-one',
    phase: 'paused',
    busy: false,
    updatedAt: Date.now(),
  },
];

const views: Record<string, ViewShape> = {
  'awake-one': view('awake-one', 'awake', false),
  'busy-one': view('busy-one', 'awake', true),
  'paused-one': view('paused-one', 'paused', false),
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

const fakeFetch = async (input: RequestInfo | URL) => {
  const path = new URL(String(input), 'https://coil.test').pathname;

  if (path === '/api/threads') return json(threads);
  if (path === '/api/whoami') return json({ who: 'you@example.com' });
  if (path === '/api/bases') return json([]);

  const name = /^\/api\/threads\/([^/]+)$/.exec(path)?.[1];

  if (name !== undefined && views[name] !== undefined) return json(views[name]);

  return new Response(new ReadableStream(), { headers: { 'content-type': 'text/event-stream' } });
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

const boot = async (path: string) => {
  const errors: string[] = [];
  const html = page();
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';

  window.history.replaceState({}, '', path);
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '');
  Object.assign(window, {
    fetch: fakeFetch,
    EventSource: class {
      close() {}
      addEventListener() {}
    },
    WebSocket: class {
      readyState = 0;
      send() {}
      close() {}
    },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    __TERM_SRC: '/assets/term-test.js',
  });
  window.addEventListener('error', (event) => errors.push(String(event.error ?? event.message)));
  window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));

  try {
    new Function(CLIENT)();
    document.dispatchEvent(new Event('DOMContentLoaded'));
  } catch (cause) {
    errors.push(String(cause));
  }

  await settle();

  return errors;
};

describe('the web client loads conversations', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  for (const name of Object.keys(views)) {
    it(`opens ${name} and shows its messages without a script error`, async () => {
      const errors = await boot(`/t/${name}`);

      expect(errors).toEqual([]);
      expect(document.body.textContent).toContain(`answer from ${name}`);
      expect(document.querySelector('#size')).not.toBeNull();
    });
  }

  it('lists threads on the home page without a script error', async () => {
    const errors = await boot('/');

    expect(errors).toEqual([]);
    expect(document.body.textContent).toContain('Thread paused-one');
  });
});
