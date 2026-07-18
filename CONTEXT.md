# Group Decision

A real-time web app where a host runs a session in which participants score candidate solutions to a problem with 0–100 confidence votes, producing a ranked outcome and an anonymised report.

## Language

### People

**Host**:
The authenticated user who creates and drives a session: curates the deck, starts and closes voting, and receives the report.
_Avoid_: Admin, facilitator, owner

**Participant**:
An authenticated user who has joined a session. The host may also be a participant (per-session choice).
_Avoid_: User, voter, member

**Profile**:
The demographic attributes a user sets on first sign-in — department, role, tenure bracket. The report's slicing dimensions.
_Avoid_: Login details, demographics form

### Session

**Session**:
One live run of a workflow, from creation to report. Joinable by join code, persisted, owned by its host.
_Avoid_: Room, meeting

**Join code**:
The 6-digit code participants enter to join a session.
_Avoid_: Room code, session code, PIN

**Workflow**:
Which of the two session shapes a host picked at creation: Crowdsourced (participants submit solutions, host curates, all vote) or Preset (host supplies the solutions, participants only vote).
_Avoid_: Meeting type, mode

**Phase**:
The session's current stage: joining/submission → curation (Crowdsourced only) → voting → results. Transitions are host-driven except voting completion, which can also auto-complete.

### Solutions & curation

**Solution**:
One candidate answer to the session's problem. Anonymous — authorship is never displayed. In Crowdsourced, each participant submits exactly one.
_Avoid_: Answer, idea, option, card

**Deck**:
The final list of solutions put to a vote, after curation.

**Combine**:
Host curation action merging selected solutions into one, with host-editable merged text.
_Avoid_: Merge, group, cluster

### Voting & results

**Confidence score**:
A participant's 0–100 rating of one solution, cast via the swipe interface (or manual buttons). Every participant scores every solution in the deck.
_Avoid_: Vote value, rating, points

**Close voting**:
The host action ending the voting phase early with whatever scores are in. Voting otherwise auto-completes when every participant has scored the full deck.

**Ranked list**:
The end-of-session output all participants see: solutions ordered by average confidence score, winner highlighted.
_Avoid_: Results, leaderboard

**Report**:
The host-only output: per-solution averages and spread (consensus indicator), the demographic heatmap, and CSV export. Always suppression-filtered.
_Avoid_: Dashboard, analytics

**Suppression**:
The anonymity rule: individual scores are never displayed, and any report cell aggregating fewer than N participants shows "too few to display" instead of a value.
_Avoid_: k-anonymity (the PRD's heavier scheme — not built)
