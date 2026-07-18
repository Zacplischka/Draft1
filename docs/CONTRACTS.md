# Seam Contracts — Room Engine API

The single test seam (see `docs/SPEC.md` Testing Decisions). Every ticket implements against these names and shapes; seam tests connect as fake socket clients and assert only on what's below. Vocabulary per `CONTEXT.md`; anonymity rules per ADR-0002; all data flows through this server per ADR-0003.

## Transport & envelope

- Socket.IO. The handshake carries `{ token }`; the server verifies it via Supabase before any handler runs (the stubbed boundary in tests — test identities are minted **with profiles preattached**). Client-supplied identity is never read.
- Every client→server event acks `{ ok: true, ...data }` or `{ error: ErrorCode }`.
- After every state mutation, and on (re)join, the server broadcasts a role-filtered `session:state` snapshot to the room. No granular diff events exist.

```ts
type ErrorCode =
  | 'profile-required'   // no profile yet — complete profile:set first
  | 'not-found'          // join code or session id doesn't resolve
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
                         //   empty or >300-char solution text, cap outside 2–100)
```

## Client → Server

```ts
'profile:set'      { department, role, tenure }   // app-shipped enums. Upsert — callable
                                                  // any time; the NEXT ballot snapshots
                                                  // the new values (past reports unchanged)
'session:create'   { problem, workflow: 'crowdsourced' | 'preset',
                     cap?: number,                // default 8, min 2, max 100
                     hostParticipates: boolean }
                   → ack { sessionId, joinCode }
'session:preview'  { joinCode }                   // read-only lookup BEFORE joining — no membership
                   → ack { problem, workflow, phase, participants: { count, cap } }
                   // resolves the same sessions a code join would (phase != results);
                   // client uses phase/count to render found / full / voting-started screens
'session:join'     { joinCode } | { sessionId }
                   // joinCode → NEW joins only, resolves only sessions not in results
                   //   (codes recycle at results — never a rejoin key)
                   // sessionId → REJOIN of an existing member, legal in ANY phase,
                   //   returns the current snapshot; clients store sessionId from the ack
'curation:start'   {}                             // host, crowdsourced: lobby → curation;
                                                  // closes further submissions;
                                                  // empty-deck if no solutions yet
'solution:submit'  { text }                       // crowdsourced participant, lobby only, once
'solution:add'     { text }                       // preset host, lobby only
'solution:edit'    { solutionId, text }           // host: preset rows + combined rows
'solution:delete'  { solutionId }                 // host; hard delete
'solution:combine' { solutionIds: string[], text?: string } → ack { solutionId }
                                                  // hard-deletes sources; text defaults to
                                                  // " / " join (client edits it in the modal)
'voting:start'     {}                             // host: preset lobby → voting;
                                                  // crowdsourced curation → voting.
                                                  // DECK IS IMMUTABLE FROM THIS MOMENT.
'ballot:submit'    { scores: Record<SolutionId, number> }  // 0–100 ints; must cover the
                                                  // exact deck; atomic; once per member
'voting:close'     {}                             // host; voting → results with votes in hand
```

### Phase × role matrix

| Event | Phase(s) | Who |
|---|---|---|
| `profile:set` | any (incl. outside sessions) | anyone |
| `session:create` / `session:join` (code) | — / lobby, curation | anyone with profile |
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
  sessionId: string; joinCode: string; problem: string;
  workflow: 'crowdsourced' | 'preset';
  phase: 'lobby' | 'curation' | 'voting' | 'results';
  participants: { count: number; cap: number };
  isHost: boolean; hostParticipates: boolean;
  me: { submitted: boolean; voted: boolean };
  submissions?: { submitted: number; total: number }; // crowdsourced lobby/curation; counts only
  deck?: { id: string; text: string; combined: boolean }[];   // NO authors, ever
  votingProgress?: { voted: number; total: number };
  roster?: { displayName: string; voted: boolean }[];         // HOST ONLY, voting phase —
                                                              // who has finished; never scores
  results?: { ranked: { solutionId: string; text: string; avg: number }[] };
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

## HTTP (host-only; `Authorization: Bearer <token>`)

```
GET /api/sessions                 → ALL sessions of the authenticated host, live and completed:
                                    [{ id, problem, workflow, phase,
                                       joinCode?,                    // only while phase != results
                                       participants: number, cap, createdAt, closedAt? }]
GET /api/sessions/:id/report      → { solutions: [{ id, text, avg, p25, p75 }],
                                      heatmap: { [dimension]: { [cohort]:
                                        { n: number,                 // cohort ballot count, always shown
                                          cells: { [solutionId]: number | 'suppressed' } } } } }
GET /api/sessions/:id/report.csv  → one row per (solution × dimension × cohort):
                                    solution_text, dimension, cohort, avg | SUPPRESSED, n_voters
                                    plus whole-room rows (dimension = 'all', with p25/p75)
```

**Spread = middle-50% range.** `p25`/`p75` are nearest-rank percentiles of that solution's ballot
scores (integers). The consensus badge is client-derived from width `w = p75 − p25`:
`w ≤ 30` strong consensus · `30 < w < 50` mixed · `w ≥ 50` polarised.

² Cohort `n` is shown even for suppressed cells — it reveals attendance, never scores; only
score values are suppressed.

**Suppression scope:** demographic cohort cells with fewer than N (=3) ballots only. Whole-room aggregates — the ranked list, overall avg and spread — are always shown regardless of room size.
