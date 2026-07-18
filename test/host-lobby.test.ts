import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './harness';
import { createSession } from '../src/client/create-session';
import { joinSession } from '../src/client/join-session';
import { submitSolution } from '../src/client/submit-solution';
import {
  addSolution,
  beginCuration,
  combineSolutions,
  defaultCombinedText,
  deleteSolution,
  editSolution,
  hostSteps,
  startVoting,
} from '../src/client/host-lobby';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 120_000);

afterAll(async () => {
  await h.stop();
});

async function room(workflow: 'crowdsourced' | 'preset', solutions: string[] = [], hostParticipates = true) {
  const host = await h.connect(await h.mintIdentity());
  const { sessionId, joinCode } = await createSession(
    host.emit,
    { problem: 'Which customer problem should we solve next?', workflow, cap: 8, hostParticipates },
    solutions,
  );
  return { host, sessionId, joinCode };
}

describe('host lobby logic', () => {
  it('hostSteps: curation only in the crowdsourced stepper', () => {
    expect(hostSteps('crowdsourced')).toEqual(['Lobby', 'Curation', 'Voting', 'Ranked list']);
    expect(hostSteps('preset')).toEqual(['Lobby', 'Voting', 'Ranked list']);
  });

  it('preset deck rows: add, edit, delete land in the host snapshot in insertion order', async () => {
    const { host, sessionId } = await room('preset', ['Improve onboarding', 'Reduce time to first value']);
    await addSolution(host.emit, 'Offer better integrations');
    let s = await host.stateWhere((x) => x.sessionId === sessionId && x.deck?.length === 3);
    expect(s.deck!.map((d) => d.text)).toEqual([
      'Improve onboarding',
      'Reduce time to first value',
      'Offer better integrations',
    ]);
    await editSolution(host.emit, s.deck![1]!.id, 'Reduce time to value');
    s = await host.stateWhere((x) => x.deck?.some((d) => d.text === 'Reduce time to value') ?? false);
    await deleteSolution(host.emit, s.deck![0]!.id);
    s = await host.stateWhere((x) => x.sessionId === sessionId && x.deck?.length === 2);
    expect(s.deck!.map((d) => d.text)).toEqual(['Reduce time to value', 'Offer better integrations']);
  });

  it('preset startVoting: empty-deck is an inline result, a real deck starts voting', async () => {
    const { host, sessionId } = await room('preset');
    expect(await startVoting(host.emit)).toBe('empty-deck');
    await addSolution(host.emit, 'Only option');
    expect(await startVoting(host.emit)).toBe('started');
    const s = await host.stateWhere((x) => x.sessionId === sessionId && x.phase === 'voting');
    expect(s.phase).toBe('voting');
  });

  it('startVoting still throws unexpected codes (participant → not-host)', async () => {
    const { joinCode } = await room('preset', ['A']);
    const participant = await h.connect(await h.mintIdentity());
    await joinSession(participant.emit, joinCode);
    await expect(startVoting(participant.emit)).rejects.toThrow('not-host');
  });

  it('crowdsourced: submissions arrive live in the host deck; beginCuration is legal at zero', async () => {
    const { host, sessionId, joinCode } = await room('crowdsourced', [], false);
    const participant = await h.connect(await h.mintIdentity());
    await joinSession(participant.emit, joinCode);
    await submitSolution(participant.emit, 'Simplify account setup');
    const s = await host.stateWhere((x) => x.sessionId === sessionId && x.deck?.length === 1);
    expect(s.deck![0]!.text).toBe('Simplify account setup');
    expect(s.submissions).toEqual({ submitted: 1, total: 1 }); // non-participating host excluded

    const zero = await room('crowdsourced');
    await beginCuration(zero.host.emit);
    const z = await zero.host.stateWhere((x) => x.sessionId === zero.sessionId && x.phase === 'curation');
    expect(z.phase).toBe('curation');
  });

  it('combineSolutions: default " / " join lands as one combined row; edited text used verbatim', async () => {
    expect(defaultCombinedText(['A', 'B'])).toBe('A / B');
    const { host, sessionId, joinCode } = await room('crowdsourced', [], false);
    const participant = await h.connect(await h.mintIdentity());
    await joinSession(participant.emit, joinCode);
    await submitSolution(participant.emit, 'Improve onboarding');
    await beginCuration(host.emit);
    await addSolution(host.emit, 'Add guided setup');
    let s = await host.stateWhere((x) => x.sessionId === sessionId && x.deck?.length === 2);
    await combineSolutions(host.emit, s.deck!.map((d) => d.id), 'Improve onboarding / Add guided setup');
    s = await host.stateWhere((x) => x.sessionId === sessionId && x.deck?.length === 1);
    expect(s.deck![0]).toMatchObject({ text: 'Improve onboarding / Add guided setup', combined: true });
  });

  it('a participating host submits like anyone else and is counted', async () => {
    const { host, sessionId } = await room('crowdsourced');
    expect(await submitSolution(host.emit, 'Provide in-app guidance')).toBe('submitted');
    const s = await host.stateWhere((x) => x.sessionId === sessionId && x.me.submitted);
    expect(s.submissions).toEqual({ submitted: 1, total: 1 });
    expect(s.deck!.map((d) => d.text)).toEqual(['Provide in-app guidance']);
  });
});
