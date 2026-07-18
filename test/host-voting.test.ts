import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './harness';
import type { SessionState } from '../src/shared/contract';
import { closeVoting, everyoneVotedAdvance, initials } from '../src/client/host-voting';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 120_000);

afterAll(async () => {
  await h.stop();
});

/** Preset session already in voting: host + one participant. */
async function votingRoom() {
  const host = await h.connect(await h.mintIdentity());
  const created = await host.emit('session:create', {
    problem: 'Which customer problem should we solve next?',
    workflow: 'preset',
    hostParticipates: true,
  });
  const participant = await h.connect(await h.mintIdentity());
  await participant.emit('session:join', { joinCode: created.joinCode });
  await host.emit('solution:add', { text: 'Alpha' });
  await host.emit('voting:start', {});
  await host.stateWhere((s) => s.phase === 'voting');
  return { host, participant, sessionId: created.sessionId as string };
}

describe('closeVoting: the host escape hatch, race acks routed not errored', () => {
  it('ok → closed; everyone advances to results', async () => {
    const { host, participant, sessionId } = await votingRoom();
    expect(await closeVoting(host.emit)).toBe('closed');
    const s = await participant.stateWhere((x) => x.sessionId === sessionId && x.phase === 'results');
    expect(s.results).toBeDefined();
  });

  it('bad-phase (already at results — e.g. the last ballot landed mid-dialog) → closed, not an error', async () => {
    const { host } = await votingRoom();
    await closeVoting(host.emit);
    expect(await closeVoting(host.emit)).toBe('closed');
  });

  it('other codes still throw', async () => {
    const { participant } = await votingRoom();
    await expect(closeVoting(participant.emit)).rejects.toThrow('not-host');
  });
});

describe('everyoneVotedAdvance: the "Everyone has voted — opening the Ranked list…" toast', () => {
  const snap = (over: Partial<SessionState>): SessionState =>
    ({
      sessionId: 's1',
      problem: 'p',
      workflow: 'preset',
      phase: 'voting',
      participants: { count: 4, cap: 8 },
      isHost: false,
      hostParticipates: true,
      me: { submitted: false, voted: true },
      ...over,
    }) as SessionState;

  it('fires on voting → results when the previous snapshot showed one ballot outstanding', () => {
    const prev = snap({ votingProgress: { voted: 3, total: 4 } });
    expect(everyoneVotedAdvance(prev, snap({ phase: 'results' }))).toBe(true);
  });

  it('does not fire on an early host close (ballots still outstanding)', () => {
    const prev = snap({ votingProgress: { voted: 1, total: 4 } });
    expect(everyoneVotedAdvance(prev, snap({ phase: 'results' }))).toBe(false);
  });

  it('does not fire without a prior voting snapshot, across sessions, or on ordinary progress updates', () => {
    const prev = snap({ votingProgress: { voted: 3, total: 4 } });
    expect(everyoneVotedAdvance(null, snap({ phase: 'results' }))).toBe(false);
    expect(everyoneVotedAdvance(prev, snap({ phase: 'results', sessionId: 'other' }))).toBe(false);
    expect(everyoneVotedAdvance(prev, snap({ votingProgress: { voted: 4, total: 4 } }))).toBe(false);
  });
});

describe('initials: roster avatar chips', () => {
  it('first letters of the first two words, uppercased', () => {
    expect(initials('Aisha Khan')).toBe('AK');
    expect(initials('Cher')).toBe('C');
    expect(initials('  ben   lee  jones ')).toBe('BL');
  });
});
