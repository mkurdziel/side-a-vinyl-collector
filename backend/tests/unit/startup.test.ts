import { describe, expect, it, vi } from 'vitest';
import { startAfterMigrations } from '../../src/start';

describe('container startup', () => {
  it('waits for a successful migration before starting the server', async () => {
    let finishMigration!: (exitCode: number) => void;
    const migrate = vi.fn(() => new Promise<number>(resolve => { finishMigration = resolve; }));
    const serve = vi.fn(async () => undefined);
    const startup = startAfterMigrations({ migrate, serve });

    expect(serve).not.toHaveBeenCalled();
    finishMigration(0);
    await expect(startup).resolves.toBe(0);
    expect(serve).toHaveBeenCalledOnce();
  });

  it('preserves the migration failure code and never starts the server', async () => {
    const serve = vi.fn(async () => undefined);
    await expect(startAfterMigrations({ migrate: async () => 37, serve })).resolves.toBe(37);
    expect(serve).not.toHaveBeenCalled();
  });

  it('never starts the server if launching migrations throws', async () => {
    const serve = vi.fn(async () => undefined);
    await expect(startAfterMigrations({
      migrate: async () => { throw new Error('Migration process could not start'); },
      serve,
    })).rejects.toThrow('Migration process could not start');
    expect(serve).not.toHaveBeenCalled();
  });
});
