import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHarness, type Harness } from './harness';
import type { HostReport, SessionSummary } from '../src/shared/contract';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 120_000);

afterAll(async () => {
  await h.stop();
});

const get = (path: string, token?: string) =>
  fetch(h.url() + path, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);

const list = async (token?: string) => {
  const res = await get('/api/sessions', token);
  return { status: res.status, body: res.status === 200 ? ((await res.json()) as SessionSummary[]) : null };
};

describe('host history: GET /api/sessions', () => {
  it('returns the host sessions only — live with joinCode + count, completed with closedAt and no joinCode', async () => {
    const hostId = await h.mintIdentity();
    const host = await h.connect(hostId);

    // Completed session: one voter, auto-completes to results.
    const done = await host.emit('session:create', {
      problem: 'Done problem',
      workflow: 'preset',
      hostParticipates: false,
      cap: 50,
    });
    await host.emit('solution:add', { text: 'Alpha' });
    const voterId = await h.mintIdentity();
    const voter = await h.connect(voterId);
    await voter.emit('session:join', { joinCode: done.joinCode });
    await host.emit('voting:start', {});
    const deck = (await host.stateWhere((s) => s.phase === 'voting')).deck!;
    await voter.emit('ballot:submit', { scores: { [deck[0]!.id]: 70 } });
    await host.stateWhere((s) => s.phase === 'results');

    // Live session: host + one member, still in lobby.
    const live = await host.emit('session:create', {
      problem: 'Live problem',
      workflow: 'crowdsourced',
      hostParticipates: true,
      cap: 10,
    });
    await voter.emit('session:join', { joinCode: live.joinCode });

    const { status, body } = await list(hostId.token);
    expect(status).toBe(200);
    const mine = body!;
    expect(mine).toHaveLength(2);
    // Newest first — the live session leads.
    expect(mine[0]).toEqual({
      id: live.sessionId,
      problem: 'Live problem',
      workflow: 'crowdsourced',
      phase: 'lobby',
      joinCode: live.joinCode,
      participants: 2,
      cap: 10,
      createdAt: expect.any(String),
    });
    expect(mine[1]).toEqual({
      id: done.sessionId,
      problem: 'Done problem',
      workflow: 'preset',
      phase: 'results',
      participants: 2,
      cap: 50,
      createdAt: expect.any(String),
      closedAt: expect.any(String),
    });
    expect(mine[1]).not.toHaveProperty('joinCode');

    // The participant hosts nothing: their list contains neither session.
    const voterList = await list(voterId.token);
    expect(voterList.status).toBe(200);
    expect(voterList.body).toEqual([]);

    // Bad or missing tokens: one 404, like the other HTTP endpoints.
    expect((await list('no-such-token')).status).toBe(404);
    expect((await list()).status).toBe(404);
  });

  it('a closed report reopens identical after profile edits and a server restart', async () => {
    const hostId = await h.mintIdentity();
    const host = await h.connect(hostId);
    const created = await host.emit('session:create', {
      problem: 'Stable report',
      workflow: 'preset',
      hostParticipates: false,
      cap: 50,
    });
    await host.emit('solution:add', { text: 'Alpha' });
    const voters = [];
    for (let i = 0; i < 3; i++) {
      const id = await h.mintIdentity({ profile: { department: 'Product', role: 'Team Lead', tenure: '<1 year' } });
      const client = await h.connect(id);
      await client.emit('session:join', { joinCode: created.joinCode });
      voters.push(client);
    }
    await host.emit('voting:start', {});
    const deck = (await host.stateWhere((s) => s.phase === 'voting')).deck!;
    for (const [i, v] of voters.entries()) {
      await v.emit('ballot:submit', { scores: { [deck[0]!.id]: 10 + i * 10 } });
    }
    await host.stateWhere((s) => s.phase === 'results');

    const before = (await (await get(`/api/sessions/${created.sessionId}/report`, hostId.token)).json()) as HostReport;
    expect(before.heatmap.department).toEqual({ Product: { n: 3, cells: { [deck[0]!.id]: 20 } } });

    // Every voter switches cohort, then the server restarts — "months later".
    for (const v of voters) {
      expect(
        await v.emit('profile:set', { department: 'Sales', role: 'Manager', tenure: '10+ years' }),
      ).toEqual({ ok: true });
    }
    await h.restartServer();

    const after = (await (await get(`/api/sessions/${created.sessionId}/report`, hostId.token)).json()) as HostReport;
    expect(after).toEqual(before);

    // And the completed session still shows up in history after the restart.
    const { body } = await list(hostId.token);
    expect(body!.map((s) => s.id)).toContain(created.sessionId);
  });
});
