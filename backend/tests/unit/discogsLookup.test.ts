import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const { get, getCached, setCached, query } = vi.hoisted(() => ({
  get: vi.fn(),
  getCached: vi.fn(),
  setCached: vi.fn(),
  query: vi.fn(),
}));
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, create: () => ({ get }) } };
});
vi.mock('../../src/config/database', () => ({ default: { query } }));
vi.mock('../../src/config/redis', () => ({ default: { get: getCached, setex: setCached } }));

import { getPressingDetails, importCollection } from '../../src/controllers/discogsController';
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
    get.mockResolvedValueOnce({ data: { pagination: { page: 1, pages: 2 }, results: [
      { id: 11, title: 'Artist - Album', master_id: 31, catno: 'ABC 123', label: ['Red Label'], format: ['Vinyl', 'LP'], country: 'UK' },
      { id: 12, title: 'Artist - Album', master_id: 0, catno: 'none', format: ['Vinyl'] },
    ] } });

    const sample = await discogs.searchReleaseSample({ catno: 'ABC-123' }, 40);

    expect(get).toHaveBeenCalledExactlyOnceWith('/database/search', {
      params: { catno: 'ABC-123', type: 'release', per_page: 40 },
    });
    expect(getCached).toHaveBeenCalledExactlyOnceWith('discogs:catno:v2:ABC-123:40');
    expect(setCached).toHaveBeenCalledExactlyOnceWith('discogs:catno:v2:ABC-123:40', expect.any(Number), JSON.stringify(sample));
    expect(sample.hasMore).toBe(true);
    expect(sample.albums).toMatchObject([
      { discogsId: 11, masterId: 31, pressing: { catalogNumber: 'ABC 123', label: 'Red Label', format: 'Vinyl · LP', country: 'UK' } },
      { discogsId: 12, masterId: undefined, pressing: { catalogNumber: undefined, format: 'Vinyl' } },
    ]);
  });

  it('retains all editions from an artist release page and marks it complete from Discogs pagination', async () => {
    get.mockResolvedValueOnce({ data: { pagination: { page: 1, pages: 1 }, releases: [
      { id: 41, type: 'master', title: 'Album', artist: 'Artist' },
      ...Array.from({ length: 9 }, (_, index) => ({
        id: index + 51, type: 'release', title: 'Album', artist: 'Artist',
      })),
    ] } });

    const sample = await discogs.getArtistReleases(31, 5);

    expect(sample.albums.map(album => album.id)).toEqual([41, 51, 52, 53, 54, 55, 56, 57, 58, 59]);
    expect(sample.hasMore).toBe(false);
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
  it('includes the actual release year in the pressing evidence', async () => {
    get.mockResolvedValue({ data: { id: 11, title: 'Dummy', year: 2017, artists: [{ name: 'Portishead' }] } });
    await expect(pressingDetails()).resolves.toMatchObject({ status: 200, body: { pressing: { year: 2017 } } });
  });

  it('includes full-release evidence and keeps only the first six distinct matrix or runout inscriptions', async () => {
    const runout = { type: 'Matrix / Runout', value: ' ABC-123 A1 ', description: ' Side A, etched ' };
    get.mockResolvedValueOnce({ data: {
      id: 11, title: 'Dummy', year: 2017, artists: [{ name: 'Portishead' }], country: ' UK ',
      labels: [{ name: 'Go! Beat', catno: 'ABC 123' }, { name: 'Go! Beat', catno: 'none' }],
      formats: [{ name: 'Vinyl', descriptions: ['LP', 'Stereo', 'Repress'], text: 'Blue' }],
      identifiers: [
        { type: 'Barcode', value: '0987654321' }, null, { type: 'Matrix / Runout', value: ' ' },
        runout, runout, { type: 'matrix/runout', value: 'ABC-123 B1' },
        { ...runout, value: 'x'.repeat(400), description: 'y'.repeat(200) },
        ...[2, 3, 4, 5].map(variant => ({ ...runout, value: `ABC-123 A${variant}` })),
      ],
    } });

    await expect(pressingDetails()).resolves.toEqual({ status: 200, body: { pressing: {
      year: 2017, catalogNumber: 'ABC 123', label: 'Go! Beat', country: 'UK', format: 'Vinyl · LP · Stereo · Repress · Blue',
      matrixRunouts: [
        { value: 'ABC-123 A1', description: 'Side A, etched' },
        { value: 'ABC-123 B1' },
        { value: `${'x'.repeat(239)}…`, description: `${'y'.repeat(119)}…` },
        ...[2, 3, 4].map(variant => ({ value: `ABC-123 A${variant}`, description: 'Side A, etched' })),
      ],
    } } });
  });

  it('keeps the complete album title in a full release response', async () => {
    get.mockResolvedValueOnce({ data: { id: 11, title: 'Side A - Side B', artists: [{ name: 'Artist (2)' }] } });

    await expect(discogs.getRelease(11)).resolves.toMatchObject({ artist: 'Artist (2)', album: 'Side A - Side B' });
    expect(getCached).toHaveBeenCalledExactlyOnceWith('discogs:release:v4:11');
  });

  it('keeps the full artist credit for a collaborative release', async () => {
    get.mockResolvedValueOnce({ data: { id: 11, title: 'Album', artists: [{ name: 'First', join: '&' }, { name: 'Second' }] } });

    await expect(discogs.getRelease(11)).resolves.toMatchObject({ artist: 'First & Second' });
  });

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

async function importPage(page?: string | string[]) {
  let status = 200;
  let body: unknown;
  const req = { query: { page } } as unknown as Request;
  const res = {
    status(code: number) { status = code; return this; },
    json(value: unknown) { body = value; },
  } as Response;
  await importCollection(req, res);
  return { status, body };
}

describe('Discogs collection review', () => {
  const release = (id: number, title: string, catno: string) => ({
    basic_information: {
      id, title, artists: [{ name: 'Fixture artist' }], labels: [{ name: 'Fixture label', catno }],
      formats: [{ name: 'Vinyl', descriptions: ['LP'] }],
    },
  });

  it('returns a continuation when the first page has no eligible releases', async () => {
    get.mockResolvedValueOnce({ data: { username: 'test-collector' } }).mockResolvedValueOnce({
      data: { pagination: { pages: 2 }, releases: [release(11, 'Saved by title', 'TEST11'), release(12, 'Saved by ID', 'TEST12')] },
    });
    query.mockResolvedValueOnce({ rows: [
      { artist: 'fixture artist', album: 'saved by title', discogs_id: 99 },
      { artist: 'different credit', album: 'different title', discogs_id: 12 },
    ] });

    await expect(importPage()).resolves.toEqual({
      status: 200, body: { albums: [], count: 0, page: 1, totalPages: 2, nextPage: 2 },
    });
    expect(get).toHaveBeenLastCalledWith('/users/test-collector/collection/folders/0/releases', {
      params: { page: 1, per_page: 100 },
    });
  });

  it('fetches one requested page and preserves competing releases with their evidence', async () => {
    get.mockResolvedValueOnce({ data: { username: 'test-collector' } }).mockResolvedValueOnce({
      data: { pagination: { pages: 2 }, releases: [
        release(21, 'Side A - Side B', 'FIRST'), release(21, 'Side A - Side B', 'FIRST'), release(22, 'Side A - Side B', 'SECOND'),
      ] },
    });
    query.mockResolvedValueOnce({ rows: [] });

    await expect(importPage('2')).resolves.toMatchObject({
      status: 200, body: { count: 2, page: 2, totalPages: 2, albums: [
        { discogsId: 21, artist: 'Fixture artist', album: 'Side A - Side B', pressing: { catalogNumber: 'FIRST', format: 'Vinyl · LP' } },
        { discogsId: 22, artist: 'Fixture artist', album: 'Side A - Side B', pressing: { catalogNumber: 'SECOND', format: 'Vinyl · LP' } },
      ] },
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenLastCalledWith('/users/test-collector/collection/folders/0/releases', {
      params: { page: 2, per_page: 100 },
    });
  });

  it.each(['0', '-1', '1.5', ['1', '2']])('rejects invalid page %j before contacting Discogs', async page => {
    await expect(importPage(page)).resolves.toMatchObject({ status: 400 });
    expect(get).not.toHaveBeenCalled();
  });
});
