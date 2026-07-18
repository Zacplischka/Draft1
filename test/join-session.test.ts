import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './harness';
import { createSession } from '../src/client/create-session';
import { joinSession, previewSession, screenFor, type Preview } from '../src/client/join-session';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 120_000);

afterAll(async () => {
  await h.stop();
});

const base: Preview = {
  problem: 'P',
  workflow: 'crowdsourced',
  phase: 'lobby',
  participants: { count: 1, cap: 8 },
  isMember: false,
};

describe('join-session flow logic', () => {
  it('screenFor maps a preview to the mock-04 screen', () => {
    expect(screenFor(base)).toBe('found');
    expect(screenFor({ ...base, participants: { count: 8, cap: 8 } })).toBe('full');
    expect(screenFor({ ...base, phase: 'voting' })).toBe('voting-started');
    // Members get Rejoin even when the full/voting-started blocks would apply.
    expect(screenFor({ ...base, phase: 'voting', participants: { count: 8, cap: 8 }, isMember: true })).toBe(
      'rejoin',
    );
  });

  it('preview returns session info; a wrong code throws not-found', async () => {
    const host = await h.connect(await h.mintIdentity());
    const { joinCode } = await createSession(
      host.emit,
      { problem: 'Pick our team name', workflow: 'crowdsourced', cap: 8, hostParticipates: true },
      [],
    );
    const joiner = await h.connect(await h.mintIdentity());
    const p = await previewSession(joiner.emit, joinCode);
    expect(p.problem).toBe('Pick our team name');
    expect(p.workflow).toBe('crowdsourced');
    expect(p.phase).toBe('lobby');
    expect(p.participants).toEqual({ count: 1, cap: 8 });
    expect(p.isMember).toBe(false);
    expect(screenFor(p)).toBe('found');

    const wrong = joinCode === '000000' ? '000001' : '000000';
    await expect(previewSession(joiner.emit, wrong)).rejects.toThrow('not-found');
  });

  it('join admits a new participant and returns the sessionId rejoin key', async () => {
    const host = await h.connect(await h.mintIdentity());
    const { sessionId, joinCode } = await createSession(
      host.emit,
      { problem: 'Lunch spot', workflow: 'crowdsourced', cap: 8, hostParticipates: true },
      [],
    );
    const joiner = await h.connect(await h.mintIdentity());
    expect(await joinSession(joiner.emit, joinCode)).toBe(sessionId);
    const state = await joiner.stateWhere((s) => s.sessionId === sessionId);
    expect(state.participants.count).toBe(2);
  });

  it('a full session previews as full and join races ack session-full', async () => {
    const host = await h.connect(await h.mintIdentity());
    const { joinCode } = await createSession(
      host.emit,
      { problem: 'Tiny room', workflow: 'crowdsourced', cap: 2, hostParticipates: true },
      [],
    );
    await joinSession((await h.connect(await h.mintIdentity())).emit, joinCode);

    const late = await h.connect(await h.mintIdentity());
    expect(screenFor(await previewSession(late.emit, joinCode))).toBe('full');
    await expect(joinSession(late.emit, joinCode)).rejects.toThrow('session-full');
  });

  it('voting locks new joiners; an existing member rejoins idempotently, even during voting', async () => {
    const host = await h.connect(await h.mintIdentity());
    const { sessionId, joinCode } = await createSession(
      host.emit,
      { problem: 'Roadmap', workflow: 'preset', cap: 8, hostParticipates: true },
      ['Option A'],
    );
    const member = await h.connect(await h.mintIdentity());
    expect(await joinSession(member.emit, joinCode)).toBe(sessionId);
    // Rejoin before voting is idempotent — same key, count unchanged.
    expect(await joinSession(member.emit, joinCode)).toBe(sessionId);
    expect((await member.stateWhere((s) => s.sessionId === sessionId)).participants.count).toBe(2);

    expect(await host.emit('voting:start', {})).toEqual({ ok: true });

    const stranger = await h.connect(await h.mintIdentity());
    expect(screenFor(await previewSession(stranger.emit, joinCode))).toBe('voting-started');
    await expect(joinSession(stranger.emit, joinCode)).rejects.toThrow('voting-started');

    const p = await previewSession(member.emit, joinCode);
    expect(p.isMember).toBe(true);
    expect(screenFor(p)).toBe('rejoin');
    expect(await joinSession(member.emit, joinCode)).toBe(sessionId);
  });
});
