import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connectClient } from 'socket.io-client';
import { startHarness, type Harness } from './harness';

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
}, 120_000);

afterAll(async () => {
  await h.stop();
});

const CREATE = { problem: 'Where should we hold the offsite?', workflow: 'crowdsourced', hostParticipates: true };

describe('walking skeleton: authenticated session create + join', () => {
  it('host creates, participant joins by code, both receive session:state with count 2', async () => {
    const host = await h.connect(await h.mintIdentity());
    const created = await host.emit('session:create', CREATE);
    expect(created.ok).toBe(true);
    expect(created.sessionId).toBeTruthy();
    expect(created.joinCode).toMatch(/^\d{6}$/);

    const guest = await h.connect(await h.mintIdentity());
    const joined = await guest.emit('session:join', { joinCode: created.joinCode });
    expect(joined).toMatchObject({ ok: true, sessionId: created.sessionId });

    const hostState = await host.stateWhere((s) => s.participants.count === 2);
    const guestState = await guest.stateWhere((s) => s.participants.count === 2);
    expect(hostState).toMatchObject({
      sessionId: created.sessionId,
      joinCode: created.joinCode,
      problem: CREATE.problem,
      workflow: 'crowdsourced',
      phase: 'lobby',
      participants: { count: 2, cap: 8 },
      isHost: true,
      hostParticipates: true,
      me: { submitted: false, voted: false },
      submissions: { submitted: 0, total: 2 },
    });
    expect(guestState.isHost).toBe(false);
    expect(guestState.joinCode).toBe(created.joinCode);
  });

  it('preview returns session facts without creating a membership, and reports isMember', async () => {
    const host = await h.connect(await h.mintIdentity());
    const created = await host.emit('session:create', { ...CREATE, workflow: 'preset' });

    const onlooker = await h.connect(await h.mintIdentity());
    const preview = await onlooker.emit('session:preview', { joinCode: created.joinCode });
    expect(preview).toMatchObject({
      ok: true,
      problem: CREATE.problem,
      workflow: 'preset',
      phase: 'lobby',
      participants: { count: 1, cap: 8 },
      isMember: false,
    });

    // No membership was created: a second preview still counts 1 / isMember false.
    const again = await onlooker.emit('session:preview', { joinCode: created.joinCode });
    expect(again.participants.count).toBe(1);
    expect(again.isMember).toBe(false);

    await onlooker.emit('session:join', { joinCode: created.joinCode });
    const member = await onlooker.emit('session:preview', { joinCode: created.joinCode });
    expect(member).toMatchObject({ ok: true, isMember: true, participants: { count: 2 } });
  });

  it('unknown code acks not-found on preview and join', async () => {
    const c = await h.connect(await h.mintIdentity());
    expect(await c.emit('session:preview', { joinCode: '000000' })).toEqual({ error: 'not-found' });
    expect(await c.emit('session:join', { joinCode: '000000' })).toEqual({ error: 'not-found' });
  });

  it('join beyond cap acks session-full', async () => {
    const host = await h.connect(await h.mintIdentity());
    const created = await host.emit('session:create', { ...CREATE, cap: 2 });
    const second = await h.connect(await h.mintIdentity());
    expect((await second.emit('session:join', { joinCode: created.joinCode })).ok).toBe(true);
    const third = await h.connect(await h.mintIdentity());
    expect(await third.emit('session:join', { joinCode: created.joinCode })).toEqual({ error: 'session-full' });
  });

  it('cap outside 2–100 acks invalid-input', async () => {
    const host = await h.connect(await h.mintIdentity());
    for (const cap of [1, 101, 2.5, '8']) {
      expect(await host.emit('session:create', { ...CREATE, cap })).toEqual({ error: 'invalid-input' });
    }
  });

  it('empty or >500-char problem acks invalid-input', async () => {
    const host = await h.connect(await h.mintIdentity());
    for (const problem of ['', '   ', 'x'.repeat(501)]) {
      expect(await host.emit('session:create', { ...CREATE, problem })).toEqual({ error: 'invalid-input' });
    }
    expect((await host.emit('session:create', { ...CREATE, problem: 'x'.repeat(500) })).ok).toBe(true);
  });

  it('two active sessions never share a join code', async () => {
    const host = await h.connect(await h.mintIdentity());
    const codes = new Set<string>();
    for (let i = 0; i < 5; i++) codes.add((await host.emit('session:create', CREATE)).joinCode);
    expect(codes.size).toBe(5);
    // The real guarantee is the partial unique index: an active duplicate is uninsertable.
    const code = [...codes][0]!;
    await expect(
      h.pool.query(
        `insert into sessions (host_id, problem, workflow, cap, host_participates, join_code)
         select host_id, problem, workflow, cap, host_participates, join_code from sessions where join_code = $1`,
        [code],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('a member rejoining with its stored sessionId gets the current snapshot', async () => {
    const host = await h.connect(await h.mintIdentity());
    const created = await host.emit('session:create', CREATE);
    const guestId = await h.mintIdentity();
    const guest = await h.connect(guestId);
    await guest.emit('session:join', { joinCode: created.joinCode });

    guest.socket.disconnect();
    const back = await h.connect(guestId);
    const rejoined = await back.emit('session:join', { sessionId: created.sessionId });
    expect(rejoined).toMatchObject({ ok: true, sessionId: created.sessionId });
    const state = await back.stateWhere((s) => s.sessionId === created.sessionId);
    expect(state.participants.count).toBe(2);
    expect(state.isHost).toBe(false);
  });

  it("a non-member's sessionId join acks not-found even when the id resolves", async () => {
    const host = await h.connect(await h.mintIdentity());
    const created = await host.emit('session:create', CREATE);
    const stranger = await h.connect(await h.mintIdentity());
    expect(await stranger.emit('session:join', { sessionId: created.sessionId })).toEqual({ error: 'not-found' });
    expect(await stranger.emit('session:join', { sessionId: 'not-a-uuid' })).toEqual({ error: 'not-found' });
  });

  it('rejoin by joinCode is idempotent for an existing member', async () => {
    const host = await h.connect(await h.mintIdentity());
    const created = await host.emit('session:create', CREATE);
    const guestId = await h.mintIdentity();
    const guest = await h.connect(guestId);
    await guest.emit('session:join', { joinCode: created.joinCode });
    const again = await guest.emit('session:join', { joinCode: created.joinCode });
    expect(again).toMatchObject({ ok: true, sessionId: created.sessionId });
    const state = await guest.stateWhere((s) => s.participants.count === 2);
    expect(state.participants.count).toBe(2); // no duplicate membership
  });

  it('handshake with a bad token fails with connect_error unauthorized; no session events fire', async () => {
    const socket = connectClient(h.url(), { auth: { token: 'garbage-token' }, transports: ['websocket'] });
    const states: unknown[] = [];
    socket.on('session:state', (s) => states.push(s));
    try {
      await expect(
        new Promise((resolve, reject) => {
          socket.on('connect', () => resolve(undefined));
          socket.on('connect_error', reject);
        }),
      ).rejects.toThrow('unauthorized');
      await new Promise((r) => setTimeout(r, 100));
      expect(socket.connected).toBe(false);
      expect(states).toEqual([]);
    } finally {
      socket.disconnect();
    }
  });

  it('handshake with no token fails the same way', async () => {
    const socket = connectClient(h.url(), { transports: ['websocket'] });
    try {
      await expect(
        new Promise((resolve, reject) => {
          socket.on('connect', () => resolve(undefined));
          socket.on('connect_error', reject);
        }),
      ).rejects.toThrow('unauthorized');
    } finally {
      socket.disconnect();
    }
  });

  it('server restart loses nothing: a rejoin rehydrates the session from Postgres', async () => {
    const hostId = await h.mintIdentity();
    const host = await h.connect(hostId);
    const created = await host.emit('session:create', CREATE);

    await h.restartServer();

    const back = await h.connect(hostId);
    const rejoined = await back.emit('session:join', { sessionId: created.sessionId });
    expect(rejoined.ok).toBe(true);
    const state = await back.stateWhere((s) => s.sessionId === created.sessionId);
    expect(state).toMatchObject({
      joinCode: created.joinCode,
      problem: CREATE.problem,
      phase: 'lobby',
      participants: { count: 1, cap: 8 },
      isHost: true,
    });
  });

  it('harness can mint profile-less identities that still authenticate (ticket #2 gate tests)', async () => {
    const bare = await h.mintIdentity({ profile: null });
    const c = await h.connect(bare); // handshake succeeds — the profile gate is ticket #2's
    expect(c.socket.connected).toBe(true);
    const { rowCount } = await h.pool.query('select 1 from profiles where id = $1', [bare.userId]);
    expect(rowCount).toBe(0);
  });
});
