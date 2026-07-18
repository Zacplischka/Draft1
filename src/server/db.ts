import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';

// ponytail: resolved from cwd — server and tests both run from the repo root
export const MIGRATIONS_DIR = join(process.cwd(), 'migrations');

export async function migrate(pool: Pool, dir: string = MIGRATIONS_DIR): Promise<void> {
  await pool.query('create table if not exists schema_migrations (name text primary key)');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const applied = await pool.query('select 1 from schema_migrations where name = $1', [file]);
    if (applied.rowCount) continue;
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(readFileSync(join(dir, file), 'utf8'));
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
      await client.query('commit');
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }
}
