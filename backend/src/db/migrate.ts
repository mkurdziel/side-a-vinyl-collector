import pool from '../config/database';
import { readFileSync } from 'fs';
import { join } from 'path';

async function runMigration() {
  try {
    console.log('Starting database migration...');

    const schemaPath = join(import.meta.dir, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');

    await pool.query(schema);

    console.log('✓ Database migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('✗ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
