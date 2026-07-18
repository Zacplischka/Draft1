import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
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
  SCORE_MAX,
  SCORE_MIN,
  SOLUTION_MAX_LENGTH,
  SUPPRESSION_N,
  TENURES,
  type Ack,
  type ErrorCode,
  type HostReport,
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

// Counted participants: the submit/vote denominator — members minus a hostParticipates=false host.
const countedTotal = (members: number, hostParticipates: boolean) => members - (hostParticipates ? 0 : 1);

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
              (select count(*)::int from memberships m where m.session_id = s.id and m.submitted) as submitted_count,
              (select count(*)::int from memberships m where m.session_id = s.id and m.voted) as voted_count
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
        total: countedTotal(s.member_count, s.host_participates),
      };
    }
    if (isHost || s.phase === 'voting' || s.phase === 'results') {
      const deck = await pool.query(
        'select id, text, combined from solutions where session_id = $1 order by created_at, id',
        [sessionId],
      );
      state.deck = deck.rows;
    }
    if (s.phase === 'voting') {
      state.votingProgress = { voted: s.voted_count, total: countedTotal(s.member_count, s.host_participates) };
      if (isHost) {
        // HOST ONLY: who has finished — names + voted flag, never scores (ADR-0002).
        // The WHERE is countedTotal in SQL: a hostParticipates=false host is not listed.
        const roster = await pool.query(
          `select p.display_name as "displayName", m.voted
             from memberships m join profiles p on p.id = m.user_id
            where m.session_id = $1 and ($2 or m.user_id <> $3)
            order by m.joined_at`,
          [sessionId, s.host_participates, s.host_id],
        );
        state.roster = roster.rows;
      }
    }
    if (s.phase === 'results') {
      state.results = {
        // Served avg is an integer, round-half-up (Math.round on non-negative means).
        ranked: (await rankedMeans(sessionId)).map((r) => ({
          solutionId: r.solutionId,
          text: r.text,
          avg: r.mean === null ? null : Math.round(r.mean),
        })),
      };
    }
    return state;
  }

  // Rank by UNROUNDED mean, ties by solutionId ascending — the ONE rule for socket
  // results, report, and CSV alike (contract). Ballots are atomic over the whole
  // deck, so means are either all present or all null (zero-ballot close, which
  // keeps the SQL's deck/insertion order).
  async function rankedMeans(sessionId: string): Promise<{ solutionId: string; text: string; mean: number | null }[]> {
    const { rows } = await pool.query(
      `select s.id as "solutionId", s.text, avg(bs.score) as mean
         from solutions s left join ballot_scores bs on bs.solution_id = s.id
        where s.session_id = $1
        group by s.id order by s.created_at, s.id`,
      [sessionId],
    );
    const ranked = rows.map((r) => ({ ...r, mean: r.mean === null ? null : Number(r.mean) }));
    if (ranked.some((r) => r.mean !== null)) {
      ranked.sort((a, b) => b.mean - a.mean || (a.solutionId < b.solutionId ? -1 : 1));
    }
    return ranked;
  }

  // ---- Host report over HTTP (docs/CONTRACTS.md HTTP section; issue #8) ----
  // The single anonymity enforcement point of ADR-0002/0003: aggregates computed on
  // read from ballot snapshot rows; per-user scores never leave this function.

  const REPORT_PATH = /^\/api\/sessions\/([^/]+)\/report(\.csv)?$/;

  http.on('request', (req, res) => {
    const path = (req.url ?? '').split('?')[0]!;
    const m = req.method === 'GET' ? REPORT_PATH.exec(path) : null;
    if (!m) {
      // static.ts skips /api/ entirely, so unmatched /api/ paths must answer here or hang.
      if (path.startsWith('/api/')) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'not-found' }));
      }
      return;
    }
    serveReport(req, res, m[1]!, Boolean(m[2])).catch((err) => {
      console.error('[report]', err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  // Nearest-rank percentile over ascending integer scores (contract: spread = middle-50% range).
  const nearestRank = (sorted: number[], p: number) => sorted[Math.ceil((p / 100) * sorted.length) - 1]!;
  const roundedAvg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);

  async function serveReport(req: IncomingMessage, res: ServerResponse, sessionId: string, asCsv: boolean): Promise<void> {
    const auth = req.headers.authorization;
    const verified = auth?.startsWith('Bearer ') ? await verifyToken(auth.slice(7)).catch(() => null) : null;
    const send = (status: number, contentType: string, body: string) => {
      res.writeHead(status, { 'content-type': contentType });
      res.end(body);
    };
    // ONE 404 for participants, strangers, bad tokens, and unknown ids — no existence leak.
    const s = verified && UUID_RE.test(sessionId)
      ? (
          await pool.query(
            `select problem, workflow, phase, host_id, closed_at,
                    (select count(*)::int from memberships m where m.session_id = s.id) as participants
               from sessions s where s.id = $1`,
            [sessionId],
          )
        ).rows[0]
      : null;
    if (!s || s.host_id !== verified!.userId) return send(404, 'application/json', JSON.stringify({ error: 'not-found' }));
    if (s.phase !== 'results') return send(409, 'application/json', JSON.stringify({ error: 'bad-phase' }));

    const ranked = await rankedMeans(sessionId);
    const ballots: { id: string; department: string; role: string; tenure: string }[] = (
      await pool.query('select id, department, role, tenure from ballots where session_id = $1', [sessionId])
    ).rows;
    // score per (solution, ballot) — ballots are atomic, so every ballot covers every solution
    const scoreRows = (
      await pool.query(
        `select bs.solution_id as "solutionId", bs.ballot_id as "ballotId", bs.score
           from ballot_scores bs join ballots b on b.id = bs.ballot_id
          where b.session_id = $1`,
        [sessionId],
      )
    ).rows;
    const bySolution = new Map<string, Map<string, number>>();
    for (const r of scoreRows) {
      let m = bySolution.get(r.solutionId);
      if (!m) bySolution.set(r.solutionId, (m = new Map()));
      m.set(r.ballotId, r.score);
    }

    const solutions = ranked.map((r) => {
      const scores = [...(bySolution.get(r.solutionId)?.values() ?? [])].sort((a, b) => a - b);
      return scores.length
        ? { id: r.solutionId, text: r.text, avg: Math.round(r.mean!), p25: nearestRank(scores, 25), p75: nearestRank(scores, 75) }
        : { id: r.solutionId, text: r.text, avg: null, p25: null, p75: null };
    });

    // Cohorts from ballot SNAPSHOTS (never live profiles); zero-ballot cohorts don't appear.
    // n is always served — it reveals attendance, never scores; values suppressed under N.
    const heatmap: HostReport['heatmap'] = {};
    const dimensions = { department: DEPARTMENTS, role: ROLES, tenure: TENURES } as const;
    for (const [dim, cohortValues] of Object.entries(dimensions)) {
      heatmap[dim] = {};
      for (const cohort of cohortValues) {
        const ids = ballots.filter((b) => b[dim as keyof typeof dimensions] === cohort).map((b) => b.id);
        if (!ids.length) continue;
        const cells: Record<string, number | 'suppressed'> = {};
        for (const r of ranked) {
          cells[r.solutionId] =
            ids.length < SUPPRESSION_N ? 'suppressed' : roundedAvg(ids.map((id) => bySolution.get(r.solutionId)!.get(id)!));
        }
        heatmap[dim][cohort] = { n: ids.length, cells };
      }
    }

    if (!asCsv) {
      const report: HostReport = {
        session: { problem: s.problem, workflow: s.workflow, participants: s.participants, closedAt: s.closed_at.toISOString() },
        solutions,
        heatmap,
      };
      return send(200, 'application/json', JSON.stringify(report));
    }

    // CSV mirrors the report: fixed 7-column header, one row per (solution × dimension ×
    // cohort) in ranked order, whole-room rows first per solution. Suppressed avg is the
    // literal SUPPRESSED; empty cells are empty strings (the "—" is UI, never in the file).
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
    const lines = ['solution_text,dimension,cohort,n_voters,avg,p25,p75'];
    for (const sol of solutions) {
      lines.push([esc(sol.text), 'all', 'all', ballots.length, sol.avg ?? '', sol.p25 ?? '', sol.p75 ?? ''].join(','));
      for (const [dim, cohorts] of Object.entries(heatmap)) {
        for (const [cohort, { n, cells }] of Object.entries(cohorts)) {
          const cell = cells[sol.id]!;
          lines.push([esc(sol.text), dim, esc(cohort), n, cell === 'suppressed' ? 'SUPPRESSED' : cell, '', ''].join(','));
        }
      }
    }
    send(200, 'text/csv; charset=utf-8', lines.join('\n') + '\n');
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

  // Shared gate for solution:add/edit/delete/combine AND voting:start (whose legality window is
  // exactly the deck-editable phases): host only, preset lobby or crowdsourced curation.
  // Runs fn in a tx holding the session row lock, so voting:start's freeze can't interleave.
  async function hostDeckEdit<T>(
    socket: Socket,
    fn: (c: PoolClient, sessionId: string) => Promise<T>,
  ): Promise<T> {
    const sessionId = sessionOf(socket);
    const result = await tx(async (c) => {
      const { rows } = await c.query('select host_id, workflow, phase from sessions where id = $1 for update', [
        sessionId,
      ]);
      const s = rows[0];
      if (!s) throw new SeamError('not-found');
      if (s.host_id !== socket.data.userId) throw new SeamError('not-host');
      const editable =
        (s.workflow === 'preset' && s.phase === 'lobby') || (s.workflow === 'crowdsourced' && s.phase === 'curation');
      if (!editable) throw new SeamError('bad-phase');
      return fn(c, sessionId);
    });
    await broadcastState(sessionId);
    return result;
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

    handle(socket, 'solution:combine', async (p) => {
      const raw: unknown = p?.solutionIds;
      if (!Array.isArray(raw) || raw.some((id) => typeof id !== 'string')) throw new SeamError('invalid-input');
      const ids = [...new Set(raw as string[])];
      if (ids.length < 2) throw new SeamError('invalid-input'); // combining needs 2+ distinct sources
      // text optional: the host edits the merged wording in the modal; absent → " / " join below.
      const text = p?.text === undefined ? undefined : solutionText(p.text);
      if (ids.some((id) => !UUID_RE.test(id))) throw new SeamError('not-found');
      const solutionId = await hostDeckEdit(socket, async (c, sessionId) => {
        const sources = await c.query(
          'select text from solutions where session_id = $1 and id = any($2) order by created_at',
          [sessionId, ids],
        );
        if (sources.rowCount !== ids.length) throw new SeamError('not-found'); // tx rolls back — nothing deleted
        await c.query('delete from solutions where session_id = $1 and id = any($2)', [sessionId, ids]);
        // One new row: combined = true, submitted_by NULL (schema's hard-delete rule).
        const { rows } = await c.query(
          'insert into solutions (session_id, text, combined) values ($1, $2, true) returning id',
          [sessionId, text ?? sources.rows.map((r) => r.text).join(' / ')],
        );
        return rows[0].id as string;
      });
      return { solutionId };
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

    handle(socket, 'voting:start', async () => {
      // DECK IS IMMUTABLE FROM THIS MOMENT: hostDeckEdit's phase window is exactly
      // voting:start's legality window, and once phase = voting every deck edit acks bad-phase.
      await hostDeckEdit(socket, async (c, sessionId) => {
        const { rows } = await c.query('select count(*)::int as n from solutions where session_id = $1', [sessionId]);
        if (!rows[0].n) throw new SeamError('empty-deck');
        await c.query(`update sessions set phase = 'voting' where id = $1`, [sessionId]);
      });
      return {};
    });

    handle(socket, 'ballot:submit', async (p) => {
      const scores: unknown = p?.scores;
      if (typeof scores !== 'object' || scores === null || Array.isArray(scores)) throw new SeamError('invalid-input');
      const entries = Object.entries(scores);
      if (entries.some(([, v]) => !Number.isInteger(v) || (v as number) < SCORE_MIN || (v as number) > SCORE_MAX)) {
        throw new SeamError('invalid-input');
      }
      const sessionId = sessionOf(socket);
      try {
        await tx(async (c) => {
          // Session row lock serialises concurrent ballots and voting:close, so the
          // everyone-voted check below can't double-fire or race a phase flip.
          const { rows } = await c.query(
            'select host_id, host_participates, phase from sessions where id = $1 for update',
            [sessionId],
          );
          const s = rows[0];
          if (!s) throw new SeamError('not-found');
          if (s.phase !== 'voting') throw new SeamError('bad-phase');
          if (s.host_id === userId && !s.host_participates) throw new SeamError('not-participant');
          const m = await c.query('select voted from memberships where session_id = $1 and user_id = $2', [
            sessionId,
            userId,
          ]);
          if (!m.rowCount) throw new SeamError('not-found');
          if (m.rows[0].voted) throw new SeamError('duplicate-ballot');
          // Atomic coverage check: scores must be the exact deck — no missing or stale solution.
          const deck = await c.query('select id from solutions where session_id = $1', [sessionId]);
          const deckIds = new Set<string>(deck.rows.map((r) => r.id));
          if (entries.length !== deckIds.size || entries.some(([id]) => !deckIds.has(id))) {
            throw new SeamError('incomplete-ballot');
          }
          // Demographic snapshot at submission: reports read the ballot's copy, so later
          // profile edits never rewrite it (schema).
          const ballot = await c.query(
            `insert into ballots (session_id, user_id, department, role, tenure)
             select $1, $2, department, role, tenure from profiles where id = $2 returning id`,
            [sessionId, userId],
          );
          await c.query(
            `insert into ballot_scores (ballot_id, solution_id, score)
             select $1, unnest($2::uuid[]), unnest($3::int[])`,
            [ballot.rows[0].id, entries.map(([id]) => id), entries.map(([, v]) => v)],
          );
          await c.query('update memberships set voted = true where session_id = $1 and user_id = $2', [
            sessionId,
            userId,
          ]);
          // Everyone-voted auto-complete over COUNTED participants; total = 0 never completes.
          const counts = await c.query(
            `select count(*)::int as members, count(*) filter (where voted)::int as voted
               from memberships where session_id = $1`,
            [sessionId],
          );
          const total = countedTotal(counts.rows[0].members, s.host_participates);
          if (total > 0 && counts.rows[0].voted >= total) {
            await c.query(`update sessions set phase = 'results', closed_at = now() where id = $1`, [sessionId]);
          }
        });
      } catch (err: any) {
        if (err?.code === '23505') throw new SeamError('duplicate-ballot'); // unique (session_id, user_id) race
        throw err;
      }
      await broadcastState(sessionId);
      return {};
    });

    handle(socket, 'voting:close', async () => {
      const sessionId = sessionOf(socket);
      await tx(async (c) => {
        // Same lock as ballot:submit — a close can't interleave a mid-flight ballot.
        const { rows } = await c.query('select host_id, phase from sessions where id = $1 for update', [sessionId]);
        const s = rows[0];
        if (!s) throw new SeamError('not-found');
        if (s.host_id !== userId) throw new SeamError('not-host');
        if (s.phase !== 'voting') throw new SeamError('bad-phase');
        // Legal with ZERO ballots — the host's escape hatch (contract).
        await c.query(`update sessions set phase = 'results', closed_at = now() where id = $1`, [sessionId]);
      });
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
