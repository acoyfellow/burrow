import { CAPABILITIES, capabilityNamed, inputSchema } from './capabilities';
import { describe } from './docs';
import { runScript } from './run';
import { MAX_CALLS } from './run-module';
import type { Coil } from './service';
import type { Env } from './thread';

type Rpc = {
  readonly jsonrpc: '2.0';
  readonly id?: number | string;
  readonly method: string;
  readonly params?: { readonly name?: string; readonly arguments?: Record<string, unknown> };
};

type Caller = { readonly env: Env; readonly who: string; readonly api: Coil };

const DESCRIBE_TOOL = {
  name: 'coil_describe',
  description:
    'Return the TypeScript declaration of the `coil` object that coil_run scripts use. Read this first.',
  inputSchema: { type: 'object', properties: {}, required: [] },
};

const RUN_TOOL = {
  name: 'coil_run',
  description: `Run the body of an async JavaScript function with a frozen \`coil\` object, for example \`const t = await coil.thread_create({}); return await coil.thread_exec({ name: t.name, command: "ls" });\`. Each \`coil.<capability>(input)\` is one call; at most ${MAX_CALLS} per run. The script has no network access. Returns { ok, result, calls }.`,
  inputSchema: {
    type: 'object',
    properties: { code: { type: 'string', description: 'Async function body' } },
    required: ['code'],
  },
};

const TOOLS = [
  DESCRIBE_TOOL,
  RUN_TOOL,
  ...CAPABILITIES.map((capability) => ({
    name: capability.name,
    description: capability.summary,
    inputSchema: inputSchema(capability),
  })),
];

const call = async (
  caller: Caller,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> => {
  if (tool === DESCRIBE_TOOL.name) return describe();

  if (tool === RUN_TOOL.name) {
    const code = args.code;

    if (typeof code !== 'string' || code.trim() === '') throw new Error('code is required');

    return runScript(caller.env, caller.who, code);
  }

  const capability = capabilityNamed(tool);

  if (capability === undefined) throw new Error(`Unknown tool: ${tool}`);

  return capability.run(caller.api, args);
};

const textOf = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2);

const isRpc = (value: unknown): value is Rpc =>
  typeof value === 'object' &&
  value !== null &&
  'method' in value &&
  typeof value.method === 'string';

export const mcp = async (request: Request, caller: Caller): Promise<Response> => {
  const body: unknown = await request.json();

  if (!isRpc(body))
    return Response.json({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid request' },
    });

  const rpc = body;
  const reply = (result: unknown) => Response.json({ jsonrpc: '2.0', id: rpc.id ?? null, result });

  if (rpc.id === undefined) return new Response(null, { status: 202 });

  switch (rpc.method) {
    case 'initialize':
      return reply({
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'coil', version: '0.3.0' },
      });
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call':
      try {
        const value = await call(caller, rpc.params?.name ?? '', rpc.params?.arguments ?? {});
        const failed =
          typeof value === 'object' && value !== null && 'ok' in value && value.ok === false;

        return reply({
          content: [{ type: 'text', text: textOf(value) }],
          ...(failed ? { isError: true } : {}),
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
