import { afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setupTestContainers, teardownTestContainers } from './testContainers';

// Configure disposable services before importing application modules. Never use
// credentials, artwork, or external services inherited from the developer shell.
delete process.env.REDIS_USERNAME;
delete process.env.REDIS_PASSWORD;
process.env.MUSICBRAINZ_ENABLED = 'false';
const artworkDir = await mkdtemp(path.join(tmpdir(), 'vinyl-test-art-'));
process.env.COVER_ART_STORAGE_PATH = artworkDir;

await setupTestContainers();

afterAll(async () => {
  const [{ default: pool }, { default: redis }] = await Promise.all([
    import('../../src/config/database'),
    import('../../src/config/redis'),
  ]);
  await pool.end();
  await redis.quit();
  await teardownTestContainers();
  await rm(artworkDir, { recursive: true, force: true });
});
