import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness, type TestClient } from './harness';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 120_000);

afterAll(async () => {
  await h.stop();
});

const CREATE = { problem: 'Pick our team name', workflow: 'preset', hostParticipates: true };

/** Preset session: host + n participants, deck of the given texts, not yet voting. */
async function makeSession(n: number, deckTexts: string[] = ['Alpha', 'Beta'], overrides: object = {}) {
  const host = await h.connect(await h.mintIdentity());
  const created = await host.emit('session:create', { ...CREATE, ...overrides });
  const participants: TestClient[] = [];
  for (let i = 0; i < n; i++) {
    const p = await h.connect(await h.mintIdentity());
    await p.emit('session:join', { joinCode: created.joinCode });
    participants.push(p);
  }
  for (const text of deckTexts) await host.emit('solution:add', { text });
  return { host, participants, sessionId: created.sessionId as string, joinCode: created.joinCode as string };
}

async function deckOf(c: TestClient): Promise<{ id: string; text: string }[]> {
  const s = await c.stateWhere((st) => st.phase === 'voting' && (st.deck?.length ?? 0) > 0);
  return s.deck!;
}

describe('results: ranked list to all members', () => {
  it('on everyone-voted auto-complete, every member gets results.ranked ordered by UNROUNDED mean; served avg is round-half-up integer', async () => {
    const { host, participants } = await makeSession(1, ['Alpha', 'Beta']);
    await host.emit('voting:start', {});
    const deck = await deckOf(host);
    const [a, b] = deck;

    // Alpha: (50 + 51) / 2 = 50.5 — rounds half-up to 51. Beta: (51 + 51) / 2 = 51.
    // Served avgs TIE at 51, but the unrounded means don't: Beta (51) beats Alpha (50.5).
    await participants[0]!.emit('ballot:submit', { scores: { [a!.id]: 50, [b!.id]: 51 } });
    await host.emit('ballot:submit', { scores: { [a!.id]: 51, [b!.id]: 51 } });

    for (const c of [host, participants[0]!]) {
      const s = await c.stateWhere((st) => st.phase === 'results');
      expect(s.results!.ranked).toEqual([
        { solutionId: b!.id, text: 'Beta', avg: 51 },
        { solutionId: a!.id, text: 'Alpha', avg: 51 },
      ]);
    }
  });

  it('host voting:close with ballots in hand serves results; a 2-person session shows its full ranked list (no suppression)', async () => {
    const { host, participants } = await makeSession(1, ['Alpha', 'Beta']);
    await host.emit('voting:start', {});
    const deck = await deckOf(host);

    // Only the participant votes; the host closes early with 1 of 2 ballots in.
    await participants[0]!.emit('ballot:submit', { scores: { [deck[0]!.id]: 80, [deck[1]!.id]: 20 } });
    expect(await host.emit('voting:close', {})).toEqual({ ok: true });

    const s = await participants[0]!.stateWhere((st) => st.phase === 'results');
    expect(s.results!.ranked).toEqual([
      { solutionId: deck[0]!.id, text: 'Alpha', avg: 80 },
      { solutionId: deck[1]!.id, text: 'Beta', avg: 20 },
    ]);
  });

  it('equal unrounded means tie-break by solutionId ascending', async () => {
    const { host } = await makeSession(0, ['One', 'Two', 'Three']);
    await host.emit('voting:start', {});
    const deck = await deckOf(host);

    await host.emit('ballot:submit', { scores: Object.fromEntries(deck.map((d) => [d.id, 42])) });

    const s = await host.stateWhere((st) => st.phase === 'results');
    expect(s.results!.ranked.map((r) => r.solutionId)).toEqual(deck.map((d) => d.id).sort());
    for (const r of s.results!.ranked) expect(r.avg).toBe(42);
  });

  it('host closes before any ballot lands: avg is null, deck order preserved', async () => {
    const { host } = await makeSession(0, ['First', 'Second', 'Third'], { hostParticipates: false });
    await host.emit('voting:start', {});
    const deck = await deckOf(host);
    expect(await host.emit('voting:close', {})).toEqual({ ok: true });

    const s = await host.stateWhere((st) => st.phase === 'results');
    expect(s.results!.ranked).toEqual(deck.map((d) => ({ solutionId: d.id, text: d.text, avg: null })));
  });

  it('session records closed_at; its code becomes claimable by a new session while the old one stays rejoinable by sessionId', async () => {
    const { host, sessionId, joinCode } = await makeSession(0, ['Alpha']);
    await host.emit('voting:start', {});
    const deck = await deckOf(host);
    await host.emit('ballot:submit', { scores: { [deck[0]!.id]: 60 } });
    await host.stateWhere((s) => s.phase === 'results');

    const { rows } = await h.pool.query('select closed_at from sessions where id = $1', [sessionId]);
    expect(rows[0].closed_at).not.toBeNull();

    // The partial unique index no longer holds the code: a new session can claim it.
    const other = await makeSession(0);
    await h.pool.query('update sessions set join_code = $1 where id = $2', [joinCode, other.sessionId]);

    // A code join now resolves the NEW session, never the closed one.
    const stranger = await h.connect(await h.mintIdentity());
    expect(await stranger.emit('session:join', { joinCode })).toEqual({ ok: true, sessionId: other.sessionId });

    // The old session stays rejoinable by sessionId, snapshot carries results, no joinCode.
    const back = await h.connect(await h.mintIdentity({ displayName: 'irrelevant' }));
    expect(await back.emit('session:join', { sessionId })).toEqual({ error: 'not-found' }); // non-member: no leak
    expect(await host.emit('session:join', { sessionId })).toEqual({ ok: true, sessionId });
    const s = await host.stateWhere((st) => st.sessionId === sessionId && st.phase === 'results');
    expect(s.joinCode).toBeUndefined();
    expect(s.results!.ranked).toEqual([{ solutionId: deck[0]!.id, text: 'Alpha', avg: 60 }]);
  });

  it('crowdsourced workflow end-to-end: submit → curation → voting → results', async () => {
    const { host, participants } = await makeSession(1, [], { workflow: 'crowdsourced' });
    await participants[0]!.emit('solution:submit', { text: 'From the crowd' });
    await host.emit('solution:submit', { text: 'From the host' });
    await host.emit('curation:start', {});
    await host.emit('voting:start', {});
    const deck = await deckOf(participants[0]!);

    await participants[0]!.emit('ballot:submit', { scores: { [deck[0]!.id]: 30, [deck[1]!.id]: 90 } });
    await host.emit('ballot:submit', { scores: { [deck[0]!.id]: 50, [deck[1]!.id]: 70 } });

    const s = await participants[0]!.stateWhere((st) => st.phase === 'results');
    const winner = deck.find((d) => d.text === 'From the host')!;
    const loser = deck.find((d) => d.text === 'From the crowd')!;
    expect(s.results!.ranked).toEqual([
      { solutionId: winner.id, text: 'From the host', avg: 80 },
      { solutionId: loser.id, text: 'From the crowd', avg: 40 },
    ]);
  });
});
