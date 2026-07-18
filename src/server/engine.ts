import { createServer, type Server as HttpServer } from 'node:http';
import { randomInt } from 'node:crypto';
import { Server, type Socket } from 'socket.io';
import type { Pool, PoolClient } from 'pg';
import {
  CAP_DEFAULT,
  CAP_MAX,
  CAP_MIN,
  DEPARTMENTS,
  PROBLEM_MAX_LENGTH,
  ROLES,
  SOLUTION_MAX_LENGTH,
  TENURES,
  type Ack,
  type ErrorCode,
  type SessionState,
} from '../shared/contract';

/** Verifies a handshake token; null → connect_error 'unauthorized'. Stubbed in tests.
 *  displayName is the token's Google name — the only source of names, never the client. */
export type VerifyToken = (token: string) => Promise<{ userId: string; displayName: string } | null>;

export type RoomServer = { http: HttpServer; io: Server; close: () => Promise<void> };

class SeamError extends Error {
  constructor(public code: ErrorCode) {
    super(code);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createRoomServer(pool: Pool, verifyToken: VerifyToken): RoomServer {
  const http = createServer();
  const io = new Server(http, { cors: { origin: '*' } });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    const verified = typeof token === 'string' ? await verifyToken(token).catch(() => null) : null;
    if (!verified) return next(new Error('unauthorized'));
    socket.data.userId = verified.userId;
    socket.data.displayName = verified.displayName;
    next();
  });

  // Role-filtered snapshot, built entirely from Postgres — nothing here is in-memory truth.
  async function buildState(sessionId: string, userId: string): Promise<SessionState> {
    const { rows } = await pool.query(
      `select s.*,
              (select count(*)::int from memberships m where m.session_id = s.id) as member_count,
              (select count(*)::int from memberships m where m.session_id = s.id and m.submitted) as submitted_count
         from sessions s where s.id = $1`,
      [sessionId],
    );
    const s = rows[0];
    const me = (
      await pool.query('select submitted, voted, submission_text from memberships where session_id = $1 and user_id = $2', [
        sessionId,
        userId,
      ])
    ).rows[0];
    const isHost = s.host_id === userId;
    const state: SessionState = {
      sessionId: s.id,
      problem: s.problem,
      workflow: s.workflow,
      phase: s.phase,
      participants: { count: s.member_count, cap: s.cap },
      isHost,
      hostParticipates: s.host_participates,
      me: {
        submitted: me?.submitted ?? false,
        voted: me?.voted ?? false,
        ...(me?.submission_text != null ? { submissionText: me.submission_text } : {}),
      },
    };
    if (s.phase !== 'results') state.joinCode = s.join_code;
    if (s.workflow === 'crowdsourced' && (s.phase === 'lobby' || s.phase === 'curation')) {
      state.submissions = {
        submitted: s.submitted_count,
        total: s.member_count - (s.host_participates ? 0 : 1),
      };
    }
    if (isHost || s.phase === 'voting' || s.phase === 'results') {
      const deck = await pool.query(
        'select id, text, combined from solutions where session_id = $1 order by created_at',
        [sessionId],
      );
      state.deck = deck.rows;
    }
    // ponytail: votingProgress/roster/results omitted — voting is unreachable until later tickets
    return state;
  }

  // After every mutation and on (re)join: per-socket because the snapshot is role-filtered.
  async function broadcastState(sessionId: string): Promise<void> {
    const sockets = await io.in(sessionId).fetchSockets();
    await Promise.all(
      sockets.map(async (s) => s.emit('session:state', await buildState(sessionId, s.data.userId))),
    );
  }

  async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (err) {
      await client.query('rollback').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // Every event except these two requires a completed profile (contract matrix).
  const PROFILE_EXEMPT = new Set(['profile:set', 'profile:get']);

  async function requireProfile(userId: string): Promise<void> {
    const { rowCount } = await pool.query('select 1 from profiles where id = $1', [userId]);
    if (!rowCount) throw new SeamError('profile-required');
  }

  // Ack-envelope wrapper: every event acks { ok: true, ... } or { error: ErrorCode } (contract).
  // The profile gate lives here so future handlers can't forget it.
  function handle<T extends object>(socket: Socket, event: string, handler: (payload: any) => Promise<T>): void {
    socket.on(event, async (payload, ack) => {
      if (typeof ack !== 'function') return;
      try {
        if (!PROFILE_EXEMPT.has(event)) await requireProfile(socket.data.userId);
        ack({ ok: true, ...(await handler(payload)) } satisfies Ack<T>);
      } catch (err) {
        if (err instanceof SeamError) return ack({ error: err.code } satisfies Ack);
        console.error(`[${event}]`, err);
        // ponytail: the ErrorCode vocabulary has no internal-error code; invalid-input keeps
        // the "every event acks" contract — revisit if the contract grows one
        ack({ error: 'invalid-input' } satisfies Ack);
      }
    });
  }

  async function joinRoom(socket: Socket, sessionId: string): Promise<void> {
    socket.data.sessionId = sessionId; // in-session events ({ text }, {}) resolve their session from here
    await socket.join(sessionId);
    await broadcastState(sessionId);
  }

  function sessionOf(socket: Socket): string {
    if (typeof socket.data.sessionId !== 'string') throw new SeamError('not-found');
    return socket.data.sessionId;
  }

  function solutionText(raw: unknown): string {
    if (typeof raw !== 'string' || raw.trim().length === 0 || raw.length > SOLUTION_MAX_LENGTH) {
      throw new SeamError('invalid-input');
    }
    return raw;
  }

  // Shared gate for solution:add/edit/delete (one handler per the contract, not per workflow):
  // host only, in the deck-editable phase — preset lobby or crowdsourced curation.
  // Runs fn in a tx holding the session row lock, so voting:start's freeze can't interleave.
  async function hostDeckEdit(
    socket: Socket,
    fn: (c: PoolClient, sessionId: string) => Promise<void>,
  ): Promise<void> {
    const sessionId = sessionOf(socket);
    await tx(async (c) => {
      const { rows } = await c.query('select host_id, workflow, phase from sessions where id = $1 for update', [
        sessionId,
      ]);
      const s = rows[0];
      if (!s) throw new SeamError('not-found');
      if (s.host_id !== socket.data.userId) throw new SeamError('not-host');
      const editable =
        (s.workflow === 'preset' && s.phase === 'lobby') || (s.workflow === 'crowdsourced' && s.phase === 'curation');
      if (!editable) throw new SeamError('bad-phase');
      await fn(c, sessionId);
    });
    await broadcastState(sessionId);
  }

  // The one query behind preview and code-join: active (phase != results) session by join code.
  async function activeSessionByCode(joinCode: string, userId: string) {
    const { rows } = await pool.query(
      `select s.id, s.problem, s.workflow, s.phase, s.cap,
              (select count(*)::int from memberships m where m.session_id = s.id) as count,
              exists (select 1 from memberships m where m.session_id = s.id and m.user_id = $2) as is_member
         from sessions s where s.join_code = $1 and s.phase <> 'results'`,
      [joinCode, userId],
    );
    return rows[0];
  }

  io.on('connection', (socket) => {
    const userId: string = socket.data.userId;

    handle(socket, 'profile:set', async (p) => {
      const { department, role, tenure } = p ?? {};
      if (!DEPARTMENTS.includes(department) || !ROLES.includes(role) || !TENURES.includes(tenure)) {
        throw new SeamError('invalid-input');
      }
      // Upsert: display_name always from the verified token, never the payload —
      // refreshed on every profile write, so it tracks Google name changes.
      await pool.query(
        `insert into profiles (id, display_name, department, role, tenure)
         values ($1, $2, $3, $4, $5)
         on conflict (id) do update
           set display_name = excluded.display_name,
               department = excluded.department, role = excluded.role, tenure = excluded.tenure`,
        [userId, socket.data.displayName, department, role, tenure],
      );
      return {};
    });

    handle(socket, 'profile:get', async () => {
      // Exempt from the profile gate — how the client detects first-time users.
      const { rows } = await pool.query('select department, role, tenure from profiles where id = $1', [userId]);
      return { displayName: socket.data.displayName, profile: rows[0] ?? null };
    });

    handle(socket, 'session:create', async (p) => {
      const { problem, workflow, cap = CAP_DEFAULT, hostParticipates } = p ?? {};
      if (
        typeof problem !== 'string' || problem.trim().length === 0 || problem.length > PROBLEM_MAX_LENGTH ||
        (workflow !== 'crowdsourced' && workflow !== 'preset') ||
        !Number.isInteger(cap) || cap < CAP_MIN || cap > CAP_MAX ||
        typeof hostParticipates !== 'boolean'
      ) {
        throw new SeamError('invalid-input');
      }
      // Recycling-unique code: retry on collision with an active session (partial unique index).
      for (;;) {
        const joinCode = String(randomInt(0, 1_000_000)).padStart(6, '0');
        try {
          const sessionId = await tx(async (c) => {
            const { rows } = await c.query(
              `insert into sessions (host_id, problem, workflow, cap, host_participates, join_code)
               values ($1, $2, $3, $4, $5, $6) returning id`,
              [userId, problem, workflow, cap, hostParticipates, joinCode],
            );
            const id: string = rows[0].id;
            await c.query('insert into memberships (session_id, user_id) values ($1, $2)', [id, userId]);
            return id;
          });
          await joinRoom(socket, sessionId);
          return { sessionId, joinCode };
        } catch (err: any) {
          if (err?.code !== '23505') throw err; // unique_violation on join_code → roll again
        }
      }
    });

    handle(socket, 'session:preview', async (p) => {
      if (typeof p?.joinCode !== 'string') throw new SeamError('invalid-input');
      const s = await activeSessionByCode(p.joinCode, userId);
      if (!s) throw new SeamError('not-found');
      return {
        problem: s.problem,
        workflow: s.workflow,
        phase: s.phase,
        participants: { count: s.count, cap: s.cap },
        isMember: s.is_member,
      };
    });

    handle(socket, 'session:join', async (p) => {
      if (typeof p?.sessionId === 'string') {
        // Rejoin by stored sessionId: members only, any phase. A non-member acks not-found
        // even when the id resolves — don't leak session existence.
        if (!UUID_RE.test(p.sessionId)) throw new SeamError('not-found');
        const { rowCount } = await pool.query(
          'select 1 from memberships where session_id = $1 and user_id = $2',
          [p.sessionId, userId],
        );
        if (!rowCount) throw new SeamError('not-found');
        await joinRoom(socket, p.sessionId);
        return { sessionId: p.sessionId };
      }

      if (typeof p?.joinCode !== 'string') throw new SeamError('invalid-input');
      const s = await activeSessionByCode(p.joinCode, userId);
      if (!s) throw new SeamError('not-found');
      if (!s.is_member) {
        // New joiners only: members rejoin past every gate (lost-device recovery).
        if (s.phase === 'voting') throw new SeamError('voting-started');
        // Session row lock serialises concurrent joins so the cap can't be overshot.
        const inserted = await tx(async (c) => {
          await c.query('select 1 from sessions where id = $1 for update', [s.id]);
          return c.query(
            `insert into memberships (session_id, user_id)
             select $1, $2 where (select count(*) from memberships where session_id = $1) < $3`,
            [s.id, userId, s.cap],
          );
        });
        if (!inserted.rowCount) throw new SeamError('session-full');
      }
      await joinRoom(socket, s.id);
      return { sessionId: s.id };
    });

    handle(socket, 'solution:submit', async (p) => {
      const text = solutionText(p?.text);
      const sessionId = sessionOf(socket);
      try {
        await tx(async (c) => {
          // Row lock: curation:start's phase UPDATE queues behind this tx, so phase can't flip mid-submit.
          const { rows } = await c.query(
            'select workflow, phase, host_id, host_participates from sessions where id = $1 for update',
            [sessionId],
          );
          const s = rows[0];
          if (!s) throw new SeamError('not-found');
          if (s.workflow !== 'crowdsourced' || s.phase !== 'lobby') throw new SeamError('bad-phase');
          if (s.host_id === userId && !s.host_participates) throw new SeamError('not-participant');
          const m = await c.query('select submitted from memberships where session_id = $1 and user_id = $2', [
            sessionId,
            userId,
          ]);
          if (!m.rowCount) throw new SeamError('not-found');
          if (m.rows[0].submitted) throw new SeamError('already-submitted');
          // submitted_by is stored for the one-per-participant constraint — never serialized (ADR-0002).
          await c.query('insert into solutions (session_id, text, submitted_by) values ($1, $2, $3)', [
            sessionId,
            text,
            userId,
          ]);
          // Immutable snapshot: me.submissionText reads this, so it survives curation hard-deletes.
          await c.query('update memberships set submitted = true, submission_text = $3 where session_id = $1 and user_id = $2', [
            sessionId,
            userId,
            text,
          ]);
        });
      } catch (err: any) {
        if (err?.code === '23505') throw new SeamError('already-submitted'); // unique (session_id, submitted_by) race
        throw err;
      }
      await broadcastState(sessionId);
      return {};
    });

    handle(socket, 'solution:add', async (p) => {
      const text = solutionText(p?.text);
      // submitted_by stays NULL (host-authored row) — the one-per-participant unique index never bites.
      await hostDeckEdit(socket, async (c, sessionId) => {
        await c.query('insert into solutions (session_id, text) values ($1, $2)', [sessionId, text]);
      });
      return {};
    });

    handle(socket, 'solution:edit', async (p) => {
      const text = solutionText(p?.text);
      if (typeof p?.solutionId !== 'string' || !UUID_RE.test(p.solutionId)) throw new SeamError('not-found');
      await hostDeckEdit(socket, async (c, sessionId) => {
        // session_id in the WHERE: another session's solution id acks not-found, no cross-room edits.
        const { rowCount } = await c.query('update solutions set text = $3 where id = $1 and session_id = $2', [
          p.solutionId,
          sessionId,
          text,
        ]);
        if (!rowCount) throw new SeamError('not-found');
      });
      return {};
    });

    handle(socket, 'solution:delete', async (p) => {
      if (typeof p?.solutionId !== 'string' || !UUID_RE.test(p.solutionId)) throw new SeamError('not-found');
      // Hard delete — the table IS the deck (schema).
      await hostDeckEdit(socket, async (c, sessionId) => {
        const { rowCount } = await c.query('delete from solutions where id = $1 and session_id = $2', [
          p.solutionId,
          sessionId,
        ]);
        if (!rowCount) throw new SeamError('not-found');
      });
      return {};
    });

    handle(socket, 'curation:start', async () => {
      const sessionId = sessionOf(socket);
      const { rows } = await pool.query('select host_id, workflow, phase from sessions where id = $1', [sessionId]);
      const s = rows[0];
      if (!s) throw new SeamError('not-found');
      if (s.host_id !== userId) throw new SeamError('not-host');
      if (s.workflow !== 'crowdsourced' || s.phase !== 'lobby') throw new SeamError('bad-phase');
      // Legal with zero solutions — empty-deck gates only voting:start (contract).
      // Phase guard in the WHERE makes a double-fire lose atomically.
      const { rowCount } = await pool.query(
        `update sessions set phase = 'curation' where id = $1 and phase = 'lobby'`,
        [sessionId],
      );
      if (!rowCount) throw new SeamError('bad-phase');
      await broadcastState(sessionId);
      return {};
    });
  });

  return {
    http,
    io,
    close: () => new Promise<void>((resolve) => io.close(() => resolve())),
  };
}
