import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { jsonBodyParser } from '../../src/middleware/requestBody';
import { errorHandler } from '../../src/middleware/errorHandler';

async function parse(body: string) {
  const req = Object.assign(Readable.from([Buffer.from(body)]), {
    headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) },
  }) as unknown as Request;
  await new Promise<void>((resolve, reject) => {
    jsonBodyParser(req, {} as Response, (error?: unknown) => error ? reject(error) : resolve());
  });
  return req.body;
}

function respond(error: Error) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  errorHandler(error, {} as Request, res as unknown as Response, vi.fn());
  return res;
}

describe('image JSON request bodies', () => {
  it('accepts a full 10 MiB image after base64 encoding', async () => {
    const image = `data:image/jpeg;base64,${Buffer.alloc(10 * 1024 * 1024).toString('base64')}`;
    await expect(parse(JSON.stringify({ image }))).resolves.toEqual({ image });
  });

  it('returns a useful 413 response when the JSON limit is exceeded', async () => {
    const error = await parse(JSON.stringify({ image: 'a'.repeat(15 * 1024 * 1024) })).catch(error => error);
    const res = respond(error);
    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith({ error: 'Image must be less than 10MB', status: 'error' });
  });

  it('returns a client error for malformed JSON', async () => {
    const error = await parse('{"image":').catch(error => error);
    const res = respond(error);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid JSON request body', status: 'error' });
  });
});
