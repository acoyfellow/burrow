import { afterEach, describe, expect, it, vi } from 'vitest';
import { runTerrarium } from '../src/terrarium';

const config = { url: 'https://terrarium.example', token: 't' };

afterEach(() => vi.unstubAllGlobals());

describe('terrarium', () => {
  it('starts a run, polls to a terminal state, and reports a verified receipt', async () => {
    const seen: string[] = [];
    let polls = 0;

    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      const path = new URL(input).pathname;

      seen.push(`${init?.method ?? 'GET'} ${path}`);
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer t');

      if (path === '/api/runs')
        return Response.json(
          { runId: 'r1', contract: { runId: 'r1', nonce: 'n' } },
          { status: 202 },
        );

      if (path.endsWith('/status')) {
        polls += 1;

        return Response.json({
          status:
            polls < 2 ? { status: 'running' } : { status: 'done', taskContractStatus: 'verified' },
        });
      }

      return new Response('noise\nTERRARIUM_RESULT={"runId":"r1","nonce":"n"}\n');
    });

    const receipt = await runTerrarium(config, 'reply hello', async () => undefined);

    expect(receipt).toMatchObject({ runId: 'r1', status: 'done', verified: true });
    expect(receipt.result).toBe('TERRARIUM_RESULT={"runId":"r1","nonce":"n"}');
    expect(seen).toEqual([
      'POST /api/runs',
      'GET /api/runs/r1/status',
      'GET /api/runs/r1/status',
      'GET /api/runs/r1/logs',
    ]);
  });

  it('reports an unverified receipt honestly', async () => {
    vi.stubGlobal('fetch', async (input: string) =>
      new URL(input).pathname === '/api/runs'
        ? Response.json({ runId: 'r2' })
        : new URL(input).pathname.endsWith('/status')
          ? Response.json({ status: { status: 'failed', taskContractStatus: 'missing' } })
          : new Response(''),
    );

    const receipt = await runTerrarium(config, 'x', async () => undefined);

    expect(receipt.verified).toBe(false);
    expect(receipt.status).toBe('failed');
  });
});
