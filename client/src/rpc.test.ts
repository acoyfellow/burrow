import { Effect } from 'effect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CoilClient, CoilClientLive } from './rpc';

const reply = (exit: unknown) =>
  new Response(JSON.stringify([{ _tag: 'Exit', requestId: '1', exit }]));

const run = <A, E>(effect: Effect.Effect<A, E, CoilClient>) =>
  Effect.runPromise(Effect.result(effect.pipe(Effect.provide(CoilClientLive))));

describe('the thin rpc client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends payload null for calls without input and decodes the value', async () => {
    const fetch = vi.fn(async () => reply({ _tag: 'Success', value: ['lite'] }));

    vi.stubGlobal('fetch', fetch);

    const out = await run(Effect.flatMap(CoilClient, (client) => client.Sizes()));
    const sent = JSON.parse(
      String(
        (fetch.mock.calls[0] as unknown[])[1] &&
          ((fetch.mock.calls[0] as unknown[])[1] as RequestInit).body,
      ),
    );

    expect(sent).toMatchObject({ _tag: 'Request', tag: 'Sizes', payload: null });
    expect(out).toMatchObject({ _tag: 'Success', success: ['lite'] });
  });

  it('turns a tagged server failure into the typed error', async () => {
    vi.stubGlobal('fetch', async () =>
      reply({
        _tag: 'Failure',
        cause: [{ _tag: 'Fail', error: { _tag: 'UnknownThread', name: 'x' } }],
      }),
    );

    const out = await run(Effect.flatMap(CoilClient, (client) => client.ViewThread({ name: 'x' })));

    expect(out).toMatchObject({ _tag: 'Failure', failure: { _tag: 'UnknownThread', name: 'x' } });
  });
});
