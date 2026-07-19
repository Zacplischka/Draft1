import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startHarness, type Harness, type TestClient } from './harness';
import { cancelSession } from '../src/client/host-lobby';
import { rejoinSession } from '../src/client/reconnect';
import type { SessionCancelled } from '../src/shared/contract';

const joinCodes = vi.hoisted(() => [] as number[]);
vi.mock('node:crypto', async (importOriginal) => {
  const crypto = await importOriginal<typeof import('node:crypto')>();
  return {
    ...crypto,
    randomInt: (min: number, max: number) =>
      min === 0 && max === 1_000_000 && joinCodes.length ? joinCodes.shift()! : crypto.randomInt(min, max),
  };
});

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 120_000);

afterAll(async () => {
  await h.stop();
});

describe('Cancel session', () => {
  const cancelled = (client: TestClient) =>
    new Promise<SessionCancelled>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for session:cancelled')), 1000);
      client.socket.once('session:cancelled', (event) => {
        clearTimeout(timer);
        resolve(event);
      });
    });

  it('ejects live participants and removes the session from every public lookup', async () => {
    joinCodes.push(749_271, 749_271);
    const hostIdentity = await h.mintIdentity();
    const host = await h.connect(hostIdentity);
    const created = await host.emit('session:create', {
      problem: 'Which customer problem should we solve next?',
      workflow: 'preset',
      hostParticipates: false,
    });
    await host.emit('solution:add', { text: 'Improve onboarding' });

    const participant = await h.connect(await h.mintIdentity());
    const secondParticipant = await h.connect(await h.mintIdentity());
    await participant.emit('session:join', { joinCode: created.joinCode });
    await secondParticipant.emit('session:join', { joinCode: created.joinCode });
    await host.emit('voting:start', {});
    const deck = (await participant.stateWhere((s) => s.phase === 'voting')).deck!;
    await participant.emit('ballot:submit', { scores: { [deck[0]!.id]: 80 } });

    const secondHostTab = await h.connect(hostIdentity);
    await rejoinSession(secondHostTab.emit, created.sessionId);
    const participantEjected = cancelled(participant);
    const hostTabEjected = cancelled(secondHostTab);
    await cancelSession(host.emit);

    await expect(participantEjected).resolves.toEqual({ sessionId: created.sessionId, isHost: false });
    await expect(hostTabEjected).resolves.toEqual({ sessionId: created.sessionId, isHost: true });
    expect(await rejoinSession(participant.emit, created.sessionId)).toBe('stale');
    expect(await participant.emit('session:preview', { joinCode: created.joinCode })).toEqual({ error: 'not-found' });

    const history = await fetch(`${h.url()}/api/sessions`, {
      headers: { authorization: `Bearer ${hostIdentity.token}` },
    });
    expect(await history.json()).toEqual([]);

    const replacement = await host.emit('session:create', {
      problem: 'A new session can reuse the code immediately',
      workflow: 'crowdsourced',
      hostParticipates: false,
    });
    expect(replacement).toMatchObject({ ok: true, joinCode: created.joinCode });
  });

  it('rejects a participant without touching the live session', async () => {
    const host = await h.connect(await h.mintIdentity());
    const created = await host.emit('session:create', {
      problem: 'Where should the offsite be?',
      workflow: 'crowdsourced',
      hostParticipates: false,
    });
    const participant = await h.connect(await h.mintIdentity());
    await participant.emit('session:join', { joinCode: created.joinCode });

    await expect(cancelSession(participant.emit)).rejects.toThrow('not-host');
    await expect(rejoinSession(host.emit, created.sessionId)).resolves.toBe('rejoined');
  });

  it('rejects cancellation after the session has reached the ranked list', async () => {
    const host = await h.connect(await h.mintIdentity());
    const created = await host.emit('session:create', {
      problem: 'Which launch date works best?',
      workflow: 'preset',
      hostParticipates: true,
    });
    await host.emit('solution:add', { text: 'October' });
    await host.emit('voting:start', {});
    const deck = (await host.stateWhere((s) => s.sessionId === created.sessionId && s.phase === 'voting')).deck!;
    await host.emit('ballot:submit', { scores: { [deck[0]!.id]: 70 } });
    await host.stateWhere((s) => s.sessionId === created.sessionId && s.phase === 'results');

    await expect(cancelSession(host.emit)).rejects.toThrow('bad-phase');
    await expect(rejoinSession(host.emit, created.sessionId)).resolves.toBe('rejoined');
  });
});
