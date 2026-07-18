import { describe, expect, it } from 'vitest';
import { devVerifyToken } from '../src/server/dev-auth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('dev-token verifier (ticket #12 local dev auth)', () => {
  it('accepts dev:<name> with a stable, valid-uuid identity', async () => {
    const a = await devVerifyToken('dev:Riley');
    expect(a).not.toBeNull();
    expect(a!.displayName).toBe('Riley');
    expect(a!.userId).toMatch(UUID_RE); // profiles.id is a uuid column — anything else fails inserts
    expect(await devVerifyToken('dev:Riley')).toEqual(a); // same name → same identity across reconnects
    expect((await devVerifyToken('dev:Sam'))!.userId).not.toBe(a!.userId);
  });

  it('rejects non-dev and empty-name tokens', async () => {
    expect(await devVerifyToken('real-supabase-jwt')).toBeNull();
    expect(await devVerifyToken('dev:')).toBeNull();
    expect(await devVerifyToken('dev:   ')).toBeNull();
  });
});
