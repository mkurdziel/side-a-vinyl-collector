import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { readFile } from 'node:fs/promises';

let postgresContainer: StartedTestContainer;
let redisContainer: StartedTestContainer;
let testPool: Pool;
let testRedis: Redis;

export async function setupTestContainers() {
  // Start PostgreSQL container
  postgresContainer = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({
      POSTGRES_DB: 'test_vinyl',
      POSTGRES_USER: 'test_user',
      POSTGRES_PASSWORD: 'test_pass',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(120000)
    .start();

  // Start Redis container
  redisContainer = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .withStartupTimeout(60000)
    .start();

  // Setup database connection
  const postgresPort = postgresContainer.getMappedPort(5432);
  const postgresHost = postgresContainer.getHost();

  testPool = new Pool({
    host: postgresHost,
    port: postgresPort,
    database: 'test_vinyl',
    user: 'test_user',
    password: 'test_pass',
    max: 10,
    connectionTimeoutMillis: 10000,
  });

  // Setup Redis connection
  const redisPort = redisContainer.getMappedPort(6379);
  const redisHost = redisContainer.getHost();

  testRedis = new Redis({
    protocol: 2,
    host: redisHost,
    port: redisPort,
    retryStrategy: (times) => Math.min(times * 50, 2000),
  });

  await testRedis.ping();

  // Apply production migrations to the disposable database.
  await runMigrations(testPool);

  // Set environment variables for tests
  process.env.POSTGRES_HOST = postgresHost;
  process.env.POSTGRES_PORT = postgresPort.toString();
  process.env.POSTGRES_DB = 'test_vinyl';
  process.env.POSTGRES_USER = 'test_user';
  process.env.POSTGRES_PASSWORD = 'test_pass';
  process.env.REDIS_HOST = redisHost;
  process.env.REDIS_PORT = redisPort.toString();
  process.env.REDIS_DB = '0';

  return { testPool, testRedis };
}

export async function teardownTestContainers() {
  await testPool?.end();
  await testRedis?.quit();
  await postgresContainer?.stop();
  await redisContainer?.stop();
}

async function runMigrations(pool: Pool) {
  // Exercise the same schema and migrations as the deployed application.
  await pool.query(await readFile(new URL('../../src/db/schema.sql', import.meta.url), 'utf8'));
  for (const migration of ['001_add_musicbrainz_and_local_cover.sql', '002_add_collection_status.sql']) {
    await pool.query(await readFile(new URL(`../../src/db/migrations/${migration}`, import.meta.url), 'utf8'));
  }
}

export function getTestPool() {
  return testPool;
}

export function getTestRedis() {
  return testRedis;
}
