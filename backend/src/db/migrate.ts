import pool from '../config/database';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

async function runMigration() {
  try {
    console.log('Starting database migration...');

    // 1. Run base schema
    const schemaPath = join(import.meta.dir, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    await pool.query(schema);
    console.log('✓ Applied base schema');

    // 2. Run migrations from migrations/ folder
    const migrationsDir = join(import.meta.dir, 'migrations');
    
    // Check if directory exists
    let migrationFiles: string[] = [];
    try {
      migrationFiles = readdirSync(migrationsDir)
        .filter(file => file.endsWith('.sql'))
        .sort(); // Run in alphabetical order
    } catch (e) {
      console.log('No migrations folder found or empty');
    }

    for (const file of migrationFiles) {
      console.log(`Running migration: ${file}`);
      const migrationPath = join(migrationsDir, file);
      const migrationSql = readFileSync(migrationPath, 'utf-8');
      await pool.query(migrationSql);
      console.log(`✓ Applied ${file}`);
    }

    console.log('✓ Database migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('✗ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
