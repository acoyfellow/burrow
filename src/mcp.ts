import type { Burrow } from './service';

type Rpc = {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
};

const str = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value === '') throw new Error(`${field} is required`);

  return value;
};

const opt = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined);

const obj = (
  properties: Record<string, { type: string; description?: string }>,
  required: string[] = [],
) => ({
  type: 'object',
  properties,
  required,
});

const NAME = { type: 'string', description: 'Thread name' };

const TOOLS = [
  {
    name: 'thread_list',
    description: 'List all threads, newest activity first.',
    inputSchema: obj({}),
  },
  {
    name: 'thread_create',
    description:
      'Create a thread: its own agent and its own Linux computer. Optional repo is a git URL; if a warm base exists for it, the computer starts from that.',
    inputSchema: obj({ name: NAME, repo: { type: 'string' }, title: { type: 'string' } }),
  },
  {
    name: 'thread_send',
    description:
      'Send a message to the thread agent and wait for the turn to finish. Returns its answer. Pass the same requestId to retry safely.',
    inputSchema: obj({ name: NAME, text: { type: 'string' }, requestId: { type: 'string' } }, [
      'name',
      'text',
    ]),
  },
  {
    name: 'thread_exec',
    description: 'Run a shell command in the thread computer, in /workspace.',
    inputSchema: obj({ name: NAME, command: { type: 'string' } }, ['name', 'command']),
  },
  {
    name: 'thread_read_file',
    description: 'Read a file from the thread computer.',
    inputSchema: obj({ name: NAME, path: { type: 'string' } }, ['name', 'path']),
  },
  {
    name: 'thread_compact',
    description: 'Compact the transcript and snapshot the disk, as one recorded pair.',
    inputSchema: obj({ name: NAME }, ['name']),
  },
  {
    name: 'thread_pause',
    description: 'Snapshot the disk and stop the computer. The next call resumes it.',
    inputSchema: obj({ name: NAME }, ['name']),
  },
  {
    name: 'thread_fork',
    description:
      'Start a new thread from this thread’s current disk and a summary of its conversation.',
    inputSchema: obj({ name: NAME, forkName: { type: 'string' } }, ['name']),
  },
  {
    name: 'thread_status',
    description: 'Phase, transcript, compaction pairs, and recent commands of a thread.',
    inputSchema: obj({ name: NAME }, ['name']),
  },
  {
    name: 'base_prepare',
    description:
      'Clone a repo, run a setup command once, and snapshot it. New threads on that repo start from the snapshot.',
    inputSchema: obj({ repo: { type: 'string' }, setup: { type: 'string' } }, ['repo']),
  },
];

const call = async (api: Burrow, tool: string, args: Record<string, unknown>): Promise<unknown> => {
  switch (tool) {
    case 'thread_list':
      return api.list();
    case 'thread_create':
      return api.create({
        name: opt(args.name),
        repo: opt(args.repo) ?? null,
        title: opt(args.title),
        createdBy: 'mcp',
      });
    case 'thread_send':
      return api.send(
        str(args.name, 'name'),
        opt(args.requestId) ?? crypto.randomUUID(),
        str(args.text, 'text'),
      );
    case 'thread_exec':
      return api.exec(str(args.name, 'name'), ['bash', '-lc', str(args.command, 'command')]);
    case 'thread_read_file':
      return api.read(str(args.name, 'name'), str(args.path, 'path'));
    case 'thread_compact':
      return api.compact(str(args.name, 'name'));
    case 'thread_pause':
      return api.pause(str(args.name, 'name'));
    case 'thread_fork':
      return api.fork(str(args.name, 'name'), opt(args.forkName), 'mcp');
    case 'thread_status':
      return api.view(str(args.name, 'name'));
    case 'base_prepare':
      return api.prepare(str(args.repo, 'repo'), opt(args.setup) ?? '');
    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
};

export const mcp = async (request: Request, api: Burrow): Promise<Response> => {
  const rpc = (await request.json()) as Rpc;
  const reply = (result: unknown) => Response.json({ jsonrpc: '2.0', id: rpc.id ?? null, result });

  if (rpc.id === undefined) return new Response(null, { status: 202 });

  switch (rpc.method) {
    case 'initialize':
      return reply({
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'burrow', version: '0.2.0' },
      });
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call':
      try {
        const value = await call(api, str(rpc.params?.name, 'tool'), rpc.params?.arguments ?? {});

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
          content: [{ type: 'text', text: cause instanceof Error ? cause.message : String(cause) }],
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
