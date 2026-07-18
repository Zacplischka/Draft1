import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './harness';
import { createSession } from '../src/client/create-session';
import { joinSession } from '../src/client/join-session';
import { participantView, percentComplete, submitSolution } from '../src/client/submit-solution';
import type { SessionState } from '../src/shared/contract';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 120_000);

afterAll(async () => {
  await h.stop();
});

const base: SessionState = {
  sessionId: 's',
  problem: 'P',
  workflow: 'crowdsourced',
  phase: 'lobby',
  participants: { count: 2, cap: 8 },
  isHost: false,
  hostParticipates: true,
  me: { submitted: false, voted: false },
};

async function crowdsourcedRoom() {
  const host = await h.connect(await h.mintIdentity());
  const { sessionId, joinCode } = await createSession(
    host.emit,
    { problem: 'Which customer problem should we solve next?', workflow: 'crowdsourced', cap: 8, hostParticipates: true },
    [],
  );
  const participant = await h.connect(await h.mintIdentity());
  await joinSession(participant.emit, joinCode);
  return { host, participant, sessionId, joinCode };
}

describe('crowdsourced participant submit + waiting logic', () => {
  it('participantView: submit only in an unsubmitted lobby, waiting everywhere after', () => {
    expect(participantView(base)).toBe('submit');
    expect(participantView({ ...base, me: { ...base.me, submitted: true } })).toBe('waiting');
    expect(participantView({ ...base, phase: 'curation' })).toBe('waiting'); // joined during curation
    expect(participantView({ ...base, phase: 'curation', me: { ...base.me, submitted: true } })).toBe('waiting');
  });

  it('percentComplete floors like the mock (5/8 → 62%) and survives total 0', () => {
    expect(percentComplete(5, 8)).toBe(62);
    expect(percentComplete(8, 8)).toBe(100);
    expect(percentComplete(0, 0)).toBe(0);
  });

  it('submit → waiting: me.submitted flips, own text echoes back, counts update live', async () => {
    const { participant, sessionId } = await crowdsourcedRoom();
    expect(await submitSolution(participant.emit, 'Prioritise onboarding')).toBe('submitted');
    const s = await participant.stateWhere((x) => x.sessionId === sessionId && x.me.submitted);
    expect(participantView(s)).toBe('waiting');
    expect(s.me.submissionText).toBe('Prioritise onboarding');
    expect(s.submissions).toEqual({ submitted: 1, total: 2 });
  });

  it('a second submit resolves closed (already-submitted) — waiting, not an error', async () => {
    const { participant } = await crowdsourcedRoom();
    await submitSolution(participant.emit, 'once');
    expect(await submitSolution(participant.emit, 'twice')).toBe('closed');
  });

  it('a submit racing curation:start resolves closed (bad-phase) and the snapshot says waiting', async () => {
    const { host, participant, sessionId } = await crowdsourcedRoom();
    await host.emit('curation:start', {});
    expect(await submitSolution(participant.emit, 'too late')).toBe('closed');
    const s = await participant.stateWhere((x) => x.sessionId === sessionId && x.phase === 'curation');
    expect(participantView(s)).toBe('waiting'); // non-submitter waiting, never the form
    expect(s.me.submitted).toBe(false);
  });

  it('invalid-input still throws — only the two race codes are swallowed', async () => {
    const { participant } = await crowdsourcedRoom();
    await expect(submitSolution(participant.emit, '')).rejects.toThrow('invalid-input');
  });

  it('rejoin by sessionId resumes on waiting with the saved submission text', async () => {
    const { participant, sessionId } = await crowdsourcedRoom();
    await submitSolution(participant.emit, 'My saved idea');
    const back = await participant.emit('session:join', { sessionId });
    expect(back.ok).toBe(true);
    const s = await participant.stateWhere((x) => x.sessionId === sessionId && x.me.submitted);
    expect(participantView(s)).toBe('waiting');
    expect(s.me.submissionText).toBe('My saved idea');
  });
});
