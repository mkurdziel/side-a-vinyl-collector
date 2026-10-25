import { Pool } from 'pg';

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  database: process.env.POSTGRES_DB || 'vinyl_collector',
  user: process.env.POSTGRES_USER || 'vinyl_user',
  password: process.env.POSTGRES_PASSWORD || 'password',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  // pg-pool has already removed the failed idle client. Future checkouts open
  // a replacement connection; terminating here also interrupts healthy requests.
  // Do not log the whole error: pg-pool attaches the client, including its config.
  console.error('Idle PostgreSQL connection failed; the pool will reconnect on demand', {
    message: err.message,
    code: (err as Error & { code?: string }).code,
  });
});

export default pool;
