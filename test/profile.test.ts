import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './harness';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 120_000);

afterAll(async () => {
  await h.stop();
});

const CREATE = { problem: 'Where should we hold the offsite?', workflow: 'crowdsourced', hostParticipates: true };
const PROFILE = { department: 'Engineering', role: 'Manager', tenure: '2–5 years' };

describe('profile capture and edit (ticket #2)', () => {
  it('a profile-less identity gets profile-required from session:create and session:join; both succeed after profile:set', async () => {
    const host = await h.connect(await h.mintIdentity());
    const created = await host.emit('session:create', CREATE);

    const bare = await h.connect(await h.mintIdentity({ profile: null }));
    expect(await bare.emit('session:create', CREATE)).toEqual({ error: 'profile-required' });
    expect(await bare.emit('session:join', { joinCode: created.joinCode })).toEqual({ error: 'profile-required' });
    expect(await bare.emit('session:preview', { joinCode: created.joinCode })).toEqual({ error: 'profile-required' });

    expect(await bare.emit('profile:set', PROFILE)).toEqual({ ok: true });
    expect((await bare.emit('session:join', { joinCode: created.joinCode })).ok).toBe(true);
    expect((await bare.emit('session:create', CREATE)).ok).toBe(true);
  });

  it('values outside the app-shipped enums ack invalid-input', async () => {
    const c = await h.connect(await h.mintIdentity({ profile: null }));
    for (const bad of [
      { ...PROFILE, department: 'Astrology' },
      { ...PROFILE, role: 'Wizard' },
      { ...PROFILE, tenure: '100 years' },
      { ...PROFILE, department: undefined },
      {},
      null,
    ]) {
      expect(await c.emit('profile:set', bad)).toEqual({ error: 'invalid-input' });
    }
    // Nothing was stored — the gate still bites.
    expect(await c.emit('session:create', CREATE)).toEqual({ error: 'profile-required' });
  });

  it('profile:set again updates the stored profile', async () => {
    const c = await h.connect(await h.mintIdentity({ profile: null }));
    expect(await c.emit('profile:set', PROFILE)).toEqual({ ok: true });
    const updated = { department: 'Sales', role: 'Director', tenure: '10+ years' };
    expect(await c.emit('profile:set', updated)).toEqual({ ok: true });
    const got = await c.emit('profile:get', {});
    expect(got).toMatchObject({ ok: true, profile: updated });
  });

  it('profile:get is exempt from the gate and returns displayName + null profile for a first-time user', async () => {
    const identity = await h.mintIdentity({ profile: null, displayName: 'Riley from Google' });
    const c = await h.connect(identity);
    expect(await c.emit('profile:get', {})).toEqual({
      ok: true,
      displayName: 'Riley from Google',
      profile: null,
    });
  });

  it('display name comes from the verified token, never the client payload', async () => {
    const identity = await h.mintIdentity({ profile: null, displayName: 'Token Name' });
    const c = await h.connect(identity);
    // A displayName smuggled into the payload is ignored.
    expect(await c.emit('profile:set', { ...PROFILE, displayName: 'Impostor' })).toEqual({ ok: true });
    const { rows } = await h.pool.query('select display_name from profiles where id = $1', [identity.userId]);
    expect(rows[0].display_name).toBe('Token Name');
    expect((await c.emit('profile:get', {})).displayName).toBe('Token Name');
  });
});
