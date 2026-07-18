# Database Schema

Postgres (Supabase). Only the room-engine server touches these tables, via the service role — see ADR-0003. Ballots link to voters but individual scores are never served to any client — see ADR-0002. Vocabulary per `CONTEXT.md`.

```
profiles                          -- 1:1 with Supabase auth.users
  id            uuid PK → auth.users
  display_name  text               -- from Google account
  department    enum (app-defined list)
  role          enum
  tenure        enum

sessions
  id            uuid PK
  host_id       uuid → profiles
  problem       text
  workflow      enum ('crowdsourced' | 'preset')
  phase         enum ('lobby' | 'curation' | 'voting' | 'results')
  cap           int  (default 8, ≤ 100)
  host_participates  bool
  join_code     char(6)            -- partial UNIQUE index WHERE phase != 'results'
  created_at / closed_at

memberships
  session_id → sessions, user_id → profiles   (PK: both)
  submitted     bool
  voted         bool
  joined_at

solutions
  id            uuid PK
  session_id  → sessions
  text          text
  submitted_by  uuid → profiles, NULL for combined rows AND all preset-workflow rows
                UNIQUE (session_id, submitted_by)  -- one-per-participant; bites only
                                                   -- crowdsourced originals (NULLs exempt)
                -- hard delete on curation: the table IS the deck

ballots                            -- one per voter per session
  id            uuid PK
  session_id  → sessions
  user_id     → profiles           -- linked, never displayed (ADR-0002)
  department / role / tenure       -- snapshot at submission; reports read THESE
  submitted_at
  UNIQUE (session_id, user_id)

ballot_scores
  ballot_id   → ballots
  solution_id → solutions
  score         int CHECK 0–100    (PK: ballot_id + solution_id)
```

## Decisions baked in

- **Demographic enums are app-shipped fixed lists** (dropdowns). Free text would fragment heatmap cohorts and break suppression counting. Changing a list is a migration; host-defined lists are out of scope (ADR-0001).
- **Ballots snapshot demographics at submission.** Reports are historical facts — profile edits and re-orgs never rewrite an old report, and suppression counts can't drift below N later.
- **Reports are computed on read** from ballot rows — no report table. Snapshots make results stable forever; a suppression fix reaches past reports.
- **Ballots are atomic.** One row + full deck of scores accepted in a single submission, or nothing. No partial vote state exists; a mid-swipe refresh restarts the deck.
- **Join codes recycle.** Unique only among sessions not yet in `results` (partial unique index); 6-digit space never depletes.
- **Curation hard-deletes.** Delete removes the row; combine deletes sources and inserts one new row (`submitted_by` NULL, host-editable text). No status filtering anywhere.
- **Live-room rehydration needs no extra tables.** Phase lives on the session; solutions/memberships/ballots are already persisted. Socket presence is in-memory only.
