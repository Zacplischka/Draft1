import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness, type TestClient } from './harness';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 120_000);

afterAll(async () => {
  await h.stop();
});

const CREATE = { problem: 'Where should we hold the offsite?', workflow: 'crowdsourced', hostParticipates: true };

/** Crowdsourced session with a host and n joined participants. */
async function makeSession(n: number, overrides: object = {}) {
  const host = await h.connect(await h.mintIdentity());
  const created = await host.emit('session:create', { ...CREATE, ...overrides });
  const participants: TestClient[] = [];
  for (let i = 0; i < n; i++) {
    const p = await h.connect(await h.mintIdentity());
    await p.emit('session:join', { joinCode: created.joinCode });
    participants.push(p);
  }
  return { host, participants, sessionId: created.sessionId as string, joinCode: created.joinCode as string };
}

describe('crowdsourced submission phase', () => {
  it('participant submits once; host deck grows; participants get counts but no deck or authorship', async () => {
    const { host, participants } = await makeSession(2);
    const [a, b] = participants as [TestClient, TestClient];

    expect(await a.emit('solution:submit', { text: 'Mountain lodge' })).toEqual({ ok: true });

    const hostState = await host.stateWhere((s) => (s.deck?.length ?? 0) === 1);
    expect(hostState.deck).toEqual([{ id: expect.any(String), text: 'Mountain lodge', combined: false }]);
    expect(hostState.submissions).toEqual({ submitted: 1, total: 3 });

    const bState = await b.stateWhere((s) => s.submissions?.submitted === 1);
    expect(bState.deck).toBeUndefined();
    expect(bState.submissions).toEqual({ submitted: 1, total: 3 });
    // No authorship and no one else's text anywhere in a participant payload.
    expect(JSON.stringify(bState)).not.toContain('Mountain lodge');

    expect(await b.emit('solution:submit', { text: 'Beach resort' })).toEqual({ ok: true });
    const grown = await host.stateWhere((s) => (s.deck?.length ?? 0) === 2);
    expect(grown.deck!.map((d) => d.text)).toEqual(['Mountain lodge', 'Beach resort']);
  });

  it('second submission acks already-submitted', async () => {
    const { participants } = await makeSession(1);
    await participants[0]!.emit('solution:submit', { text: 'once' });
    expect(await participants[0]!.emit('solution:submit', { text: 'twice' })).toEqual({ error: 'already-submitted' });
  });

  it('empty or >300-char text acks invalid-input; 300 chars is legal', async () => {
    const { participants } = await makeSession(1);
    for (const text of ['', '   ', 'x'.repeat(301), undefined]) {
      expect(await participants[0]!.emit('solution:submit', { text })).toEqual({ error: 'invalid-input' });
    }
    expect(await participants[0]!.emit('solution:submit', { text: 'x'.repeat(300) })).toEqual({ ok: true });
  });

  it("a submitted member's snapshot echoes me.submissionText — own text only", async () => {
    const { participants } = await makeSession(2);
    const [a, b] = participants as [TestClient, TestClient];
    await a.emit('solution:submit', { text: 'My own idea' });

    const aState = await a.stateWhere((s) => s.me.submitted);
    expect(aState.me).toMatchObject({ submitted: true, submissionText: 'My own idea' });

    await b.emit('solution:submit', { text: 'Different idea' });
    const bState = await b.stateWhere((s) => s.me.submitted);
    expect(bState.me.submissionText).toBe('Different idea');
    expect(JSON.stringify(bState)).not.toContain('My own idea');
  });

  it('me.submissionText survives the deck row being hard-deleted (combine/delete in curation)', async () => {
    const { host, participants, sessionId } = await makeSession(1);
    await participants[0]!.emit('solution:submit', { text: 'Doomed row' });
    await host.emit('curation:start', {});
    // Curation editing lands in a later ticket; a direct hard-delete proves the snapshot is independent.
    await h.pool.query('delete from solutions where session_id = $1', [sessionId]);

    const back = await participants[0]!.emit('session:join', { sessionId });
    expect(back.ok).toBe(true);
    const state = await participants[0]!.stateWhere((s) => s.me.submitted && s.phase === 'curation');
    expect(state.me.submissionText).toBe('Doomed row');
  });

  it('host with hostParticipates=false cannot submit and is excluded from submissions.total', async () => {
    const { host, participants } = await makeSession(1, { hostParticipates: false });
    expect(await host.emit('solution:submit', { text: 'host idea' })).toEqual({ error: 'not-participant' });
    await participants[0]!.emit('solution:submit', { text: 'guest idea' });
    const state = await host.stateWhere((s) => s.submissions?.submitted === 1);
    expect(state.submissions).toEqual({ submitted: 1, total: 1 });
  });

  it('host with hostParticipates=true submits like anyone else', async () => {
    const { host } = await makeSession(0);
    expect(await host.emit('solution:submit', { text: 'host idea' })).toEqual({ ok: true });
    const state = await host.stateWhere((s) => s.me.submitted);
    expect(state.submissions).toEqual({ submitted: 1, total: 1 });
  });

  it('curation:start: host only, crowdsourced lobby only, legal with zero solutions; closes submissions', async () => {
    const { host, participants } = await makeSession(1);
    expect(await participants[0]!.emit('curation:start', {})).toEqual({ error: 'not-host' });

    // Zero solutions — still legal; the host recovers via solution:add later.
    expect(await host.emit('curation:start', {})).toEqual({ ok: true });
    const hostState = await host.stateWhere((s) => s.phase === 'curation');
    expect(hostState.submissions).toEqual({ submitted: 0, total: 2 });

    expect(await participants[0]!.emit('solution:submit', { text: 'too late' })).toEqual({ error: 'bad-phase' });
    expect(await host.emit('curation:start', {})).toEqual({ error: 'bad-phase' });
  });

  it('curation:start on a preset session acks bad-phase', async () => {
    const { host } = await makeSession(0, { workflow: 'preset' });
    expect(await host.emit('curation:start', {})).toEqual({ error: 'bad-phase' });
  });

  it('solution:submit on a preset session acks bad-phase', async () => {
    const { participants } = await makeSession(1, { workflow: 'preset' });
    expect(await participants[0]!.emit('solution:submit', { text: 'nope' })).toEqual({ error: 'bad-phase' });
  });

  it('a brand-new participant can still join by code during curation', async () => {
    const { host, joinCode } = await makeSession(0);
    await host.emit('curation:start', {});
    const late = await h.connect(await h.mintIdentity());
    expect((await late.emit('session:join', { joinCode })).ok).toBe(true);
    const state = await late.stateWhere((s) => s.phase === 'curation');
    expect(state.participants.count).toBe(2);
    expect(state.deck).toBeUndefined(); // in-progress curation is host business
  });

  it('submit from a socket that never joined a session acks not-found', async () => {
    const c = await h.connect(await h.mintIdentity());
    expect(await c.emit('solution:submit', { text: 'floating' })).toEqual({ error: 'not-found' });
    expect(await c.emit('curation:start', {})).toEqual({ error: 'not-found' });
  });
});
