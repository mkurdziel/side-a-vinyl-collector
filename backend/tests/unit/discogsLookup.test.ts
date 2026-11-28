import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const { get, getCached, setCached } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  setCached: vi.fn(),
}));
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, create: () => ({ get }) } };
});
vi.mock('../../src/config/database', () => ({ default: {} }));
vi.mock('../../src/config/redis', () => ({ default: { get: getCached, setex: setCached } }));

import { getPressingDetails } from '../../src/controllers/discogsController';
import { errorHandler } from '../../src/middleware/errorHandler';
import discogs from '../../src/services/discogs';

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('DISCOGS_TOKEN', 'configured');
  vi.stubEnv('DISCOGS_ENABLED', 'true');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  getCached.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Discogs catalog results', () => {
  it('filters by catno and keeps summarized pressing evidence in the versioned cache', async () => {
    get.mockResolvedValueOnce({ data: { results: [
      { id: 11, title: 'Artist - Album', master_id: 31, catno: 'ABC 123', label: ['Red Label'], format: ['Vinyl', 'LP'], country: 'UK' },
      { id: 12, title: 'Artist - Album', master_id: 0, catno: 'none', format: ['Vinyl'] },
    ] } });

    const results = await discogs.searchByCatalogNumber('ABC-123', 40);

    expect(get).toHaveBeenCalledExactlyOnceWith('/database/search', {
      params: { catno: 'ABC-123', type: 'release', per_page: 40 },
    });
    expect(getCached).toHaveBeenCalledExactlyOnceWith('discogs:catno:v1:ABC-123:40');
    expect(setCached).toHaveBeenCalledExactlyOnceWith('discogs:catno:v1:ABC-123:40', expect.any(Number), JSON.stringify(results));
    expect(results).toMatchObject([
      { discogsId: 11, masterId: 31, pressing: { catalogNumber: 'ABC 123', label: 'Red Label', format: 'Vinyl · LP', country: 'UK' } },
      { discogsId: 12, masterId: undefined, pressing: { catalogNumber: undefined, format: 'Vinyl' } },
    ]);
  });
});

function pressingDetails() {
  return new Promise<{ status: number; body: unknown }>(resolve => {
    let status = 200;
    const req = { params: { id: '11' } } as unknown as Request;
    const res = {
      status(code: number) { status = code; return this; },
      json(body: unknown) { resolve({ status, body }); },
    } as Response;
    getPressingDetails(req, res, error => errorHandler(error, req, res, vi.fn()));
  });
}

describe('Discogs pressing lookup', () => {
  it('reports a retryable provider failure while other release callers keep their fallback', async () => {
    get.mockRejectedValue({ isAxiosError: true, code: 'ERR_BAD_RESPONSE', response: { status: 503 } });

    await expect(pressingDetails()).resolves.toMatchObject({ status: 503 });
    await expect(discogs.getRelease(11)).resolves.toBeNull();
  });

  it('keeps a genuinely missing release distinct from a provider failure', async () => {
    get.mockRejectedValue({ isAxiosError: true, code: 'ERR_BAD_REQUEST', response: { status: 404 } });

    await expect(pressingDetails()).resolves.toEqual({ status: 200, body: { pressing: null } });
  });
});
