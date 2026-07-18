import { createHash } from 'node:crypto';
import type { VerifyToken } from './engine';

// Local-dev token verifier mirroring the test stub (docs/SPEC.md "Stubbed boundary"):
// token "dev:<name>" → stable fake identity, so no Supabase credentials exist in dev.
// Wired ONLY by scripts/dev-server.ts — src/index.ts always verifies real Supabase tokens.
export const devVerifyToken: VerifyToken = async (token) => {
  if (!token.startsWith('dev:')) return null;
  const name = token.slice(4).trim();
  if (!name) return null;
  // Name → deterministic uuid (profiles.id is a uuid column), same shape as a v4.
  const h = createHash('sha256').update(name).digest('hex');
  const userId = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
  return { userId, displayName: name };
};
