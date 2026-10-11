import { Effect, Schema } from 'effect';
import { type CoilError, Invalid, Size } from '../shared/protocol';
import { type Handlers, reasonOf, statusOf } from './rpc';

type Route = {
  readonly method: string;
  readonly pattern: RegExp;
  readonly run: (handlers: Handlers, input: RouteInput) => Effect.Effect<RouteOutput, CoilError>;
};

type RouteInput = {
  readonly params: readonly string[];
  readonly query: URLSearchParams;
  readonly body: Record<string, unknown>;
  readonly headers: Headers;
};

type RouteOutput = { readonly status: number; readonly body: unknown; readonly text?: boolean };

const ok = (body: unknown, status = 200): RouteOutput => ({ status, body });

const param = (input: RouteInput, index: number): string => input.params[index] ?? '';

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

const requiredString = (value: unknown, field: string): Effect.Effect<string, CoilError> =>
  typeof value === 'string' && value.trim() !== ''
    ? Effect.succeed(value)
    : Effect.fail(new Invalid({ reason: `${field} is required` }));

const decodeSize = Schema.decodeUnknownOption(Size);

const sizeOf = (value: unknown): Effect.Effect<Size | undefined, CoilError> => {
  if (value === undefined) return Effect.succeed(undefined);

  const decoded = decodeSize(value);

  return decoded._tag === 'Some'
    ? Effect.succeed(decoded.value)
    : Effect.fail(
        new Invalid({
          reason: `size must be one of lite, standard-1, standard-2, standard-3, standard-4`,
        }),
      );
};

const THREAD = '([a-z0-9][a-z0-9-]{0,62})';

const routes: readonly Route[] = [
  { method: 'GET', pattern: /^\/api\/whoami$/, run: (h) => h.WhoAmI().pipe(Effect.map(ok)) },
  { method: 'GET', pattern: /^\/api\/sizes$/, run: (h) => h.Sizes().pipe(Effect.map(ok)) },
  { method: 'GET', pattern: /^\/api\/threads$/, run: (h) => h.ListThreads().pipe(Effect.map(ok)) },
  {
    method: 'POST',
    pattern: /^\/api\/threads$/,
    run: (h, { body }) =>
      sizeOf(body.size).pipe(
        Effect.flatMap((size) =>
          h.CreateThread({
            name: optionalString(body.name),
            repo: optionalString(body.repo) ?? null,
            title: optionalString(body.title),
            warm: body.warm !== false,
            size,
            createdBy: 'web',
          }),
        ),
        Effect.map((view) => ok(view, 201)),
      ),
  },
  {
    method: 'GET',
    pattern: new RegExp(`^/api/threads/${THREAD}$`),
    run: (h, input) => h.ViewThread({ name: param(input, 0) }).pipe(Effect.map(ok)),
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/api/threads/${THREAD}/messages$`),
    run: (h, input) =>
      requiredString(input.body.text, 'text').pipe(
        Effect.flatMap((text) => {
          const requestId = input.headers.get('Idempotency-Key') ?? crypto.randomUUID();
          const name = param(input, 0);

          return input.body.wait === true
            ? h.SendMessage({ name, requestId, text }).pipe(Effect.map(ok))
            : h
                .StartMessage({ name, requestId, text })
                .pipe(Effect.map((accepted) => ok(accepted, 202)));
        }),
      ),
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/api/threads/${THREAD}/exec$`),
    run: (h, input) => {
      const argv = Array.isArray(input.body.argv)
        ? input.body.argv.map(String)
        : ['bash', '-lc', optionalString(input.body.command) ?? 'true'];

      return h.Exec({ name: param(input, 0), argv }).pipe(Effect.map(ok));
    },
  },
  {
    method: 'GET',
    pattern: new RegExp(`^/api/threads/${THREAD}/files$`),
    run: (h, input) => {
      const name = param(input, 0);
      const path = input.query.get('path') ?? '.';

      return input.query.get('list') === '1'
        ? h.ListDir({ name, path }).pipe(Effect.map(ok))
        : h
            .ReadFile({ name, path })
            .pipe(Effect.map((text) => ({ status: 200, body: text, text: true })));
    },
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/api/threads/${THREAD}/compact$`),
    run: (h, input) => h.Compact({ name: param(input, 0) }).pipe(Effect.map(ok)),
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/api/threads/${THREAD}/pause$`),
    run: (h, input) => h.Pause({ name: param(input, 0) }).pipe(Effect.map(ok)),
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/api/threads/${THREAD}/size$`),
    run: (h, input) =>
      sizeOf(input.body.size ?? '').pipe(
        Effect.flatMap((size) =>
          size === undefined
            ? Effect.fail(
                new Invalid({
                  reason:
                    'size must be one of lite, standard-1, standard-2, standard-3, standard-4',
                }),
              )
            : h.Resize({ name: param(input, 0), size }),
        ),
        Effect.map(ok),
      ),
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/api/threads/${THREAD}/fork$`),
    run: (h, input) =>
      h
        .Fork({
          name: param(input, 0),
          forkName: optionalString(input.body.name),
          createdBy: 'web',
        })
        .pipe(Effect.map((view) => ok(view, 201))),
  },
  {
    method: 'POST',
    pattern: new RegExp(`^/api/threads/${THREAD}/surfaces$`),
    run: (h, input) =>
      h
        .AddSurface({
          name: param(input, 0),
          kind: input.body.kind === 'browser' ? 'browser' : 'terminal',
        })
        .pipe(Effect.map(ok)),
  },
  {
    method: 'DELETE',
    pattern: new RegExp(`^/api/threads/${THREAD}/surfaces/([^/]+)$`),
    run: (h, input) =>
      h.CloseSurface({ name: param(input, 0), id: param(input, 1) }).pipe(Effect.map(ok)),
  },
  { method: 'GET', pattern: /^\/api\/bases$/, run: (h) => h.ListBases().pipe(Effect.map(ok)) },
  {
    method: 'POST',
    pattern: /^\/api\/bases$/,
    run: (h, { body }) =>
      requiredString(body.repo, 'repo').pipe(
        Effect.flatMap((repo) => h.PrepareBase({ repo, setup: optionalString(body.setup) ?? '' })),
        Effect.map((prepared) => ok(prepared, 201)),
      ),
  },
];

const readBody = async (request: Request): Promise<Record<string, unknown>> => {
  if (request.method === 'GET' || request.method === 'DELETE') return {};

  const parsed: unknown = await request.json().catch(() => ({}));

  return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
};

const respond = (output: RouteOutput): Response =>
  output.text === true
    ? new Response(String(output.body), {
        status: output.status,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    : Response.json(output.body, { status: output.status });

export const restRoute = (method: string, pathname: string) => {
  for (const route of routes) {
    if (route.method !== method) continue;

    const match = route.pattern.exec(pathname);

    if (match !== null) return { route, params: match.slice(1) };
  }

  return null;
};

export const serveRest = async (request: Request, handlers: Handlers): Promise<Response | null> => {
  const url = new URL(request.url);
  const found = restRoute(request.method, url.pathname);

  if (found === null) return null;

  const input: RouteInput = {
    params: found.params,
    query: url.searchParams,
    body: await readBody(request),
    headers: request.headers,
  };

  return Effect.runPromise(
    found.route.run(handlers, input).pipe(
      Effect.map(respond),
      Effect.catch((error: CoilError) =>
        Effect.succeed(Response.json({ error: reasonOf(error) }, { status: statusOf(error) })),
      ),
    ),
  );
};
