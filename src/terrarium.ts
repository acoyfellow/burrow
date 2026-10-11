export type TerrariumConfig = { readonly url: string; readonly token: string };

export type TerrariumReceipt = {
  readonly runId: string;
  readonly status: string;
  readonly verified: boolean;
  readonly contract: string;
  readonly result: string;
};

const POLL_MS = 5_000;
const MAX_WAIT_MS = 10 * 60_000;
const RESULT_LINE = /TERRARIUM_RESULT=.*$/m;

const call = async (config: TerrariumConfig, path: string, init: RequestInit = {}) => {
  const response = await fetch(`${config.url.replace(/[/]+$/, '')}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok)
    throw new Error(
      `Terrarium ${path.split('/').slice(0, 3).join('/')} answered ${response.status}`,
    );

  return response;
};

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;

export const runTerrarium = async (
  config: TerrariumConfig,
  task: string,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<TerrariumReceipt> => {
  const started = await (
    await call(config, '/api/runs', {
      method: 'POST',
      headers: { 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ task }),
    })
  ).json();
  const contract = field(started, 'contract');
  const runId = String(field(started, 'runId') ?? field(contract, 'runId') ?? '');

  if (runId === '') throw new Error('Terrarium did not return a runId');

  const deadline = Date.now() + MAX_WAIT_MS;
  let status: unknown = null;

  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const body = await (await call(config, `/api/runs/${encodeURIComponent(runId)}/status`)).json();
    status = field(body, 'status') ?? body;
    const state = String(field(status, 'status') ?? '');

    if (state !== '' && state !== 'running' && state !== 'queued') break;
  }

  const logs = await (await call(config, `/api/runs/${encodeURIComponent(runId)}/logs`))
    .text()
    .catch(() => '');

  return {
    runId,
    status: String(field(status, 'status') ?? 'timeout'),
    verified: field(status, 'taskContractStatus') === 'verified',
    contract: JSON.stringify(contract ?? {}),
    result: RESULT_LINE.exec(logs)?.[0] ?? '',
  };
};
