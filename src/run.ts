import { exports, WorkerEntrypoint } from 'cloudflare:workers';
import './worker-env';
import { capabilityNamed } from './capabilities';
import { runModule } from './run-module';
import { coil } from './service';
import type { Env } from './thread';

export type RunCall = {
  readonly capability: string;
  readonly ok: boolean;
  readonly ms: number;
  readonly error?: string;
};

export type RunResult =
  | { readonly ok: true; readonly result: unknown; readonly calls: readonly RunCall[] }
  | { readonly ok: false; readonly error: string; readonly calls: readonly RunCall[] };

type Outcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: string };

type BridgeProps = { readonly owner: string };

const asJson = (value: unknown): unknown =>
  value === undefined ? null : JSON.parse(JSON.stringify(value));

const recordOf = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};

export class CoilBridge extends WorkerEntrypoint<Env, BridgeProps> {
  async call(name: string, input: unknown): Promise<Outcome> {
    const capability = capabilityNamed(name);

    if (capability === undefined) return { ok: false, error: `unknown capability ${name}` };

    try {
      return {
        ok: true,
        value: asJson(await capability.run(coil(this.env, this.ctx.props.owner), recordOf(input))),
      };
    } catch (cause) {
      return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
    }
  }
}

const isRunResult = (value: unknown): value is RunResult =>
  typeof value === 'object' && value !== null && 'ok' in value && 'calls' in value;

export const runScript = async (env: Env, owner: string, code: string): Promise<RunResult> => {
  const worker = env.LOADER.load({
    compatibilityDate: '2026-08-22',
    mainModule: 'run.js',
    modules: { 'run.js': runModule(code) },
    globalOutbound: null,
    env: { COIL: exports.CoilBridge({ props: { owner } }) },
  });
  const response = await worker.getEntrypoint().fetch(new Request('https://run.coil/'));
  const body: unknown = await response.json();

  return isRunResult(body)
    ? body
    : { ok: false, error: 'the script returned no result', calls: [] };
};
