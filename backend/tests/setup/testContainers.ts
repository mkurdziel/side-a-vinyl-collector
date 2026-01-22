import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { Pool } from 'pg';
import Redis from 'ioredis';

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
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/))
    .start();

  // Start Redis container
  redisContainer = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
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
  });

  // Setup Redis connection
  const redisPort = redisContainer.getMappedPort(6379);
  const redisHost = redisContainer.getHost();

  testRedis = new Redis({
    host: redisHost,
    port: redisPort,
  });

  // Run migrations
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
  // Base schema
  await pool.query(`
    CREATE TABLE IF NOT EXISTS artists (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      discogs_id INTEGER UNIQUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS albums (
      id SERIAL PRIMARY KEY,
      artist_id INTEGER REFERENCES artists(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      year INTEGER,
      cover_image_url TEXT,
      discogs_id INTEGER,
      musicbrainz_id VARCHAR(255),
      local_cover_path TEXT,
      cover_art_fetched BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS collection (
      id SERIAL PRIMARY KEY,
      album_id INTEGER REFERENCES albums(id) ON DELETE CASCADE,
      added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      notes TEXT,
      status VARCHAR(50) DEFAULT 'collection'
    );

    CREATE TABLE IF NOT EXISTS barcodes (
      id SERIAL PRIMARY KEY,
      barcode VARCHAR(255) NOT NULL UNIQUE,
      album_id INTEGER REFERENCES albums(id) ON DELETE CASCADE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export function getTestPool() {
  return testPool;
}

export function getTestRedis() {
  return testRedis;
}
