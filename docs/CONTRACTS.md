# Seam Contracts — Room Engine API

The single test seam (see `docs/SPEC.md` Testing Decisions). Every ticket implements against these names and shapes; seam tests connect as fake socket clients and assert only on what's below. Vocabulary per `CONTEXT.md`; anonymity rules per ADR-0002; all data flows through this server per ADR-0003.

## Transport & envelope

- Socket.IO. The handshake carries `{ token }`; the server verifies it via Supabase before any handler runs (the stubbed boundary in tests). Client-supplied identity is never read. **Handshake rejection**: a bad/expired token fails the connection itself — Socket.IO `connect_error` with message `'unauthorized'` (no ack envelope exists yet). Clients retry with a freshly-read token; if that too is rejected, treat as signed out and route to sign-in — never loop silently.
- **No rate limiting or abuse controls in scope** (rooms cap at ~100; all events require a Google-authenticated token). Revisit only if abuse is observed in production.
- Every client→server event acks `{ ok: true, ...data }` or `{ error: ErrorCode }`.
- After every state mutation, and on (re)join, the server broadcasts a role-filtered `session:state` snapshot to the room. No granular diff events exist.
- There is **no leave event**. "Leave session" / "Done" in the UI is client navigation; Membership is permanent. A member who leaves for good can therefore hold up everyone-voted auto-completion — the host's `voting:close` is the escape hatch.
- **The host is a member**: counted in `participants.count` and against `cap`. `hostParticipates` affects only the submit/vote denominators, never seating.
- **Shared contract module**: the types and constants here (ErrorCode, SessionState, enum lists, suppression N, consensus thresholds) live in ONE shared module created by the walking skeleton; server and client both import it — no hand-duplication.

```ts
type ErrorCode =
  | 'profile-required'   // no profile yet — complete profile:set first
  | 'not-found'          // join code, session id, or solution id doesn't resolve
  | 'session-full'       // cap reached
  | 'voting-started'     // new joins locked once phase = voting
  | 'not-host'           // host-only event from a participant
  | 'bad-phase'          // event not legal in current phase (see matrix)
  | 'not-participant'    // host with hostParticipates=false tried to submit/vote
  | 'already-submitted'  // second solution in crowdsourced
  | 'duplicate-ballot'   // second ballot
  | 'incomplete-ballot'  // scores don't cover the exact current deck
  | 'empty-deck'         // voting:start with no solutions
  | 'invalid-input';     // malformed payload (bad enum, score out of 0–100,
                         //   empty or >300-char solution text, cap outside 2–100,
                         //   empty or >500-char problem statement)
```

## Client → Server

```ts
'profile:set'      { department, role, tenure }   // app-shipped enums (values pending the
                                                  // client's lists — issue #25; pin them HERE
                                                  // when decided). Upsert — callable
                                                  // any time; the NEXT ballot snapshots
                                                  // the new values (past reports unchanged)
'profile:get'      {} → ack { displayName,
                              profile: { department, role, tenure } | null }
                                                  // EXEMPT from the profile-required gate —
                                                  // it's how the client detects first-time
                                                  // users and prefills Edit profile
'session:create'   { problem, workflow: 'crowdsourced' | 'preset',
                     cap?: number,                // default 8, min 2, max 100
                     hostParticipates: boolean }
                   → ack { sessionId, joinCode }
'session:preview'  { joinCode }                   // read-only lookup BEFORE joining — no membership
                   → ack { problem, workflow, phase, participants: { count, cap },
                           isMember: boolean }    // true → client offers REJOIN (full/voting-
                                                  // started blocks apply to new joiners only)
                   // resolves the same sessions a code join would (phase != results);
                   // client uses phase/count to render found / full / voting-started screens
'session:join'     { joinCode } | { sessionId }
                   // joinCode → resolves only sessions not in results (codes recycle at
                   //   results — never a rejoin key there). A NEW joiner is admitted subject
                   //   to cap/phase gates; an EXISTING member is idempotently REJOINED —
                   //   legal even during voting (lost-device recovery; cap/phase gates
                   //   don't apply to members)
                   // sessionId → REJOIN of an existing member, legal in ANY phase,
                   //   returns the current snapshot; clients store sessionId from the ack.
                   //   A NON-member's sessionId join acks `not-found` even when the id
                   //   resolves — don't leak session existence
'curation:start'   {}                             // host, crowdsourced: lobby → curation;
                                                  // closes further submissions. Legal with
                                                  // ZERO solutions — the host recovers via
                                                  // solution:add in curation; empty-deck
                                                  // gates only voting:start. (Mock 06's "at
                                                  // least one Solution" copy refers to
                                                  // starting the VOTE, not curation)
'solution:submit'  { text }                       // crowdsourced participant, lobby only, once
'solution:add'     { text }                       // host — preset: lobby; crowdsourced:
                                                  // curation (recovers an emptied deck; the
                                                  // mock's "Add at least one Solution" copy)
'solution:edit'    { solutionId, text }           // host: ANY row — preset lobby rows,
                                                  // crowdsourced curation rows (originals
                                                  // and combined alike; matches the mock)
'solution:delete'  { solutionId }                 // host; hard delete
'solution:combine' { solutionIds: string[], text?: string } → ack { solutionId }
                                                  // hard-deletes sources; text defaults to
                                                  // " / " join (client edits it in the modal)
'voting:start'     {}                             // host: preset lobby → voting;
                                                  // crowdsourced curation → voting.
                                                  // DECK IS IMMUTABLE FROM THIS MOMENT.
'ballot:submit'    { scores: Record<SolutionId, number> }  // 0–100 ints; must cover the
                                                  // exact deck; atomic; once per member
'voting:close'     {}                             // host; voting → results with votes in
                                                  // hand — legal with ZERO ballots
```

### Phase × role matrix

| Event | Phase(s) | Who |
|---|---|---|
| `profile:set` / `profile:get` | any (incl. outside sessions) | anyone |
| `session:create` | — | anyone with profile |
| `session:join` (code, new joiner) | lobby, curation | anyone with profile |
| `session:join` (code, existing member) | any phase the code resolves (≠ results) | member |
| `session:preview` | lobby, curation, voting | anyone with profile |
| `session:join` (sessionId rejoin) | any | existing member |
| `solution:submit` | lobby (crowdsourced) | participant¹, once |
| `solution:add` / `edit` / `delete` / `combine` | preset: lobby · crowdsourced: curation | host |
| `curation:start` | lobby (crowdsourced) | host |
| `voting:start` | preset: lobby · crowdsourced: curation | host |
| `ballot:submit` | voting | participant¹, once |
| `voting:close` | voting | host |

¹ "participant" includes the host only when `hostParticipates` is true (else `not-participant`).

## Server → Client

```ts
'session:state'    SessionState

type SessionState = {
  sessionId: string;
  joinCode?: string;   // absent at results — the code recycles; never render it there
  problem: string;
  workflow: 'crowdsourced' | 'preset';
  phase: 'lobby' | 'curation' | 'voting' | 'results';
  participants: { count: number; cap: number };
  isHost: boolean; hostParticipates: boolean;
  me: { submitted: boolean; voted: boolean;
        submissionText?: string };  // the member's OWN crowdsourced submission, echoed back
                                    // (mock 05's "Your submission is saved" panel; lost-device
                                    // rejoin needs it server-side) — never anyone else's.
                                    // Read from the membership's immutable snapshot, so it
                                    // SURVIVES the host combining/deleting the deck row
  submissions?: { submitted: number; total: number }; // crowdsourced lobby/curation; counts
                                                      // only. total = currently joined COUNTED
                                                      // participants (a hostParticipates=false
                                                      // host is excluded), NOT the cap
  deck?: { id: string; text: string; combined: boolean }[];   // NO authors, ever. Served in
                                                              // INSERTION order (created_at),
                                                              // stable across snapshots and
                                                              // rejoins. `combined` is a seam-
                                                              // test observable — no UI is
                                                              // required to render it
  votingProgress?: { voted: number; total: number };  // total = counted participants
                                                      // (hostParticipates-aware)
  roster?: { displayName: string; voted: boolean }[];         // HOST ONLY, voting phase —
                                                              // who has finished; never scores.
                                                              // COUNTED participants only (a
                                                              // hostParticipates=false host is
                                                              // not listed)
  results?: { ranked: { solutionId: string; text: string; avg: number | null }[] };
                                                      // avg null only on zero-ballot results
                                                      // ranked by UNROUNDED mean, ties broken
                                                      // by solutionId ascending — one rule for
                                                      // socket results, report, and CSV alike;
                                                      // served avg is an integer (round-half-
                                                      // up) — same everywhere averages appear
}
```

### Field visibility

| Field | Host | Participant |
|---|---|---|
| `deck` | lobby/curation onward | voting and results only (in-progress curation is host business) |
| `submissions` | crowdsourced lobby + curation | same (feeds the waiting screen) |
| `votingProgress` | voting | voting |
| `roster` | voting | never |
| `results` | results | results |
| everything else | always | always |

**Zero-ballot results.** A voting phase whose counted total is 0 never auto-completes — the
host's `voting:close` is the only exit, and closing before any ballot lands is always legal.
Zero-ballot results/reports serve `avg`/`p25`/`p75` as `null` with deck order preserved
(clients render "—"); the heatmap has no cohorts and whole-room rows carry `n: 0`.

## HTTP (host-only; `Authorization: Bearer <token>`)

Non-host requests (participants, strangers, unknown ids) get **404** across all three
endpoints — one status, no existence leak (mirrors the socket seam's `not-found` rule).

```
GET /api/sessions                 → ALL sessions of the authenticated host, live and completed:
                                    [{ id, problem, workflow, phase,
                                       joinCode?,                    // only while phase != results
                                       participants: number, cap, createdAt, closedAt? }]
                                    // newest first (createdAt desc); a valid token with no
                                    // hosted sessions gets 200 [] — the 404 rule guards ids
GET /api/sessions/:id/report      → requires phase = results — 409 for a live session
                                    { session: { problem, workflow, participants, closedAt },
                                      // participants = MEMBER count (exceeds ballot count
                                      // after an early close)
                                      solutions: [{ id, text, avg, p25, p75 }],
                                      // served in RANKED order (unrounded mean) — identical
                                      // to results.ranked; clients render rank = index + 1
                                      heatmap: { [dimension]: { [cohort]:
                                        { n: number,                 // cohort ballot count, always shown
                                          cells: { [solutionId]: number | 'suppressed' } } } } }
GET /api/sessions/:id/report.csv  → fixed header: solution_text, dimension, cohort,
                                      n_voters, avg, p25, p75
                                    one row per (solution × dimension × cohort), rows in
                                    ranked order; avg = number or the literal SUPPRESSED;
                                    p25/p75 filled on whole-room rows (dimension = 'all',
                                    cohort = 'all') and empty on cohort rows; n_voters always
                                    filled; zero-ballot cells are empty strings (the "—" is
                                    a UI rendering, never in the file)
```

**Spread = middle-50% range.** `p25`/`p75` are nearest-rank percentiles of that solution's ballot
scores (integers). The consensus badge is client-derived from width `w = p75 − p25`:
`w ≤ 30` strong consensus · `30 < w < 50` mixed · `w ≥ 50` polarised.

² Cohort `n` is shown even for suppressed cells — it reveals attendance, never scores; only
score values are suppressed.

The `.csv` endpoint authenticates by bearer header like the rest — a plain `<a href>` can't
send one, so clients download via authenticated fetch → blob. Both report endpoints require
`phase = results` (mock 02's "Open report" on a Live row is a mock error — history links reports
for completed sessions only).

## Demographic enums (provisional — swap when #25 resolves)

Placeholder lists so nothing blocks on the client's answer; **one shared constant**, referenced
by the profile form, server validation, and heatmap alike. Swapping values later is a one-file
change and a migration, nothing more.

- `department`: Product · Engineering · Sales · Marketing · Operations · Other
- `role`: Individual Contributor · Team Lead · Manager · Director · Executive
- `tenure`: <1 year · 1–2 years · 2–5 years · 5–10 years · 10+ years

**Suppression scope:** demographic cohort cells with fewer than N (=3) ballots only. Whole-room aggregates — the ranked list, overall avg and spread — are always shown regardless of room size.
