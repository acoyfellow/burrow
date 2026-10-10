import type { Env, Thread } from './thread';

type Rpc = {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
};

type Stub = DurableObjectStub<Thread>;

const str = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value === '') throw new Error(`${field} is required`);

  return value;
};

const TOOLS = [
  {
    name: 'thread_create',
    description:
      'Create a thread: its own agent and its own Linux computer. Optional repo is a git URL to clone.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, repo: { type: 'string' } },
    },
  },
  {
    name: 'thread_send',
    description:
      'Send a message to the thread agent and wait for the turn to finish. Pass the same requestId to retry safely.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        text: { type: 'string' },
        requestId: { type: 'string' },
      },
      required: ['name', 'text'],
    },
  },
  {
    name: 'thread_exec',
    description: 'Run a shell command in the thread computer, in /workspace.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, command: { type: 'string' } },
      required: ['name', 'command'],
    },
  },
  {
    name: 'thread_read_file',
    description: 'Read a file from the thread computer.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, path: { type: 'string' } },
      required: ['name', 'path'],
    },
  },
  {
    name: 'thread_compact',
    description: 'Compact the transcript and snapshot the disk, as one recorded pair.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'thread_pause',
    description: 'Snapshot the disk and stop the computer. The next call resumes it.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
  {
    name: 'thread_status',
    description: 'Phase, transcript, compaction pairs, and recent commands of a thread.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  },
];

const call = async (
  stubFor: (name: string) => Stub,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> => {
  const name = str(
    args.name ?? (tool === 'thread_create' ? `t-${crypto.randomUUID().slice(0, 8)}` : undefined),
    'name',
  );
  const stub = stubFor(name);

  switch (tool) {
    case 'thread_create':
      return stub.create(name, typeof args.repo === 'string' ? args.repo : null);
    case 'thread_send':
      return stub.send(
        typeof args.requestId === 'string' ? args.requestId : crypto.randomUUID(),
        str(args.text, 'text'),
      );
    case 'thread_exec':
      return stub.exec(['sh', '-lc', str(args.command, 'command')]);
    case 'thread_read_file':
      return stub.readFile(str(args.path, 'path'));
    case 'thread_compact':
      return stub.compact();
    case 'thread_pause':
      return stub.pause();
    case 'thread_status':
      return stub.view();
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
};

export const mcp = async (
  request: Request,
  _env: Env,
  stubFor: (env: Env, name: string) => Stub,
): Promise<Response> => {
  const rpc = (await request.json()) as Rpc;
  const reply = (result: unknown) => Response.json({ jsonrpc: '2.0', id: rpc.id ?? null, result });

  if (rpc.id === undefined) return new Response(null, { status: 202 });

  switch (rpc.method) {
    case 'initialize':
      return reply({
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'burrow', version: '0.0.1' },
      });
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call':
      try {
        const value = await call(
          (name) => stubFor(_env, name),
          str(rpc.params?.name, 'tool'),
          rpc.params?.arguments ?? {},
        );

        return reply({
          content: [
            {
              type: 'text',
              text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
            },
          ],
        });
      } catch (cause) {
        return reply({
          content: [{ type: 'text', text: String(cause instanceof Error ? cause.message : cause) }],
          isError: true,
        });
      }
    default:
      return Response.json({
        jsonrpc: '2.0',
        id: rpc.id,
        error: { code: -32601, message: `Unknown method ${rpc.method}` },
      });
  }
};
