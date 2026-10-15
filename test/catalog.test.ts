import { describe, expect, it } from 'vitest';
import {
  CATALOG_TTL_MS,
  catalogEntry,
  fetchCatalog,
  loadCatalog,
  mergeCatalog,
  parseStoredEntries,
  type StoredCatalog,
} from '../src/catalog';
import { GATEWAY_MODELS } from '../shared/models';

const searchResult = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  created_at: extra.created_at ?? '2026-10-01 00:00:00',
  properties: [
    { property_id: 'context_window', value: '262144' },
    { property_id: 'function_calling', value: extra.tools ?? 'true' },
    { property_id: 'vision', value: 'true' },
    {
      property_id: 'price',
      value: [
        { unit: 'per M input tokens', price: 0.95, currency: 'USD' },
        { unit: 'per M output tokens', price: 4, currency: 'USD' },
      ],
    },
  ],
});

const pages =
  (results: readonly unknown[][]): typeof fetch =>
  async (input) => {
    const page = Number(new URL(String(input)).searchParams.get('page'));

    return Response.json({ success: true, result: results[page - 1] ?? [] });
  };

describe('Workers AI catalog', () => {
  it('reads context, price, vision and tool use from a search result', () => {
    expect(catalogEntry(searchResult('@cf/moonshotai/kimi-k3'))).toMatchObject({
      id: '@cf/moonshotai/kimi-k3',
      label: 'Kimi K3',
      context: 262144,
      inputPerMtok: 0.95,
      outputPerMtok: 4,
      vision: true,
      tools: true,
    });
  });

  it('keeps only models that can call tools, newest first', async () => {
    const entries = await fetchCatalog(
      'acct',
      'token',
      pages([
        [
          searchResult('@cf/old/model', { created_at: '2025-01-01 00:00:00' }),
          searchResult('@cf/new/model', { created_at: '2026-10-01 00:00:00' }),
          searchResult('@cf/no/tools', { tools: 'false' }),
        ],
      ]),
    );

    expect(entries.map((each) => each.id)).toEqual(['@cf/new/model', '@cf/old/model']);
  });

  it('follows pages until a short page', async () => {
    const full = Array.from({ length: 100 }, (_, index) => searchResult(`@cf/a/m${index}`));
    const seen: string[] = [];
    const send: typeof fetch = async (input, init) => {
      seen.push(new URL(String(input)).searchParams.get('page') ?? '');

      return pages([full, [searchResult('@cf/b/last')]])(input, init);
    };

    const entries = await fetchCatalog('acct', 'token', send);

    expect(seen).toEqual(['1', '2']);
    expect(entries).toHaveLength(101);
  });

  it('sends the user token to their own account', async () => {
    let request: { url: string; auth: string | null } | null = null;

    await fetchCatalog('acct-a', 'user-token', async (input, init) => {
      request = { url: String(input), auth: new Headers(init?.headers).get('authorization') };

      return Response.json({ result: [] });
    });

    expect(request).toEqual({
      url: expect.stringContaining('/accounts/acct-a/ai/models/search'),
      auth: 'Bearer user-token',
    });
  });

  it('puts gateway models first and drops live duplicates', () => {
    const live = [catalogEntry(searchResult('@cf/new/model'))].flatMap((each) =>
      each ? [each] : [],
    );
    const merged = mergeCatalog(GATEWAY_MODELS, live);

    expect(merged.slice(0, GATEWAY_MODELS.length)).toEqual(GATEWAY_MODELS);
    expect(merged.at(-1)?.id).toBe('@cf/new/model');
  });

  it('ignores corrupt stored rows', () => {
    expect(parseStoredEntries('[{"id":1},{"nope":true}]')).toEqual([]);
  });
});

describe('catalog cache', () => {
  const stored: StoredCatalog = { entries: [], fetchedAt: 1_000 };

  it('uses a fresh stored catalog without fetching', async () => {
    let fetched = 0;
    const result = await loadCatalog({
      stored: async () => stored,
      save: async () => undefined,
      fetchLive: async () => {
        fetched++;
        return [];
      },
      now: () => 1_000 + CATALOG_TTL_MS - 1,
    });

    expect(fetched).toBe(0);
    expect(result).toBe(stored);
  });

  it('refetches and saves once the hour is up', async () => {
    const saved: StoredCatalog[] = [];
    const result = await loadCatalog({
      stored: async () => stored,
      save: async (catalog) => void saved.push(catalog),
      fetchLive: async () => [],
      now: () => 1_000 + CATALOG_TTL_MS,
    });

    expect(saved).toHaveLength(1);
    expect(result.fetchedAt).toBe(1_000 + CATALOG_TTL_MS);
  });

  it('serves the stale catalog when Cloudflare fails', async () => {
    const result = await loadCatalog({
      stored: async () => stored,
      save: async () => undefined,
      fetchLive: async () => {
        throw new Error('503');
      },
      now: () => 1_000 + CATALOG_TTL_MS * 5,
    });

    expect(result).toBe(stored);
  });

  it('fails when there is nothing stored and Cloudflare fails', async () => {
    await expect(
      loadCatalog({
        stored: async () => null,
        save: async () => undefined,
        fetchLive: async () => {
          throw new Error('503');
        },
        now: () => 0,
      }),
    ).rejects.toThrow('503');
  });
});
