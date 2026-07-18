// Issue #23: client rejoin logic — stored-sessionId auto-rejoin, stale cleanup,
// cold-load results → home. Server-side any-phase rejoin itself is resilience.test.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './harness';
import { landedRoute, rejoinSession } from '../src/client/reconnect';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 120_000);

afterAll(async () => {
  await h.stop();
});

describe('rejoinSession: the auto-rejoin emit on reconnect and cold load', () => {
  it('a member rejoins by sessionId (any phase, role-agnostic) → rejoined', async () => {
    const host = await h.connect(await h.mintIdentity());
    const created = await host.emit('session:create', {
      problem: 'Pick our team name',
      workflow: 'crowdsourced',
      hostParticipates: true,
    });
    const member = await h.connect(await h.mintIdentity());
    await member.emit('session:join', { joinCode: created.joinCode });

    expect(await rejoinSession(host.emit, created.sessionId)).toBe('rejoined');
    expect(await rejoinSession(member.emit, created.sessionId)).toBe('rejoined');
  });

  it("a dead or non-member sessionId acks not-found → stale (clear storage, go home)", async () => {
    const host = await h.connect(await h.mintIdentity());
    const created = await host.emit('session:create', {
      problem: 'Pick our team name',
      workflow: 'preset',
      hostParticipates: true,
    });
    const stranger = await h.connect(await h.mintIdentity());
    // Non-member's sessionId join acks not-found even though the id resolves (contract).
    expect(await rejoinSession(stranger.emit, created.sessionId)).toBe('stale');
    expect(await rejoinSession(stranger.emit, '00000000-0000-0000-0000-000000000000')).toBe('stale');
  });

  it('other error codes throw — never silently treated as stale', async () => {
    await expect(rejoinSession(async () => ({ error: 'invalid-input' }), 'x')).rejects.toThrow('invalid-input');
  });
});

describe('landedRoute: where a rejoin snapshot lands', () => {
  it('cold-load auto-rejoin onto results goes home (finished session, not user-initiated)', () => {
    expect(landedRoute('cold', 'results')).toBe('home');
  });

  it('every live phase resumes in-session; a reconnect stays even at results', () => {
    expect(landedRoute('cold', 'lobby')).toBe('session');
    expect(landedRoute('cold', 'curation')).toBe('session');
    expect(landedRoute('cold', 'voting')).toBe('session');
    expect(landedRoute('reconnect', 'results')).toBe('session');
  });
});
