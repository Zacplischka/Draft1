import { Pool } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { createRoomServer, type VerifyToken } from './server/engine';
import { migrate } from './server/db';
import { serveSpa } from './server/static';

async function main(): Promise<void> {
  const { DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PORT = '3001' } = process.env;
  if (!DATABASE_URL || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('DATABASE_URL, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const verifyToken: VerifyToken = async (token) => {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    const meta = data.user.user_metadata ?? {};
    return {
      userId: data.user.id,
      // Google name only — never fall back to email (it would leak into the host's roster).
      displayName: meta.full_name ?? meta.name ?? 'Unknown',
    };
  };

  const pool = new Pool({ connectionString: DATABASE_URL });
  await migrate(pool);
  const server = createRoomServer(pool, verifyToken);
  serveSpa(server.http); // the built client (npm run build), when dist/ exists
  server.http.listen(Number(PORT), () => {
    console.log(`room engine listening on :${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
