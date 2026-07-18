# Spec: Group Decision rebuild — Google auth, two workflows, confidence voting, anonymised reporting

Published as [issue #1](https://github.com/zac-plischka_xephyr/Draft1/issues/1) (`ready-for-agent`) — the issue is canonical; this copy is for in-repo reading.

## Problem Statement

Teams need to choose between candidate solutions to a problem, but open discussion is distorted by hierarchy, loud voices, and the fear of being seen backing the "wrong" idea. A host running a feedback session has no fast way to get every person's honest confidence in each option, see where consensus actually sits, or slice the result by who-in-the-org thinks what — without exposing any individual's view.

A local prototype has validated the core UX (join a session by code, swipe each solution to score it 0–100, see a ranked outcome) and "works largely how the client wants it to" — but it has no authentication, no persistence, one hardcoded workflow, and throwaway code. It cannot be deployed or trusted.

## Solution

Rebuild the prototype as a deployable, typed web app. Hosts sign in with Google, create a Session in one of two Workflows, and share a 6-digit Join code. Participants sign in with Google, complete a one-time Profile (department, role, tenure bracket), join, and — depending on Workflow — submit one anonymous Solution each and/or score every Solution in the Deck with a 0–100 Confidence score via the prototype's swipe interface. When voting completes (everyone voted, or the Host closes it), all Participants see the Ranked list and the Host additionally gets the Report: averages with spread, a demographic heatmap, and CSV export — all Suppression-filtered so no individual's votes are ever recoverable. Sessions persist; Hosts have a history of past Sessions and Reports.

## User Stories

### Identity & profile

1. As a host, I want to sign in with my Google account, so that I can create sessions tied to a durable identity.
2. As a participant, I want to sign in with my Google account, so that my session membership survives refreshes and drops.
3. As a new user, I want to fill in a short profile (department, role, tenure bracket) on first sign-in, so that reports can be sliced by these dimensions.
4. As a returning user, I want to edit my profile later, so that a promotion or team change is reflected in future reports.
5. As a user, I want my display name taken from my Google account, so that I don't invent a name each session.

### Session creation (host)

6. As a host, I want to create a session by entering a problem statement, so that the group has a single question to answer.
7. As a host, I want to choose the workflow at creation — Crowdsourced or Preset — so that the session matches how prepared I am.
8. As a host, I want to set a participant cap (default 8, up to 100), so that the session stays the size I planned for.
9. As a host, I want to choose per session whether I also participate (submit and vote), so that I can be a neutral facilitator or a full member as the situation demands.
10. As a host, I want a 6-digit join code generated for my session, so that I can read it out loud in a meeting.
11. As a host, I want to see the live participant count against the cap while people join, so that I know when to begin.

### Joining (participant)

12. As a participant, I want to join a session by entering its 6-digit join code, so that getting in takes seconds.
13. As a participant, I want to see the problem statement immediately on joining, so that I can start thinking.
14. As a participant, I want a clear error when the code is wrong, the session is full, or voting has already started, so that I know why I can't get in.
15. As a participant who refreshes or loses connection, I want to resume exactly where I was (submission intact, remaining cards to swipe), so that a dropped connection doesn't erase my input.
16. As a late arriver, I want to be admitted any time before voting starts, so that being a few minutes behind doesn't lock me out of the meeting.

### Crowdsourced workflow — submission & curation

17. As a participant in a Crowdsourced session, I want to submit exactly one free-text solution, so that I commit to my best idea and the deck stays swipeable.
18. As a participant, I want my solution to be anonymous to everyone including the host, so that I can propose bold ideas without signing them.
19. As a participant who has submitted, I want to see a waiting state with session progress, so that I know the session hasn't stalled.
20. As a host, I want to watch solutions arrive live, so that I can start curating as soon as submissions slow down.
21. As a host, I want to combine selected solutions into one, so that duplicates don't split the vote.
22. As a host, I want to edit the text of a combined solution, so that the deck reads as one coherent idea rather than "idea A / idea B".
23. As a host, I want to delete irrelevant solutions, so that junk doesn't dilute the vote.
24. As a host, I want to start voting only when at least one solution exists, so that an empty deck is impossible.

### Preset workflow

25. As a host of a Preset session, I want to enter the solution list myself, so that the group votes on options I've prepared.
26. As a host, I want to add, edit, and remove preset solutions any time before voting starts, so that I can fix a typo or add a late idea while people join.
27. As a participant in a Preset session, I want to skip the submission phase entirely and wait for voting, so that the session matches its purpose.

### Voting

28. As a participant, I want to score each solution in the deck from 0 to 100 by swiping, so that expressing confidence is fast and even fun.
29. As a participant, I want the swipe direction/distance mapped to a visible score with color feedback before I release, so that I know what I'm about to cast.
30. As a participant, I want an optional "edit before submit" mode with a ±1 adjuster, so that I can fine-tune a score the gesture got roughly right.
31. As a participant, I want manual score buttons as a fallback, so that I can vote precisely (or accessibly) without the gesture.
32. As a participant, I want to score every card in the deck exactly once, with my full set submitted atomically, so that partial ballots never exist.
33. As a participant who has finished, I want to see live progress (4 of 7 voted), so that I know what the room is waiting on.
34. As a host, I want voting to complete automatically the moment every participant has voted, so that nobody waits on an already-finished room.
35. As a host, I want a Close-voting control that ends the phase with whatever votes are in, so that one distracted participant can't hold the session hostage.

### Results & report

36. As a participant, I want to see the ranked list — every solution ordered by average confidence score with the winner highlighted — so that the group decision is immediately visible.
37. As a host, I want everything participants see plus a report, so that I can analyse the result beyond the ranking.
38. As a host, I want each solution's average shown with its spread, so that I can tell genuine consensus from a polarised 50/50 split hiding behind the same mean.
39. As a host, I want a heatmap of solutions × department/role/tenure showing average scores per cohort, so that I can see where in the org support and resistance live.
40. As a host, I want report cells covering fewer than N participants to show "too few to display" rather than a value, so that small cohorts can't be re-identified.
41. As a host, I want to export the report's aggregate data as CSV, so that I can drop it into slides or a spreadsheet.
42. As a participant, I want certainty that nobody — host included — can ever see my individual scores, so that I vote honestly.

### Lifecycle & history

43. As a host, I want my sessions and their reports saved to my account, so that the outcome outlives the meeting.
44. As a host, I want to browse my past sessions and reopen any report, so that I can revisit a decision months later.
45. As a host, I want a live session to survive a server restart, so that an infrastructure blip doesn't kill a meeting in progress.
46. As a user, I want the app to work well in desktop and mobile browsers, so that people can vote on whatever device is in front of them.

## Implementation Decisions

- **Scope authority is ADR-0001 (Brief-over-PRD):** two Workflows not three, basic Suppression not a k-anonymity engine, no AI clustering, no multi-tenancy, Google sign-in only. Do not drift toward `docs/PRD.md`.
- **Stack:** full TypeScript rebuild. Supabase provides Google OAuth and Postgres. A Node/Socket.IO server is the single authoritative room engine — all session state transitions, validation, and gating happen server-side; clients only render and emit intents.
- **Auth binding:** every socket connection presents a Supabase access token, verified server-side before any room access. The server never trusts client-supplied identity. Display name comes from the Google account.
- **Session state machine:** Phases are `lobby` (joining + submission/preset-editing) → `curation` (Crowdsourced only) → `voting` → `results`. Transitions are host-driven, except voting → results which also fires automatically when the last participant votes. New joins allowed only before `voting`; rejoins of existing members allowed in any phase.
- **Persistence:** session state written to Postgres so a live room can be rehydrated after server restart; final Report persisted to the host's account. Host history reads from Postgres.
- **Data model (shape, not migration):** users (google id, display name, profile: department/role/tenure) → sessions (host, problem, workflow, cap, host-participates flag, phase, join code) → solutions (text, combined-from lineage optional) → scores (participant × solution, 0–100). Reports are computed from scores at read time (or materialised on session close) and always pass through the suppression filter.
- **Anonymity:** solutions store no displayed authorship; scores are never returned to any client individually; every report aggregation suppresses cells with fewer than N participants (N configurable, default 3). Enforcement lives in the one code path that serves report data.
- **Ballot atomicity:** a participant's scores for the full deck are submitted as one message and accepted only if every deck card is covered and the participant hasn't already voted.
- **Join code:** 6 digits, unique among active sessions.
- **Swipe interface:** the prototype's interaction (angle-to-score mapping, threshold ring, score flash, edit-before-submit modal, manual buttons) is the UX reference to reimplement, not code to port.
- **Combined solutions:** combining removes the source solutions from the deck and inserts one new solution whose text the host can edit; the crude "A / B" join is only the default placeholder text.

## Testing Decisions

- **One seam: the room-engine API.** Tests connect as fake socket clients, drive full sessions end to end (create → join → submit → curate → vote → results/report), and assert only on what real clients receive — emitted events and query responses. No unit tests of engine internals; no assertions on database rows.
- **Stubbed boundary:** Supabase token verification. Tests mint fake identities with chosen profiles (department/role/tenure) to exercise heatmap and suppression scenarios. Google's OAuth flow is never tested.
- **A good test** describes a session story: "5 participants across 2 departments, one drops mid-vote, host closes voting early → ranked list is ordered by average, the 2-person department's heatmap cells are suppressed." Edge cases to cover this way: rejoin mid-phase resumes state, late join blocked after voting starts, duplicate ballot rejected, incomplete ballot rejected, non-host curation rejected, empty-deck voting start rejected, host-participates toggle changes the completion denominator, server restart rehydrates a live session.
- **Not automated:** swipe gesture physics and the Supabase-hosted auth UI — exercised manually.
- **Prior art:** none; the prototype has no tests. This spec's tests are the first and set the pattern.

## Out of Scope

Per ADR-0001: the PRD's third workflow, AI/embedding clustering of solutions, k-anonymity engine with cohort merging and audit log, multi-tenant organisations and RLS-per-tenant, enterprise SSO, magic link / OTC auth, Stripe billing, cross-session trend analytics. Also out: native mobile apps (responsive web only), host-configurable custom profile fields, reordering of the deck by the host, and any participant-facing view of the demographic heatmap.

## Further Notes

- The domain glossary is `CONTEXT.md` at the repo root — use its vocabulary (Session, Deck, Confidence score, Suppression, Crowdsourced/Preset, …) in code, UI copy, and tests. `docs/adr/0001-brief-over-prd-scope.md` records the scope no-s.
- The existing `server.js` + `public/` prototype is a behavioral reference for flow and feel only. It is not a foundation; nothing in it should be assumed correct beyond the UX it demonstrates.
- Room cap default 8, maximum ~100 — no special engineering beyond one Socket.IO room per session.
- Suppression threshold N default 3, kept as a single named constant so the client can tune it.
