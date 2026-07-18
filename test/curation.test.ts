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

/** Crowdsourced session in curation with n participants who each submitted texts[i]. */
async function makeCuration(texts: string[]) {
  const host = await h.connect(await h.mintIdentity());
  const created = await host.emit('session:create', CREATE);
  const participants: TestClient[] = [];
  for (const text of texts) {
    const p = await h.connect(await h.mintIdentity());
    await p.emit('session:join', { joinCode: created.joinCode });
    await p.emit('solution:submit', { text });
    participants.push(p);
  }
  await host.emit('curation:start', {});
  const state = await host.stateWhere((s) => s.phase === 'curation' && (s.deck?.length ?? 0) === texts.length);
  return { host, participants, sessionId: created.sessionId as string, deck: state.deck! };
}

describe('curation: combine, edit merged text, delete', () => {
  it('combine hard-deletes sources and inserts one combined row with the " / " join', async () => {
    const { host, sessionId, deck } = await makeCuration(['Mountain lodge', 'Ski lodge', 'Beach resort']);
    const [a, b] = [deck[0]!, deck[1]!];

    const ack = await host.emit('solution:combine', { solutionIds: [a.id, b.id] });
    expect(ack).toEqual({ ok: true, solutionId: expect.any(String) });

    const state = await host.stateWhere((s) => (s.deck?.length ?? 0) === 2);
    // Sources gone; survivor keeps its slot; combined row appended in insertion order.
    expect(state.deck).toEqual([
      { id: deck[2]!.id, text: 'Beach resort', combined: false },
      { id: ack.solutionId, text: 'Mountain lodge / Ski lodge', combined: true },
    ]);

    const { rows } = await h.pool.query('select submitted_by from solutions where id = $1', [ack.solutionId]);
    expect(rows[0].submitted_by).toBeNull();
  });

  it('combine with text uses it verbatim', async () => {
    const { host, deck } = await makeCuration(['Lodge', 'Chalet']);
    const ack = await host.emit('solution:combine', {
      solutionIds: deck.map((d) => d.id),
      text: 'Mountain accommodation',
    });
    expect(ack.ok).toBe(true);
    const state = await host.stateWhere((s) => s.deck?.length === 1);
    expect(state.deck).toEqual([{ id: ack.solutionId, text: 'Mountain accommodation', combined: true }]);
  });

  it("me.submissionText survives the member's row being combined away", async () => {
    const { host, participants, deck } = await makeCuration(['Mine', 'Yours']);
    await host.emit('solution:combine', { solutionIds: deck.map((d) => d.id) });
    const state = await participants[0]!.stateWhere((s) => s.submissions?.submitted === 2);
    expect(state.me.submissionText).toBe('Mine');
  });

  it('host edits ANY row — an uncombined original and a combined row alike', async () => {
    const { host, deck } = await makeCuration(['Original A', 'Original B', 'Original C']);

    expect(await host.emit('solution:edit', { solutionId: deck[0]!.id, text: 'Original A, sharpened' })).toEqual({
      ok: true,
    });
    await host.stateWhere((s) => s.deck?.some((d) => d.text === 'Original A, sharpened') ?? false);

    const combineAck = await host.emit('solution:combine', { solutionIds: [deck[1]!.id, deck[2]!.id] });
    expect(await host.emit('solution:edit', { solutionId: combineAck.solutionId, text: 'B and C, merged' })).toEqual({
      ok: true,
    });
    const state = await host.stateWhere((s) => s.deck?.some((d) => d.text === 'B and C, merged') ?? false);
    expect(state.deck!.map((d) => d.text)).toEqual(['Original A, sharpened', 'B and C, merged']);
  });

  it('an emptied deck is recoverable: delete everything, then solution:add', async () => {
    const { host, deck } = await makeCuration(['Only one']);
    expect(await host.emit('solution:delete', { solutionId: deck[0]!.id })).toEqual({ ok: true });
    await host.stateWhere((s) => s.deck?.length === 0);

    expect(await host.emit('solution:add', { text: 'Fresh start' })).toEqual({ ok: true });
    const state = await host.stateWhere((s) => s.deck?.length === 1);
    expect(state.deck![0]).toMatchObject({ text: 'Fresh start', combined: false });
  });

  it('combine with an unknown or foreign solutionId acks not-found and changes nothing', async () => {
    const { host, deck } = await makeCuration(['Keep me', 'And me']);
    const ghost = '00000000-0000-0000-0000-000000000000';
    expect(await host.emit('solution:combine', { solutionIds: [deck[0]!.id, ghost] })).toEqual({
      error: 'not-found',
    });
    expect(await host.emit('solution:combine', { solutionIds: [deck[0]!.id, 'not-a-uuid'] })).toEqual({
      error: 'not-found',
    });

    // A source belonging to another session resolves nothing here either.
    const other = await makeCuration(['Foreign']);
    expect(await host.emit('solution:combine', { solutionIds: [deck[0]!.id, other.deck[0]!.id] })).toEqual({
      error: 'not-found',
    });

    const state = await host.stateWhere((s) => s.phase === 'curation');
    expect(state.deck!.map((d) => d.text)).toEqual(['Keep me', 'And me']);
  });

  it('double-clicked delete: second delete acks not-found', async () => {
    const { host, deck } = await makeCuration(['Doomed']);
    expect(await host.emit('solution:delete', { solutionId: deck[0]!.id })).toEqual({ ok: true });
    expect(await host.emit('solution:delete', { solutionId: deck[0]!.id })).toEqual({ error: 'not-found' });
  });

  it('combine payload validation: fewer than two distinct ids or bad text acks invalid-input', async () => {
    const { host, deck } = await makeCuration(['A', 'B']);
    const ids = deck.map((d) => d.id);
    for (const solutionIds of [undefined, 'x', [], [ids[0]], [ids[0], ids[0]], [ids[0], 42]]) {
      expect(await host.emit('solution:combine', { solutionIds })).toEqual({ error: 'invalid-input' });
    }
    for (const text of ['', '   ', 'x'.repeat(301)]) {
      expect(await host.emit('solution:combine', { solutionIds: ids, text })).toEqual({ error: 'invalid-input' });
    }
  });

  it('combine acks not-host for participants and bad-phase outside curation', async () => {
    const host = await h.connect(await h.mintIdentity());
    const created = await host.emit('session:create', CREATE);
    const p = await h.connect(await h.mintIdentity());
    await p.emit('session:join', { joinCode: created.joinCode });

    const ids = ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002'];
    // Crowdsourced lobby: deck not editable yet.
    expect(await host.emit('solution:combine', { solutionIds: ids })).toEqual({ error: 'bad-phase' });
    await host.emit('curation:start', {});
    expect(await p.emit('solution:combine', { solutionIds: ids })).toEqual({ error: 'not-host' });
  });

  it('combine is legal in the preset lobby too (one shared gate)', async () => {
    const host = await h.connect(await h.mintIdentity());
    await host.emit('session:create', { ...CREATE, workflow: 'preset' });
    await host.emit('solution:add', { text: 'Alpha' });
    await host.emit('solution:add', { text: 'Beta' });
    const state = await host.stateWhere((s) => (s.deck?.length ?? 0) === 2);
    const ack = await host.emit('solution:combine', { solutionIds: state.deck!.map((d) => d.id) });
    expect(ack.ok).toBe(true);
    const merged = await host.stateWhere((s) => s.deck?.length === 1);
    expect(merged.deck![0]).toEqual({ id: ack.solutionId, text: 'Alpha / Beta', combined: true });
  });
});
