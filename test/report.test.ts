import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHarness, type Harness, type Identity, type TestClient } from './harness';
import type { Department, HostReport, Profile, Role, Tenure } from '../src/shared/contract';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 120_000);

afterAll(async () => {
  await h.stop();
});

const prof = (
  department: Department = 'Product',
  role: Role = 'Individual Contributor',
  tenure: Tenure = '<1 year',
): Profile => ({ department, role, tenure });

const get = (path: string, token?: string) =>
  fetch(h.url() + path, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);

/** Preset session (hostParticipates: false), given deck; each voter joins with the given
 *  profile and submits scores aligned to deck order. Auto-completes to results when all vote. */
async function votedSession(deckTexts: string[], voters: { profile?: Profile; scores: number[] }[]) {
  const hostId = await h.mintIdentity();
  const host = await h.connect(hostId);
  const created = await host.emit('session:create', {
    problem: 'Pick one',
    workflow: 'preset',
    hostParticipates: false,
    cap: 50,
  });
  for (const text of deckTexts) await host.emit('solution:add', { text });
  const joined: { client: TestClient; id: Identity }[] = [];
  for (const v of voters) {
    const id = await h.mintIdentity({ profile: v.profile ?? prof() });
    const client = await h.connect(id);
    await client.emit('session:join', { joinCode: created.joinCode });
    joined.push({ client, id });
  }
  await host.emit('voting:start', {});
  const deck = (await host.stateWhere((s) => s.phase === 'voting')).deck!;
  for (let i = 0; i < voters.length; i++) {
    const scores = Object.fromEntries(deck.map((d, j) => [d.id, voters[i]!.scores[j]!]));
    const ack = await joined[i]!.client.emit('ballot:submit', { scores });
    expect(ack).toEqual({ ok: true });
  }
  if (voters.length) await host.stateWhere((s) => s.phase === 'results');
  return { host, hostId, deck, voters: joined, sessionId: created.sessionId as string };
}

describe('host report: access control', () => {
  it('serves only the host; participants, strangers, bad tokens, unknown ids all get one 404', async () => {
    const { hostId, voters, sessionId } = await votedSession(['Alpha'], [{ scores: [60] }]);
    const stranger = await h.mintIdentity();

    expect((await get(`/api/sessions/${sessionId}/report`, hostId.token)).status).toBe(200);
    for (const path of [`/api/sessions/${sessionId}/report`, `/api/sessions/${sessionId}/report.csv`]) {
      expect((await get(path, voters[0]!.id.token)).status).toBe(404); // participant
      expect((await get(path, stranger.token)).status).toBe(404); // stranger
      expect((await get(path, 'no-such-token')).status).toBe(404); // bad token
      expect((await get(path)).status).toBe(404); // no token
    }
    expect((await get(`/api/sessions/${randomUUID()}/report`, hostId.token)).status).toBe(404); // unknown id
    expect((await get('/api/sessions/not-a-uuid/report', hostId.token)).status).toBe(404);

    // Unmatched /api/ paths answer 404 rather than hanging (static.ts skips /api/ entirely).
    expect((await get('/api/nope', hostId.token)).status).toBe(404);
    const post = await fetch(h.url() + `/api/sessions/${sessionId}/report`, { method: 'POST' });
    expect(post.status).toBe(404);
  });

  it('a session not yet in results returns 409 on both endpoints', async () => {
    // votedSession with no voters leaves the session in voting (no auto-complete at total 0)
    const { hostId, sessionId } = await votedSession(['Alpha'], []);
    expect((await get(`/api/sessions/${sessionId}/report`, hostId.token)).status).toBe(409);
    expect((await get(`/api/sessions/${sessionId}/report.csv`, hostId.token)).status).toBe(409);
  });
});

describe('host report: values', () => {
  it('averages, p25/p75 (nearest-rank), session metadata, and ranked order matching results.ranked', async () => {
    // Alpha scores [10,20,30,100]: mean 40, p25 = 1st of 4 = 10, p75 = 3rd = 30.
    // Beta scores [50,51,52,53]: mean 51.5 → avg 52 (round-half-up), p25 = 50, p75 = 52.
    const { host, hostId, deck, sessionId } = await votedSession(
      ['Alpha', 'Beta'],
      [
        { scores: [10, 50] },
        { scores: [20, 51] },
        { scores: [30, 52] },
        { scores: [100, 53] },
      ],
    );
    const [alpha, beta] = deck;
    const res = await get(`/api/sessions/${sessionId}/report`, hostId.token);
    expect(res.status).toBe(200);
    const report = (await res.json()) as HostReport;

    expect(report.session.problem).toBe('Pick one');
    expect(report.session.workflow).toBe('preset');
    expect(report.session.participants).toBe(5); // 4 voters + host = MEMBER count
    expect(report.session.closedAt).toBeTruthy();

    // Ranked: Beta (51.5) beats Alpha (40) — identical ordering to results.ranked.
    expect(report.solutions).toEqual([
      { id: beta!.id, text: 'Beta', avg: 52, p25: 50, p75: 52 },
      { id: alpha!.id, text: 'Alpha', avg: 40, p25: 10, p75: 30 },
    ]);
    const socketResults = await host.stateWhere((s) => s.phase === 'results');
    expect(report.solutions.map((s) => s.id)).toEqual(socketResults.results!.ranked.map((r) => r.solutionId));

    // All 4 voters share one cohort per dimension — values shown, n always present.
    expect(report.heatmap.department).toEqual({
      Product: { n: 4, cells: { [alpha!.id]: 40, [beta!.id]: 52 } },
    });
  });

  it('a 2-ballot cohort is suppressed in every cell but keeps n; a 3-ballot cohort shows values; whole-room always shown', async () => {
    const tl = (department: Department, scores: number[]) => ({
      profile: prof(department, 'Team Lead'),
      scores,
    });
    const { deck, hostId, sessionId } = await votedSession(
      ['Alpha', 'Beta'],
      [
        tl('Product', [10, 90]),
        tl('Product', [20, 100]),
        tl('Product', [30, 80]),
        tl('Engineering', [90, 70]),
        tl('Engineering', [100, 60]),
      ],
    );
    const [alpha, beta] = deck;
    const report = (await (await get(`/api/sessions/${sessionId}/report`, hostId.token)).json()) as HostReport;

    // Whole room: Beta [60..100] mean 80, p25 70, p75 90; Alpha [10,20,30,90,100] mean 50, p25 20, p75 90.
    expect(report.solutions).toEqual([
      { id: beta!.id, text: 'Beta', avg: 80, p25: 70, p75: 90 },
      { id: alpha!.id, text: 'Alpha', avg: 50, p25: 20, p75: 90 },
    ]);
    expect(report.heatmap.department).toEqual({
      Product: { n: 3, cells: { [alpha!.id]: 20, [beta!.id]: 90 } },
      Engineering: { n: 2, cells: { [alpha!.id]: 'suppressed', [beta!.id]: 'suppressed' } },
    });
    expect(report.heatmap.role).toEqual({
      'Team Lead': { n: 5, cells: { [alpha!.id]: 50, [beta!.id]: 80 } },
    });
  });

  it('ballots count under their snapshot cohort even after the voter edits their profile', async () => {
    const { voters, hostId, sessionId } = await votedSession(
      ['Alpha'],
      [
        { profile: prof('Product'), scores: [10] },
        { profile: prof('Product'), scores: [20] },
        { profile: prof('Product'), scores: [30] },
      ],
    );
    const moved = await voters[0]!.client.emit('profile:set', prof('Engineering'));
    expect(moved).toEqual({ ok: true });

    const report = (await (await get(`/api/sessions/${sessionId}/report`, hostId.token)).json()) as HostReport;
    expect(Object.keys(report.heatmap.department!)).toEqual(['Product']);
    expect(report.heatmap.department!['Product']!.n).toBe(3);
  });

  it('zero-ballot close: null avg/p25/p75 in deck order, heatmap with no cohorts', async () => {
    const { host, hostId, deck, sessionId } = await votedSession(['First', 'Second'], []);
    expect(await host.emit('voting:close', {})).toEqual({ ok: true });

    const report = (await (await get(`/api/sessions/${sessionId}/report`, hostId.token)).json()) as HostReport;
    expect(report.solutions).toEqual(deck.map((d) => ({ id: d.id, text: d.text, avg: null, p25: null, p75: null })));
    expect(report.heatmap).toEqual({ department: {}, role: {}, tenure: {} });
  });
});

describe('host report: CSV', () => {
  it('fixed header, ranked order, SUPPRESSED literal, n always filled, p25/p75 only on whole-room rows', async () => {
    const tl = (department: Department, scores: number[]) => ({
      profile: prof(department, 'Team Lead'),
      scores,
    });
    const { hostId, sessionId } = await votedSession(
      ['Alpha', 'Beta'],
      [
        tl('Product', [10, 90]),
        tl('Product', [20, 100]),
        tl('Product', [30, 80]),
        tl('Engineering', [90, 70]),
        tl('Engineering', [100, 60]),
      ],
    );
    const res = await get(`/api/sessions/${sessionId}/report.csv`, hostId.token);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(await res.text()).toBe(
      [
        'solution_text,dimension,cohort,n_voters,avg,p25,p75',
        'Beta,all,all,5,80,70,90',
        'Beta,department,Product,3,90,,',
        'Beta,department,Engineering,2,SUPPRESSED,,',
        'Beta,role,Team Lead,5,80,,',
        'Beta,tenure,<1 year,5,80,,',
        'Alpha,all,all,5,50,20,90',
        'Alpha,department,Product,3,20,,',
        'Alpha,department,Engineering,2,SUPPRESSED,,',
        'Alpha,role,Team Lead,5,50,,',
        'Alpha,tenure,<1 year,5,50,,',
        '',
      ].join('\n'),
    );
  });

  it('zero-ballot CSV: whole-room rows only, n_voters 0, empty value cells (never a dash)', async () => {
    const { host, hostId, sessionId } = await votedSession(['Only, "quoted"'], []);
    expect(await host.emit('voting:close', {})).toEqual({ ok: true });

    const text = await (await get(`/api/sessions/${sessionId}/report.csv`, hostId.token)).text();
    expect(text).toBe(
      ['solution_text,dimension,cohort,n_voters,avg,p25,p75', '"Only, ""quoted""",all,all,0,,,', ''].join('\n'),
    );
  });
});
