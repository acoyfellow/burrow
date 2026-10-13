import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { discoverAndLoadExtensions } from '@earendil-works/pi-coding-agent';

const [mode, portText = '7788'] = process.argv.slice(2);
const AGENT_DIR = '/opt/pi-ext/agent-dir';
const CWD = '/workspace';

const silenced = { notify() {}, setStatus() {}, setWidget() {}, setFooter() {}, setTitle() {} };

const headlessUi = new Proxy(silenced, {
  get: (target, key) => (key in target ? target[key] : async () => undefined),
});

const contextFor = (signal) => ({
  cwd: CWD,
  hasUI: false,
  mode: 'print',
  signal,
  ui: headlessUi,
  isIdle: () => false,
  hasPendingMessages: () => false,
  getContextUsage: () => undefined,
  waitForIdle: async () => undefined,
  abort() {},
});

const sessions = new Map();

const SYSTEM_CHROMIUM = '/usr/lib/chromium/chromium';
const BROWSERS_PATH = '/opt/pi-ext/playwright-browsers';

const PLAYWRIGHT_LAYOUT = {
  'chromium-headless-shell': (revision) => `chromium_headless_shell-${revision}/chrome-headless-shell-linux64/chrome-headless-shell`,
  chromium: (revision) => `chromium-${revision}/chrome-linux64/chrome`,
};

const browsersFiles = (root, depth = 0) => {
  if (depth > 6 || !existsSync(root)) return [];

  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);

    if (name === 'browsers.json' && root.endsWith('playwright-core')) return [path];

    return name !== '.git' && statSync(path).isDirectory() ? browsersFiles(path, depth + 1) : [];
  });
};

const offerSystemChromium = (paths) => {
  if (!existsSync(SYSTEM_CHROMIUM)) return;

  for (const file of paths.flatMap((path) => browsersFiles(join(path, 'node_modules'))))
    for (const browser of JSON.parse(readFileSync(file, 'utf8')).browsers ?? []) {
      const layout = PLAYWRIGHT_LAYOUT[browser.name];

      if (layout === undefined) continue;

      const target = join(BROWSERS_PATH, layout(browser.revision));

      if (existsSync(target)) continue;

      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, `#!/bin/sh\nexec ${SYSTEM_CHROMIUM} --no-sandbox "$@"\n`);
      chmodSync(target, 0o755);
      writeFileSync(join(BROWSERS_PATH, layout(browser.revision).split('/')[0], 'INSTALLATION_COMPLETE'), '');
    }

  process.env.PLAYWRIGHT_BROWSERS_PATH = BROWSERS_PATH;
};

const startSession = async (paths) => {
  offerSystemChromium(paths);

  const result = await discoverAndLoadExtensions(paths, CWD, AGENT_DIR);
  const tools = new Map();

  for (const extension of result.extensions)
    for (const [name, registered] of extension.tools) tools.set(name, { extension, definition: registered.definition });

  for (const extension of result.extensions)
    for (const handler of extension.handlers.get('session_start') ?? [])
      await Promise.resolve(handler({ type: 'session_start', reason: 'startup' }, contextFor(undefined))).catch(() => undefined);

  return { result, tools };
};

const sessionFor = (paths) => {
  const key = JSON.stringify(paths);

  if (!sessions.has(key)) sessions.set(key, startSession(paths).catch((error) => (sessions.delete(key), Promise.reject(error))));

  return sessions.get(key);
};

const textOnly = (content) =>
  (content ?? []).flatMap((block) => (block?.type === 'text' && typeof block.text === 'string' ? [{ type: 'text', text: block.text }] : []));

const errorText = (error) => (error instanceof Error ? error.message : String(error));

const describe = async ({ paths }) => {
  const { result, tools } = await sessionFor(paths);

  return {
    tools: [...tools.values()].map(({ extension, definition }) => ({
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      extension: extension.path,
    })),
    errors: result.errors,
    unsupported: result.extensions.flatMap((extension) => [
      ...[...extension.commands.keys()].map((name) => ({ kind: 'command', name, extension: extension.path })),
      ...[...extension.shortcuts.keys()].map((name) => ({ kind: 'shortcut', name, extension: extension.path })),
    ]),
  };
};

const call = async ({ paths, tool: toolName, args }) => {
  const { tools } = await sessionFor(paths);
  const tool = tools.get(toolName);

  if (tool === undefined) return { isError: true, details: null, content: [{ type: 'text', text: `no extension tool named ${toolName}` }] };

  const controller = new AbortController();

  try {
    const result = await tool.definition.execute(`coil-${Date.now()}`, args ?? {}, controller.signal, () => {}, contextFor(controller.signal));

    return { content: textOnly(result?.content), details: result?.details ?? null, isError: result?.isError === true };
  } catch (error) {
    return { isError: true, details: null, content: [{ type: 'text', text: errorText(error) }] };
  }
};

const reset = async () => {
  for (const pending of sessions.values()) {
    const { result } = await pending.catch(() => ({ result: { extensions: [] } }));

    for (const extension of result.extensions)
      for (const handler of extension.handlers.get('session_shutdown') ?? [])
        await Promise.resolve(handler({ type: 'session_shutdown' }, contextFor(undefined))).catch(() => undefined);
  }

  sessions.clear();

  return { ok: true };
};

const ROUTES = { '/describe': describe, '/call': call, '/reset': reset };

const readJson = async (request) => {
  const chunks = [];

  for await (const chunk of request) chunks.push(chunk);

  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const serve = (port) =>
  createServer(async (request, response) => {
    const route = ROUTES[request.url ?? ''];

    response.setHeader('content-type', 'application/json');

    if (request.method !== 'POST' || route === undefined) {
      response.statusCode = 404;
      response.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    try {
      response.end(JSON.stringify(await route(await readJson(request))));
    } catch (error) {
      response.statusCode = 500;
      response.end(JSON.stringify({ error: errorText(error) }));
    }
  }).listen(port, '127.0.0.1');

if (mode === 'serve') serve(Number(portText));
else {
  console.error('usage: node pi-host.mjs serve [port]');
  process.exit(2);
}
