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
  const response = await worker.fetch(`http://coil${path}?run=${crypto.randomUUID().slice(0, 8)}`);
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
  expect(out.answer).toBe('Done.');
  expect(out.busy).toBe(false);
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
  expect(out.summaryIdMatches).toBe(true);
  expect(out.lastAnswer).toBe('Done.');
  expect(out.finalFiles.split('\n')).toEqual(['a.txt', 'b.txt', 'c.txt']);
});

test('the directory lists threads from any creator, and a fork starts from the parent disk', {
  timeout: 60_000,
}, async () => {
  const out = await get('/directory-fork-child');

  expect(out.listed.map((t: { createdBy: string }) => t.createdBy).sort()).toEqual(['mcp', 'web']);
  expect(
    out.listed.find((t: { forkedFrom: string | null }) => t.forkedFrom !== null),
  ).toBeDefined();
  expect(out.forkSees).toBe('the plan');
  expect(out.forkSeeded).toBe(true);
  expect(out.unknown).toMatch(/unknown thread/);
});

test('lifecycle: pause waits for the turn, a lost computer is reported, and an idle thread pauses itself', {
  timeout: 90_000,
}, async () => {
  const out = await get('/lifecycle');

  expect(out.pauseDuringTurn).toMatch(/agent is working/);
  expect(out.compactDuringTurn).toMatch(/agent is working/);
  expect(out.compacted).toBe('compaction');
  expect(['pause', 'refused']).toContain(out.pausedDuringCompaction);
  expect(out.filesAfterCompaction.split('\n')).toContain('kept.txt');
  expect(['pause', 'refused']).toContain(out.racedPause);
  expect(out.racedTurnAnswered).toBe(true);
  expect(out.racedFile).toBe(true);
  expect(out.filesAfterCrash.split('\n')).toContain('kept.txt');
  expect(out.lostNoticed).toBe(true);
  expect(out.idlePhase).toBe('paused');
  expect(out.idleRunning).toBe(false);
  expect(out.idlePairs.at(-1)).toBe('pause');
});

test('each Access user sees and controls only their own threads', { timeout: 60_000 }, async () => {
  const out = await get('/owners');

  expect(out.anaSees.length).toBe(2);
  expect(out.boSees).toEqual([]);
  for (const key of ['boView', 'boRead', 'boExec', 'boPause', 'boFork'])
    expect(out[key]).toMatch(/unknown thread/);
  expect(out.boTakesName).toMatch(/is taken/);
  expect(out.anaOwner).toBe('ana@example.com');
  expect(out.forkOwner).toBe('ana@example.com');
});

test('container size is set at creation and can change later without losing the disk', {
  timeout: 60_000,
}, async () => {
  const out = await get('/size');

  expect(out.created).toBe('standard-2');
  expect(out.resized).toEqual({ size: 'standard-4', restarted: true });
  expect(out.afterResize).toBe('survives-resize');
  expect(out.same).toEqual({ size: 'standard-4', restarted: false });
  expect(out.pausedResize).toEqual({ size: 'lite', restarted: false });
  expect(out.boots).toEqual(['standard-2', 'standard-4', 'lite']);
  expect(out.finalSize).toBe('lite');
});
