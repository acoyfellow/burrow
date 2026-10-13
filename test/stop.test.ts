import { describe, expect, it } from 'vitest';
import { untilAborted } from '../src/agent';

describe('stop', () => {
  it('ends a tool call as soon as the turn is aborted', async () => {
    const controller = new AbortController();
    const never = new Promise<string>(() => undefined);
    const started = Date.now();
    const pending = untilAborted(never, controller.signal);

    setTimeout(() => controller.abort(new Error('stopped by the owner')), 20);

    await expect(pending).rejects.toThrow('stopped by the owner');
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('passes results through when nothing aborts', async () => {
    await expect(untilAborted(Promise.resolve('done'), new AbortController().signal)).resolves.toBe(
      'done',
    );
    await expect(untilAborted(Promise.resolve('done'), undefined)).resolves.toBe('done');
  });
});
