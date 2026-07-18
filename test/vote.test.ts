import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness, type TestClient } from './harness';
import { angleToScore, nextUnscored, pruneScores, scoreColor, submitBallot } from '../src/client/vote';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 120_000);

afterAll(async () => {
  await h.stop();
});

/** Preset session already in voting: host + one participant, deck of the given texts. */
async function votingRoom(deckTexts: string[] = ['Alpha', 'Beta']) {
  const host = await h.connect(await h.mintIdentity());
  const created = await host.emit('session:create', {
    problem: 'Which customer problem should we solve next?',
    workflow: 'preset',
    hostParticipates: true,
  });
  const participant = await h.connect(await h.mintIdentity());
  await participant.emit('session:join', { joinCode: created.joinCode });
  for (const text of deckTexts) await host.emit('solution:add', { text });
  await host.emit('voting:start', {});
  const s = await participant.stateWhere((x) => x.phase === 'voting' && (x.deck?.length ?? 0) > 0);
  return { host, participant, sessionId: created.sessionId as string, deck: s.deck! };
}

function fullBallot(deck: { id: string }[], score = 50): Record<string, number> {
  return Object.fromEntries(deck.map((d) => [d.id, score]));
}

describe('swipe geometry: angle → score around the ring', () => {
  it('maps left → 0 (Reject), top → 50 (Unsure), right → 100 (Strong confidence)', () => {
    expect(angleToScore(-100, 0)).toBe(0);
    expect(angleToScore(0, -100)).toBe(50);
    expect(angleToScore(100, 0)).toBe(100);
  });

  it('interpolates the upper half (45° either side of top)', () => {
    expect(angleToScore(-100, -100)).toBe(25);
    expect(angleToScore(100, -100)).toBe(75);
  });

  it('clamps below the horizontal to the nearest anchor', () => {
    expect(angleToScore(-100, 50)).toBe(0);
    expect(angleToScore(100, 50)).toBe(100);
  });

  it('scoreColor: reject red, unsure amber, confident green', () => {
    expect(scoreColor(0)).toBe(scoreColor(20));
    expect(scoreColor(50)).toBe(scoreColor(40));
    expect(scoreColor(100)).toBe(scoreColor(82));
    expect(new Set([scoreColor(0), scoreColor(50), scoreColor(100)]).size).toBe(3);
  });
});

describe('deck progress from device-local scores', () => {
  const deck = [
    { id: 'a', text: 'A', combined: false },
    { id: 'b', text: 'B', combined: false },
    { id: 'c', text: 'C', combined: false },
  ];

  it('nextUnscored resumes at the first unscored Solution, deck.length when done', () => {
    expect(nextUnscored(deck, {})).toBe(0);
    expect(nextUnscored(deck, { a: 80 })).toBe(1);
    expect(nextUnscored(deck, { a: 80, c: 10 })).toBe(1); // b still missing
    expect(nextUnscored(deck, { a: 80, b: 50, c: 10 })).toBe(3);
  });

  it('pruneScores drops scores for solutions not in the deck (stale device storage)', () => {
    expect(pruneScores(deck, { a: 80, zombie: 99 })).toEqual({ a: 80 });
  });
});

describe('submitBallot: one atomic emit, race acks routed not errored', () => {
  it('ok → submitted; snapshot flips me.voted', async () => {
    const { participant, sessionId, deck } = await votingRoom();
    expect(await submitBallot(participant.emit, fullBallot(deck, 82))).toBe('submitted');
    const s = await participant.stateWhere((x) => x.sessionId === sessionId && x.me.voted);
    expect(s.me.voted).toBe(true);
  });

  it('duplicate-ballot → submitted (already counted, never an error)', async () => {
    const { participant, deck } = await votingRoom();
    await submitBallot(participant.emit, fullBallot(deck));
    expect(await submitBallot(participant.emit, fullBallot(deck))).toBe('submitted');
  });

  it('bad-phase (raced voting:close) → ended — route to results, not an error', async () => {
    const { host, participant, deck } = await votingRoom();
    await host.emit('voting:close', {});
    expect(await submitBallot(participant.emit, fullBallot(deck))).toBe('ended');
  });

  it('incomplete-ballot → incomplete so the client resumes at the missing Solution', async () => {
    const { participant, deck } = await votingRoom();
    expect(await submitBallot(participant.emit, { [deck[0]!.id]: 50 })).toBe('incomplete');
  });

  it('other codes still throw', async () => {
    const { participant, deck } = await votingRoom();
    await expect(submitBallot(participant.emit, { [deck[0]!.id]: 101, [deck[1]!.id]: 50 })).rejects.toThrow(
      'invalid-input',
    );
  });

  it('a participating host casts a ballot like any participant', async () => {
    const { host, deck, sessionId } = await votingRoom();
    expect(await submitBallot(host.emit, fullBallot(deck, 100))).toBe('submitted');
    const s = await host.stateWhere((x) => x.sessionId === sessionId && x.me.voted);
    expect(s.isHost).toBe(true);
  });
});
