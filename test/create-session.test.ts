import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './harness';
import { createSession, validateDetails } from '../src/client/create-session';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 120_000);

afterAll(async () => {
  await h.stop();
});

describe('create-session form logic', () => {
  it('validateDetails flags empty problem and cap outside 2–100 (mock validation state)', () => {
    expect(validateDetails('Pick a name', 8)).toEqual({});
    expect(validateDetails('', 8)).toEqual({ problem: 'Enter a problem statement.' });
    expect(validateDetails('   ', 8)).toEqual({ problem: 'Enter a problem statement.' });
    expect(validateDetails('x'.repeat(501), 8)).toEqual({ problem: 'Problem statement is too long.' });
    expect(validateDetails('Pick a name', 101)).toEqual({ cap: 'Enter a number from 2 to 100.' });
    expect(validateDetails('Pick a name', 1)).toEqual({ cap: 'Enter a number from 2 to 100.' });
    expect(validateDetails('Pick a name', 8.5)).toEqual({ cap: 'Enter a number from 2 to 100.' });
    expect(validateDetails('', NaN)).toEqual({
      problem: 'Enter a problem statement.',
      cap: 'Enter a number from 2 to 100.',
    });
  });

  it('crowdsourced create lands the host in a crowdsourced lobby', async () => {
    const host = await h.connect(await h.mintIdentity());
    const { sessionId, joinCode } = await createSession(
      host.emit,
      { problem: 'Pick our team name', workflow: 'crowdsourced', cap: 8, hostParticipates: true },
      [],
    );
    expect(sessionId).toBeTruthy();
    expect(joinCode).toMatch(/^\d{6}$/);
    const state = await host.stateWhere((s) => s.sessionId === sessionId);
    expect(state.workflow).toBe('crowdsourced');
    expect(state.phase).toBe('lobby');
    expect(state.isHost).toBe(true);
    expect(state.participants).toEqual({ count: 1, cap: 8 });
  });

  it('preset create adds one solution:add per row, deck in entry order', async () => {
    const host = await h.connect(await h.mintIdentity());
    const { sessionId } = await createSession(
      host.emit,
      { problem: 'Q3 roadmap themes', workflow: 'preset', cap: 12, hostParticipates: false },
      ['Improve onboarding for new users', 'Reduce time to first value', 'Offer better integrations'],
    );
    const state = await host.stateWhere((s) => s.sessionId === sessionId && (s.deck?.length ?? 0) === 3);
    expect(state.workflow).toBe('preset');
    expect(state.phase).toBe('lobby');
    expect(state.hostParticipates).toBe(false);
    expect(state.deck!.map((d) => d.text)).toEqual([
      'Improve onboarding for new users',
      'Reduce time to first value',
      'Offer better integrations',
    ]);
  });

  it('rejects a server-side invalid create with the ack error code', async () => {
    const host = await h.connect(await h.mintIdentity());
    await expect(
      createSession(host.emit, { problem: '', workflow: 'crowdsourced', cap: 8, hostParticipates: true }, []),
    ).rejects.toThrow('invalid-input');
  });
});
