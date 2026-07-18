# Server-only database access; no RLS, no direct client reads

Only the room-engine server touches Postgres, using the Supabase service role. Browser clients use Supabase solely for Google sign-in; every read and write — live session state, host history, reports, CSV export — goes through the server. We deliberately skip the conventional Supabase pattern of row-level security with direct client queries.

Why: the spec pins suppression (and, per ADR-0002, all anonymity) to exactly one enforcement point. RLS + client reads would create a second enforcement path in SQL policies/views, where one mistake exposes individual votes. Consequence: any new client-facing data need gets a server endpoint, never a Supabase table grant — if someone later proposes "just let the client query it with RLS", that is reopening this decision, not filling a gap.
