import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const { get, query } = vi.hoisted(() => ({ get: vi.fn(), query: vi.fn() }));
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, create: () => ({ get }) } };
});
vi.mock('../../src/config/database', () => ({ default: { query } }));
vi.mock('../../src/config/redis', () => ({
  default: { get: vi.fn().mockResolvedValue(null), setex: vi.fn().mockResolvedValue('OK') },
}));

import { scanBarcode } from '../../src/controllers/barcodeController';
import { errorHandler } from '../../src/middleware/errorHandler';

function lookup() {
  return new Promise<{ status: number; body: unknown }>((resolve) => {
    let status = 200;
    const req = { body: { barcode: '0602537340436' } } as Request;
    const res = {
      status(code: number) { status = code; return this; },
      json(body: unknown) { resolve({ status, body }); },
    } as Response;
    scanBarcode(req, res, error => errorHandler(error, req, res, vi.fn()));
  });
}

function upstreamError(code?: string, status?: number) {
  return Object.assign(new Error('Upstream request failed'), {
    isAxiosError: true, code, response: status ? { status } : undefined,
    config: { headers: { Authorization: 'Discogs token=fixture-secret' } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  query.mockResolvedValue({ rows: [] });
});
afterEach(() => vi.restoreAllMocks());

describe('barcode lookup failures', () => {
  it.each(['ECONNABORTED', 'ETIMEDOUT'])('reports a retryable Discogs timeout (%s)', async code => {
    get.mockRejectedValue(upstreamError(code));
    await expect(lookup()).resolves.toEqual({
      status: 503,
      body: { error: 'Discogs took too long to respond. Please try again.', status: 'error' },
    });
    expect(get).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('fixture-secret');
    expect(console.error).toHaveBeenCalledWith('Discogs barcode search error:', { code, status: undefined });
  });

  it.each([429, 503])('reports an unavailable upstream service (%s)', async status => {
    get.mockRejectedValue(upstreamError('ERR_BAD_RESPONSE', status));
    expect((await lookup()).status).toBe(503);
  });

  it('preserves a genuine barcode miss as 404', async () => {
    get.mockResolvedValue({ data: { results: [] } });
    await expect(lookup()).resolves.toEqual({
      status: 404, body: { error: 'No album found for this barcode', status: 'error' },
    });
  });

  it('does not classify programming errors as temporary service outages', async () => {
    get.mockRejectedValue(new TypeError('Invalid response handling'));
    expect((await lookup()).status).toBe(500);
  });
});
