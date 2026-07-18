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

/** Preset session with a host and n joined participants. */
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

describe('preset workflow: host-supplied solution list', () => {
  it('host adds several solutions (duplicate text legal), edits and deletes freely in the lobby', async () => {
    const { host, sessionId } = await makeSession(0);

    expect(await host.emit('solution:add', { text: 'Alpha' })).toEqual({ ok: true });
    expect(await host.emit('solution:add', { text: 'Beta' })).toEqual({ ok: true });
    // submitted_by is NULL on preset rows, so the one-per-participant unique index never bites.
    expect(await host.emit('solution:add', { text: 'Alpha' })).toEqual({ ok: true });

    let state = await host.stateWhere((s) => (s.deck?.length ?? 0) === 3);
    expect(state.deck!.map((d) => d.text)).toEqual(['Alpha', 'Beta', 'Alpha']);

    const { rows } = await h.pool.query('select submitted_by from solutions where session_id = $1', [sessionId]);
    expect(rows.map((r) => r.submitted_by)).toEqual([null, null, null]);

    const beta = state.deck!.find((d) => d.text === 'Beta')!;
    expect(await host.emit('solution:edit', { solutionId: beta.id, text: 'Beta v2' })).toEqual({ ok: true });
    state = await host.stateWhere((s) => s.deck?.some((d) => d.text === 'Beta v2') ?? false);
    // Edit preserves insertion order.
    expect(state.deck!.map((d) => d.text)).toEqual(['Alpha', 'Beta v2', 'Alpha']);

    expect(await host.emit('solution:delete', { solutionId: beta.id })).toEqual({ ok: true });
    state = await host.stateWhere((s) => (s.deck?.length ?? 0) === 2);
    expect(state.deck!.map((d) => d.text)).toEqual(['Alpha', 'Alpha']);
  });

  it("participants see no deck in the preset lobby; host's edits stay invisible", async () => {
    const { host, participants } = await makeSession(1);
    await host.emit('solution:add', { text: 'Secret option' });
    await host.stateWhere((s) => (s.deck?.length ?? 0) === 1);

    const pState = await participants[0]!.stateWhere((s) => s.participants.count === 2);
    expect(pState.deck).toBeUndefined();
    expect(pState.submissions).toBeUndefined(); // no submission phase exists in preset
    expect(JSON.stringify(pState)).not.toContain('Secret option');
  });

  it('solution:submit in a preset session acks bad-phase', async () => {
    const { participants } = await makeSession(1);
    expect(await participants[0]!.emit('solution:submit', { text: 'nope' })).toEqual({ error: 'bad-phase' });
  });

  it('add/edit/delete from a participant ack not-host', async () => {
    const { host, participants } = await makeSession(1);
    await host.emit('solution:add', { text: 'Alpha' });
    const state = await host.stateWhere((s) => (s.deck?.length ?? 0) === 1);
    const id = state.deck![0]!.id;

    const p = participants[0]!;
    expect(await p.emit('solution:add', { text: 'mine' })).toEqual({ error: 'not-host' });
    expect(await p.emit('solution:edit', { solutionId: id, text: 'hijack' })).toEqual({ error: 'not-host' });
    expect(await p.emit('solution:delete', { solutionId: id })).toEqual({ error: 'not-host' });
  });

  it('add/edit/delete in a crowdsourced lobby ack bad-phase; legal in curation (shared handler)', async () => {
    const { host } = await makeSession(0, { workflow: 'crowdsourced' });
    expect(await host.emit('solution:add', { text: 'too early' })).toEqual({ error: 'bad-phase' });

    await host.emit('curation:start', {});
    expect(await host.emit('solution:add', { text: 'recovered' })).toEqual({ ok: true });
    const state = await host.stateWhere((s) => (s.deck?.length ?? 0) === 1);
    const id = state.deck![0]!.id;
    expect(await host.emit('solution:edit', { solutionId: id, text: 'recovered v2' })).toEqual({ ok: true });
    expect(await host.emit('solution:delete', { solutionId: id })).toEqual({ ok: true });
    await host.stateWhere((s) => s.phase === 'curation' && s.deck?.length === 0);
  });

  it('edit/delete of an unresolvable solutionId ack not-found', async () => {
    const { host } = await makeSession(0);
    expect(await host.emit('solution:edit', { solutionId: 'not-a-uuid', text: 'x' })).toEqual({ error: 'not-found' });
    const ghost = '00000000-0000-0000-0000-000000000000';
    expect(await host.emit('solution:edit', { solutionId: ghost, text: 'x' })).toEqual({ error: 'not-found' });
    expect(await host.emit('solution:delete', { solutionId: ghost })).toEqual({ error: 'not-found' });
  });

  it("editing another session's solution acks not-found", async () => {
    const { host: hostA } = await makeSession(0);
    const { host: hostB } = await makeSession(0);
    await hostA.emit('solution:add', { text: 'A only' });
    const id = (await hostA.stateWhere((s) => (s.deck?.length ?? 0) === 1)).deck![0]!.id;
    expect(await hostB.emit('solution:edit', { solutionId: id, text: 'stolen' })).toEqual({ error: 'not-found' });
    expect(await hostB.emit('solution:delete', { solutionId: id })).toEqual({ error: 'not-found' });
  });

  it('empty or >300-char text acks invalid-input for add and edit', async () => {
    const { host } = await makeSession(0);
    await host.emit('solution:add', { text: 'valid' });
    const id = (await host.stateWhere((s) => (s.deck?.length ?? 0) === 1)).deck![0]!.id;
    for (const text of ['', '   ', 'x'.repeat(301), undefined]) {
      expect(await host.emit('solution:add', { text })).toEqual({ error: 'invalid-input' });
      expect(await host.emit('solution:edit', { solutionId: id, text })).toEqual({ error: 'invalid-input' });
    }
    expect(await host.emit('solution:add', { text: 'x'.repeat(300) })).toEqual({ ok: true });
  });

  it('add/edit/delete from a socket that never joined a session ack not-found', async () => {
    const c = await h.connect(await h.mintIdentity());
    expect(await c.emit('solution:add', { text: 'floating' })).toEqual({ error: 'not-found' });
    expect(await c.emit('solution:edit', { solutionId: '00000000-0000-0000-0000-000000000000', text: 'x' })).toEqual({
      error: 'not-found',
    });
    expect(await c.emit('solution:delete', { solutionId: '00000000-0000-0000-0000-000000000000' })).toEqual({
      error: 'not-found',
    });
  });
});
