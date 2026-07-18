import { Pool } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { createRoomServer, type VerifyToken } from './server/engine';
import { migrate } from './server/db';

async function main(): Promise<void> {
  const { DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PORT = '3001' } = process.env;
  if (!DATABASE_URL || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('DATABASE_URL, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const verifyToken: VerifyToken = async (token) => {
    const { data, error } = await supabase.auth.getUser(token);
    return error || !data.user ? null : { userId: data.user.id };
  };

  const pool = new Pool({ connectionString: DATABASE_URL });
  await migrate(pool);
  createRoomServer(pool, verifyToken).http.listen(Number(PORT), () => {
    console.log(`room engine listening on :${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
