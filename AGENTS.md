# Draft1 (group-decision)

Group-decision voting app, pre-implementation: the tree is docs-only (the old prototype lives in git history). The build is fully specified and ticketed — start from `docs/SPEC.md` (spec, canonical copy issue #1), `docs/CONTRACTS.md` (the room-engine seam every ticket implements against), `docs/SCHEMA.md`, and the mocks in `docs/images/`. Stack: TypeScript, Node/Socket.IO room engine + Supabase (Google OAuth, Postgres), React + Vite + Tailwind SPA.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default label vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
