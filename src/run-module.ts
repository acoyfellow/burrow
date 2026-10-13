import { CAPABILITIES, type Capability } from './capabilities';

export const MAX_CALLS = 40;

const identifier = (capability: Capability) => capability.name.replace(/[^a-zA-Z0-9_]/g, '_');

export const runModule = (code: string): string => `export default {
  async fetch(request, env) {
    const calls = [];
    const call = async (name, input) => {
      if (calls.length >= ${MAX_CALLS}) throw new Error("coil_run is limited to ${MAX_CALLS} calls");
      const started = Date.now();
      const outcome = await env.COIL.call(name, input ?? {});
      calls.push(outcome.ok
        ? { capability: name, ok: true, ms: Date.now() - started }
        : { capability: name, ok: false, ms: Date.now() - started, error: outcome.error });
      if (!outcome.ok) throw new Error(name + ": " + outcome.error);
      return outcome.value;
    };
    const coil = Object.freeze({
${CAPABILITIES.map((capability) => `      ${identifier(capability)}: (input) => call(${JSON.stringify(capability.name)}, input),`).join('\n')}
    });
    try {
      const result = await (async () => {
${code}
      })();
      return Response.json({ ok: true, result: result ?? null, calls });
    } catch (error) {
      return Response.json({ ok: false, error: String(error && error.message ? error.message : error), calls });
    }
  }
};`;
