import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEPARTMENTS, ROLES, TENURES } from '../src/shared/contract';
import { startHarness, type Harness, type Identity, type TestClient } from './harness';

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
  const identities: Identity[] = [];
  for (let i = 0; i < n; i++) {
    const identity = await h.mintIdentity();
    const p = await h.connect(identity);
    await p.emit('session:join', { joinCode: created.joinCode });
    participants.push(p);
    identities.push(identity);
  }
  for (const text of deckTexts) await host.emit('solution:add', { text });
  return { host, participants, identities, sessionId: created.sessionId as string, joinCode: created.joinCode as string };
}

/** Deck ids as seen by a client once voting is underway. */
async function deckOf(c: TestClient): Promise<{ id: string; text: string }[]> {
  const s = await c.stateWhere((st) => st.phase === 'voting' && (st.deck?.length ?? 0) > 0);
  return s.deck!;
}

function fullBallot(deck: { id: string }[], score = 50): Record<string, number> {
  return Object.fromEntries(deck.map((d) => [d.id, score]));
}

describe('voting: atomic ballots, progress, completion gate', () => {
  it('voting:start with an empty deck acks empty-deck; deck edits after start ack bad-phase; new code-joins ack voting-started', async () => {
    const { host, joinCode } = await makeSession(1, []);
    expect(await host.emit('voting:start', {})).toEqual({ error: 'empty-deck' });

    await host.emit('solution:add', { text: 'Alpha' });
    await host.emit('solution:add', { text: 'Beta' });
    expect(await host.emit('voting:start', {})).toEqual({ ok: true });
    const deck = await deckOf(host);

    // Deck immutable from this moment.
    expect(await host.emit('solution:add', { text: 'late' })).toEqual({ error: 'bad-phase' });
    expect(await host.emit('solution:edit', { solutionId: deck[0]!.id, text: 'late' })).toEqual({ error: 'bad-phase' });
    expect(await host.emit('solution:delete', { solutionId: deck[0]!.id })).toEqual({ error: 'bad-phase' });
    expect(await host.emit('solution:combine', { solutionIds: [deck[0]!.id, deck[1]!.id] })).toEqual({
      error: 'bad-phase',
    });
    // Double start is not legal either.
    expect(await host.emit('voting:start', {})).toEqual({ error: 'bad-phase' });

    const stranger = await h.connect(await h.mintIdentity());
    expect(await stranger.emit('session:join', { joinCode })).toEqual({ error: 'voting-started' });
  });

  it('voting:start gates: participant acks not-host; crowdsourced lobby acks bad-phase, curation is legal', async () => {
    const { participants } = await makeSession(1);
    expect(await participants[0]!.emit('voting:start', {})).toEqual({ error: 'not-host' });

    const { host } = await makeSession(0, [], { workflow: 'crowdsourced' });
    expect(await host.emit('voting:start', {})).toEqual({ error: 'bad-phase' }); // lobby, not curation
    await host.emit('curation:start', {});
    await host.emit('solution:add', { text: 'Alpha' });
    expect(await host.emit('voting:start', {})).toEqual({ ok: true });
  });

  it('a ballot missing a solution or scoring a stale solution acks incomplete-ballot; bad scores ack invalid-input; a second ballot acks duplicate-ballot', async () => {
    const { host, participants } = await makeSession(1);
    await host.emit('voting:start', {});
    const p = participants[0]!;
    const deck = await deckOf(p);

    // Malformed payloads.
    for (const scores of [undefined, null, 'x', [50, 50]]) {
      expect(await p.emit('ballot:submit', { scores })).toEqual({ error: 'invalid-input' });
    }
    // Out-of-range / non-integer scores.
    for (const bad of [-1, 101, 50.5, '50', NaN]) {
      expect(await p.emit('ballot:submit', { scores: { ...fullBallot(deck), [deck[0]!.id]: bad } })).toEqual({
        error: 'invalid-input',
      });
    }
    // Missing a deck solution.
    expect(await p.emit('ballot:submit', { scores: { [deck[0]!.id]: 50 } })).toEqual({ error: 'incomplete-ballot' });
    // Stale/unknown solution on top of full coverage.
    expect(
      await p.emit('ballot:submit', {
        scores: { ...fullBallot(deck), '00000000-0000-0000-0000-000000000000': 50 },
      }),
    ).toEqual({ error: 'incomplete-ballot' });

    // Nothing partial persisted by the rejects: the ballot is atomic.
    const { sessionId } = (await p.stateWhere((s) => s.phase === 'voting'))!;
    expect((await h.pool.query('select 1 from ballots where session_id = $1', [sessionId])).rowCount).toBe(0);

    expect(await p.emit('ballot:submit', { scores: fullBallot(deck) })).toEqual({ ok: true });
    expect(await p.emit('ballot:submit', { scores: fullBallot(deck) })).toEqual({ error: 'duplicate-ballot' });
  });

  it('ballot rows snapshot demographics; a later profile edit leaves the ballot unchanged', async () => {
    const { host, participants, sessionId } = await makeSession(2);
    await host.emit('voting:start', {});
    const p = participants[0]!;
    const deck = await deckOf(p);
    await p.emit('ballot:submit', { scores: fullBallot(deck, 70) });

    await p.emit('profile:set', { department: DEPARTMENTS[1], role: ROLES[1], tenure: TENURES[1] });

    const { rows } = await h.pool.query('select department, role, tenure from ballots where session_id = $1', [
      sessionId,
    ]);
    // mintIdentity's default profile, not the edited one.
    expect(rows).toEqual([{ department: DEPARTMENTS[0], role: ROLES[0], tenure: TENURES[0] }]);
  });

  it('votingProgress is counts-only for everyone; roster (names + voted) is host-only and never carries scores', async () => {
    const { host, participants } = await makeSession(2);
    await host.emit('voting:start', {});
    const p1 = participants[0]!;
    const deck = await deckOf(p1);
    await p1.emit('ballot:submit', { scores: fullBallot(deck, 90) });

    const hostState = await host.stateWhere((s) => s.votingProgress?.voted === 1);
    expect(hostState.votingProgress).toEqual({ voted: 1, total: 3 });
    // Roster: display name + voted flag only — never scores.
    expect(hostState.roster).toHaveLength(3);
    expect(hostState.roster!.filter((r) => r.voted)).toHaveLength(1);
    for (const r of hostState.roster!) expect(Object.keys(r).sort()).toEqual(['displayName', 'voted']);

    const p2State = await participants[1]!.stateWhere((s) => s.votingProgress?.voted === 1);
    expect(p2State.votingProgress).toEqual({ voted: 1, total: 3 });
    expect(p2State.roster).toBeUndefined();
    // No snapshot anywhere carries scores-per-person — not even a 'score' key.
    const everything = [...host.states, ...p1.states, ...participants[1]!.states];
    expect(JSON.stringify(everything)).not.toMatch(/score/i);
  });

  it('phase auto-advances to results the moment the last counted participant votes (host counted when participating)', async () => {
    const { host, participants } = await makeSession(1);
    await host.emit('voting:start', {});
    const deck = await deckOf(host);

    await participants[0]!.emit('ballot:submit', { scores: fullBallot(deck) });
    // 1 of 2 counted has voted — still voting.
    expect((await host.stateWhere((s) => s.votingProgress?.voted === 1)).phase).toBe('voting');

    await host.emit('ballot:submit', { scores: fullBallot(deck) });
    const done = await host.stateWhere((s) => s.phase === 'results');
    expect(done.joinCode).toBeUndefined(); // code recycles at results
    await participants[0]!.stateWhere((s) => s.phase === 'results');
  });

  it('host voting:close ends voting early with votes in hand; participants cannot close; closed voting takes no more ballots', async () => {
    const { host, participants } = await makeSession(2);
    await host.emit('voting:start', {});
    const deck = await deckOf(host);
    await participants[0]!.emit('ballot:submit', { scores: fullBallot(deck) });

    expect(await participants[1]!.emit('voting:close', {})).toEqual({ error: 'not-host' });
    expect(await host.emit('voting:close', {})).toEqual({ ok: true });
    await host.stateWhere((s) => s.phase === 'results');
    expect(await participants[1]!.emit('ballot:submit', { scores: fullBallot(deck) })).toEqual({ error: 'bad-phase' });
    expect(await host.emit('voting:close', {})).toEqual({ error: 'bad-phase' }); // double close
  });

  it('hostParticipates=false: host is blocked from voting, excluded from denominator and roster; participants alone complete the vote', async () => {
    const { host, participants } = await makeSession(2, ['Alpha', 'Beta'], { hostParticipates: false });
    await host.emit('voting:start', {});
    const deck = await deckOf(host);

    expect(await host.emit('ballot:submit', { scores: fullBallot(deck) })).toEqual({ error: 'not-participant' });

    const hostState = await host.stateWhere((s) => s.phase === 'voting' && s.roster !== undefined);
    expect(hostState.votingProgress).toEqual({ voted: 0, total: 2 });
    // 3 members, roster of 2: the non-participating host is not listed.
    expect(hostState.roster).toHaveLength(2);

    await participants[0]!.emit('ballot:submit', { scores: fullBallot(deck) });
    await participants[1]!.emit('ballot:submit', { scores: fullBallot(deck) });
    await host.stateWhere((s) => s.phase === 'results');
  });

  it('zero counted participants never auto-completes; voting:close with zero ballots is legal', async () => {
    // hostParticipates=false host alone: counted total = 0, nobody can vote.
    const { host, sessionId } = await makeSession(0, ['Alpha'], { hostParticipates: false });
    await host.emit('voting:start', {});
    const state = await host.stateWhere((s) => s.phase === 'voting');
    expect(state.votingProgress).toEqual({ voted: 0, total: 0 });

    expect(await host.emit('voting:close', {})).toEqual({ ok: true });
    await host.stateWhere((s) => s.phase === 'results');
    expect((await h.pool.query('select 1 from ballots where session_id = $1', [sessionId])).rowCount).toBe(0);
  });

  it('deck is served in stable insertion order across snapshots and rejoins', async () => {
    const texts = ['First', 'Second', 'Third', 'Fourth'];
    const { host, participants, identities, sessionId } = await makeSession(1, texts);
    await host.emit('voting:start', {});
    const deck = await deckOf(participants[0]!);
    expect(deck.map((d) => d.text)).toEqual(texts);

    // Rejoin mid-voting on a fresh socket (lost-device recovery): same deck, same order.
    const p = await h.connect(identities[0]!);
    expect(await p.emit('session:join', { sessionId })).toEqual({ ok: true, sessionId });
    const rejoined = await deckOf(p);
    expect(rejoined.map((d) => d.text)).toEqual(texts);
    expect(rejoined.map((d) => d.id)).toEqual(deck.map((d) => d.id));
  });
});
