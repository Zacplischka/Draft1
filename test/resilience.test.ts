// Issue #9: any-phase rejoin, late-join lock, restart rehydration.
// Every rejoin here is a FRESH socket (lost device / refresh) — never the old connection.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness, type Identity, type TestClient } from './harness';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 120_000);

afterAll(async () => {
  await h.stop();
});

const CREATE = { problem: 'Pick our team name', workflow: 'crowdsourced', hostParticipates: true };

async function makeSession(n: number, overrides: object = {}) {
  const hostId = await h.mintIdentity();
  const host = await h.connect(hostId);
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
  return { host, hostId, participants, identities, sessionId: created.sessionId as string, joinCode: created.joinCode as string };
}

/** Fresh-socket rejoin by sessionId; resolves the rejoiner's snapshot for that session. */
async function rejoin(identity: Identity, sessionId: string) {
  const c = await h.connect(identity);
  expect(await c.emit('session:join', { sessionId })).toEqual({ ok: true, sessionId });
  return { client: c, state: await c.stateWhere((s) => s.sessionId === sessionId) };
}

describe('resilience: any-phase rejoin, late-join lock, restart rehydration', () => {
  it('rejoin in every phase returns the role-filtered snapshot with accurate me flags', async () => {
    const { host, hostId, identities, sessionId } = await makeSession(1);
    const pId = identities[0]!;

    // LOBBY: participant submitted — flags and own text come back; no deck for a participant.
    const p = (await rejoin(pId, sessionId)).client;
    await p.emit('solution:submit', { text: 'Mine' });
    let s = (await rejoin(pId, sessionId)).state;
    expect(s.phase).toBe('lobby');
    expect(s.me).toMatchObject({ submitted: true, voted: false, submissionText: 'Mine' });
    expect(s.deck).toBeUndefined();
    expect(s.submissions).toEqual({ submitted: 1, total: 2 });

    // CURATION: in-progress deck stays host business; the host's rejoin sees it.
    await host.emit('curation:start', {});
    s = (await rejoin(pId, sessionId)).state;
    expect(s.phase).toBe('curation');
    expect(s.me.submitted).toBe(true);
    expect(s.deck).toBeUndefined();
    expect((await rejoin(hostId, sessionId)).state.deck).toHaveLength(1);

    // VOTING, ballot not yet submitted: the participant gets the deck again — no
    // partial ballot exists to resume.
    await (await rejoin(hostId, sessionId)).client.emit('voting:start', {});
    const beforeBallot = await rejoin(pId, sessionId);
    expect(beforeBallot.state.phase).toBe('voting');
    expect(beforeBallot.state.me.voted).toBe(false);
    const deck = beforeBallot.state.deck!;
    expect(deck).toHaveLength(1);

    // VOTING, ballot submitted: me.voted true → client lands on waiting state.
    await beforeBallot.client.emit('ballot:submit', { scores: { [deck[0]!.id]: 40 } });
    const afterBallot = await rejoin(pId, sessionId);
    expect(afterBallot.state.me.voted).toBe(true);
    expect(afterBallot.state.votingProgress).toEqual({ voted: 1, total: 2 });

    // RESULTS: rejoin serves the ranked list; the code has recycled and is never rendered.
    const hostBack = await rejoin(hostId, sessionId);
    await hostBack.client.emit('ballot:submit', { scores: { [deck[0]!.id]: 60 } });
    s = (await rejoin(pId, sessionId)).state;
    expect(s.phase).toBe('results');
    expect(s.joinCode).toBeUndefined();
    expect(s.results!.ranked).toEqual([{ solutionId: deck[0]!.id, text: 'Mine', avg: 50 }]);
  });

  it('rejoin during results works even after the join code has been claimed by a new session', async () => {
    const { host, hostId, sessionId, joinCode } = await makeSession(0, { workflow: 'preset' });
    await host.emit('solution:add', { text: 'Alpha' });
    await host.emit('voting:start', {});
    const deckId = (await host.stateWhere((s) => s.phase === 'voting')).deck![0]!.id;
    await host.emit('ballot:submit', { scores: { [deckId]: 75 } });
    await host.stateWhere((s) => s.phase === 'results');

    // The freed code is claimed by a brand-new active session.
    const other = await makeSession(0);
    await h.pool.query('update sessions set join_code = $1 where id = $2', [joinCode, other.sessionId]);

    // The recycled code is never a rejoin key for the closed session: even its own
    // member entering it is admitted to the NEW session as a fresh joiner.
    const memberOfClosed = await h.connect(hostId);
    expect(await memberOfClosed.emit('session:join', { joinCode })).toEqual({ ok: true, sessionId: other.sessionId });

    // sessionId rejoin still lands on the closed session's results.
    const { state } = await rejoin(hostId, sessionId);
    expect(state.phase).toBe('results');
    expect(state.results!.ranked).toEqual([{ solutionId: deckId, text: 'Alpha', avg: 75 }]);
  });

  it('lost-device recovery: an existing member re-entering the join code is idempotently rejoined during voting; a stranger is locked out', async () => {
    const { host, identities, sessionId, joinCode } = await makeSession(1, { workflow: 'preset' });
    await host.emit('solution:add', { text: 'Alpha' });
    await host.emit('voting:start', {});

    const stranger = await h.connect(await h.mintIdentity());
    expect(await stranger.emit('session:join', { joinCode })).toEqual({ error: 'voting-started' });

    // Fresh socket + join code (sessionId lost with the device) → rejoined, not re-admitted.
    const back = await h.connect(identities[0]!);
    expect(await back.emit('session:join', { joinCode })).toEqual({ ok: true, sessionId });
    const s = await back.stateWhere((st) => st.sessionId === sessionId);
    expect(s.phase).toBe('voting');
    expect(s.participants.count).toBe(2); // no duplicate membership
    expect(s.me.voted).toBe(false);
  });

  it('server restart mid-voting: members rejoin by sessionId and complete the session; results match an uninterrupted run', async () => {
    const { host, hostId, participants, identities, sessionId } = await makeSession(2, { workflow: 'preset' });
    await host.emit('solution:add', { text: 'Alpha' });
    await host.emit('solution:add', { text: 'Beta' });
    await host.emit('voting:start', {});
    const deck = (await host.stateWhere((s) => s.phase === 'voting')).deck!;
    const [a, b] = deck;
    await participants[0]!.emit('ballot:submit', { scores: { [a!.id]: 80, [b!.id]: 20 } });

    await h.restartServer();

    // The pre-restart ballot survived; the participant who cast it lands on waiting state.
    const p0Back = await rejoin(identities[0]!, sessionId);
    expect(p0Back.state.me.voted).toBe(true);
    expect(p0Back.state.votingProgress).toEqual({ voted: 1, total: 3 });

    // The remaining members rejoin and finish; everyone-voted auto-completes.
    const p1 = await rejoin(identities[1]!, sessionId);
    expect(p1.state.deck!.map((d) => d.id)).toEqual(deck.map((d) => d.id)); // same deck, same order
    await p1.client.emit('ballot:submit', { scores: { [a!.id]: 70, [b!.id]: 30 } });
    const hostBack = await rejoin(hostId, sessionId);
    await hostBack.client.emit('ballot:submit', { scores: { [a!.id]: 60, [b!.id]: 40 } });

    // Exactly what an uninterrupted (80+70+60)/3, (20+30+40)/3 run produces.
    const done = await hostBack.client.stateWhere((s) => s.phase === 'results');
    expect(done.results!.ranked).toEqual([
      { solutionId: a!.id, text: 'Alpha', avg: 70 },
      { solutionId: b!.id, text: 'Beta', avg: 30 },
    ]);
    expect((await rejoin(identities[0]!, sessionId)).state.results!.ranked).toEqual(done.results!.ranked);
  });
});
