import { EventEmitter } from 'node:events';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Exercise the real pg-pool eviction/reconnect path without a live database.
class FakeClient extends EventEmitter {
  static instances: FakeClient[] = [];
  static queryError: Error | undefined;
  static queryCount = 0;
  _queryable = true;
  password = 'must-not-appear-in-logs';
  ended = false;

  constructor() {
    super();
    FakeClient.instances.push(this);
  }

  connect(callback: (error?: Error) => void) { callback(); }
  query(_sql: string, _values: unknown, callback: (error: Error | null, result?: unknown) => void) {
    FakeClient.queryCount++;
    callback(FakeClient.queryError ?? null, { rows: [{ ok: true }] });
  }
  end(callback?: () => void) {
    this.ended = true;
    callback?.();
  }
}

let pool: Pool;

beforeEach(async () => {
  vi.resetModules();
  FakeClient.instances = [];
  FakeClient.queryError = undefined;
  FakeClient.queryCount = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('Unexpected process exit'); });
  pool = (await import('../../src/config/database')).default;
  // Replace only the socket client; retain the installed pg-pool implementation.
  (pool as unknown as { Client: typeof FakeClient }).Client = FakeClient;
});

afterEach(async () => {
  await pool.end();
  vi.restoreAllMocks();
});

describe('PostgreSQL connection recovery', () => {
  it('evicts a failed idle client and serves the next query without exiting or logging client config', async () => {
    await pool.query('SELECT 1');
    const disconnectedClient = FakeClient.instances[0]!;
    const error = Object.assign(new Error('Connection terminated unexpectedly'), { code: 'ECONNRESET' });

    expect(() => disconnectedClient.emit('error', error)).not.toThrow();
    expect(disconnectedClient.ended).toBe(true);
    expect(pool.totalCount).toBe(0);
    expect(process.exit).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      'Idle PostgreSQL connection failed; the pool will reconnect on demand',
      { message: error.message, code: 'ECONNRESET' },
    );
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(disconnectedClient.password);

    await expect(pool.query('SELECT 1')).resolves.toEqual({ rows: [{ ok: true }] });
    expect(FakeClient.instances).toHaveLength(2);
    expect(pool.idleCount).toBe(1);
  });

  it('propagates query failures without replaying writes', async () => {
    const error = new Error('connection dropped during query');
    FakeClient.queryError = error;

    await expect(pool.query('INSERT INTO albums DEFAULT VALUES')).rejects.toBe(error);
    expect(FakeClient.queryCount).toBe(1);
    expect(FakeClient.instances[0]!.ended).toBe(true);
    expect(process.exit).not.toHaveBeenCalled();
  });
});
