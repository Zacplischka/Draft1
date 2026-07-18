// Zero-config local dev: embedded Postgres + room engine with dev-token auth.
// No Supabase credentials involved — see README.md "Local development".
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Pool } from 'pg';
import { createRoomServer } from '../src/server/engine';
import { devVerifyToken } from '../src/server/dev-auth';
import { migrate } from '../src/server/db';
import { serveSpa } from '../src/server/static';

const DATA_DIR = join(process.cwd(), '.dev-pg');
const PG_PORT = 5499;
const PORT = Number(process.env.ENGINE_PORT ?? 3001); // keep in sync with vite.config.mts proxy

async function main(): Promise<void> {
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'postgres',
    password: 'postgres',
    port: PG_PORT,
    persistent: true, // sessions survive dev-server restarts
  });
  if (!existsSync(join(DATA_DIR, 'PG_VERSION'))) await pg.initialise();
  await pg.start();
  await pg.createDatabase('draft1_dev').catch(() => {}); // already exists on re-run
  const pool = new Pool({
    host: 'localhost',
    port: PG_PORT,
    user: 'postgres',
    password: 'postgres',
    database: 'draft1_dev',
  });
  await migrate(pool);
  const server = createRoomServer(pool, devVerifyToken);
  serveSpa(server.http); // serves dist/ if built; normally the vite dev server is the client
  server.http.listen(PORT, () => {
    console.log(`dev room engine on :${PORT} — dev-token auth, sign in with any name`);
  });
  const stop = async () => {
    await pool.end();
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
