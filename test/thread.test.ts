import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { unstable_startWorker } from 'wrangler';

let worker: Awaited<ReturnType<typeof unstable_startWorker>>;

beforeAll(async () => {
  worker = await unstable_startWorker({
    config: resolve('test/worker/wrangler.jsonc'),
    dev: { server: { port: 0 }, inspector: false, logLevel: 'error', persist: false },
  });
}, 60_000);

afterAll(async () => {
  await worker.dispose();
});

const get = async (path: string) => {
  const response = await worker.fetch(
    `http://burrow${path}?run=${crypto.randomUUID().slice(0, 8)}`,
  );
  const body = await response.text();

  if (!response.ok) throw new Error(`${path} -> ${response.status}: ${body}`);

  return JSON.parse(body);
};

test('two threads get two computers: a file one agent writes is not in the other', {
  timeout: 60_000,
}, async () => {
  const out = await get('/isolation');

  expect(out.inA).toContain('secret.txt');
  expect(out.inB).not.toContain('secret.txt');
  expect(out.bRead).toMatch(/^refused/);
});

test('a thread killed with ctx.abort() mid-turn comes back and finishes the same request once', {
  timeout: 60_000,
}, async () => {
  const out = await get('/kill');

  expect(out.killed).toBe('aborted');
  expect(out.done).toBe(true);
  expect(out.file).toBe('survived');
  expect(out.turns).toBe(1);
});

test('compact, pause, kill, resume: the summary and the disk come back together and the agent keeps working', {
  timeout: 90_000,
}, async () => {
  const out = await get('/compact');

  expect(out.pairReason).toBe('compaction');
  expect(out.summaryEntry).not.toBeNull();
  expect(out.pausedReason).toBe('pause');
  expect(out.phaseAfterPause).toBe('paused');
  expect(out.runningAfterPause).toBe(false);
  expect(out.resumedFiles.split('\n')).toEqual(['a.txt', 'b.txt']);
  expect(out.pairs).toEqual(['compaction', 'pause']);
  expect(out.hasSummary).toBe(true);
  expect(out.lastAnswer).toBe('Done.');
  expect(out.finalFiles.split('\n')).toEqual(['a.txt', 'b.txt', 'c.txt']);
});
