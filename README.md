# Draft1 — Group Decision

Real-time anonymous confidence voting. Docs: `docs/SPEC.md`, `docs/CONTRACTS.md`, `docs/SCHEMA.md`; domain vocabulary in `CONTEXT.md`.

## Local development

Two terminals, zero configuration, **no production credentials**:

```sh
npm run dev:server   # room engine on :3001 — embedded Postgres (.dev-pg/) + dev-token auth
npm run dev          # vite on :5173, proxies /socket.io to :3001
```

Auth in dev is **dev-token mode**, mirroring the seam-test stub (`docs/SPEC.md` "Stubbed boundary"): the sign-in screen asks for a name and the socket handshakes with `dev:<name>`, which `src/server/dev-auth.ts` maps to a stable fake identity. Supabase is never contacted.

### Real Google sign-in

Point the client at a **dev** Supabase project (Google provider enabled) — never production keys:

```sh
VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... npm run dev
```

and run the server against the same project: `DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm start`.

## Production build

`npm run build` emits the client to `dist/`; `npm start` serves it from the room-engine port when it exists (same origin, no proxy).

## Production deployment

Live at **https://group-decision-906739236728.australia-southeast1.run.app** — Cloud Run service `group-decision` (GCP project `mypickle-486702`, region `australia-southeast1`, max 1 instance + session affinity for Socket.IO), backed by Supabase project `group-decision` (`dqdelrwrbjzprtwbttwj`, Sydney). Migrations in `migrations/` are applied automatically at server boot.

Server environment (set on the Cloud Run service — **never committed**):

| Variable | Source |
|---|---|
| `SUPABASE_URL` | plain env var (`https://dqdelrwrbjzprtwbttwj.supabase.co`) |
| `DATABASE_URL` | Secret Manager `gd-database-url` (session pooler, port 5432 — Cloud Run is IPv4-only) |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret Manager `gd-service-role-key` |

Client env (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) is baked into `dist/` at build time; the anon key is public by design.

Redeploy:

```sh
VITE_SUPABASE_URL=https://dqdelrwrbjzprtwbttwj.supabase.co VITE_SUPABASE_ANON_KEY=<anon key> npm run build
gcloud run deploy group-decision --source . --project=mypickle-486702 --region=australia-southeast1
```

Auth chain: Google OAuth client `group-decision` (Google Auth Platform in `mypickle-486702`, published to production) → Supabase Google provider → Supabase Site URL points at the Cloud Run URL. Postgres has RLS enabled on all tables with no policies: clients never touch the Data API; the server connects directly as table owner.

## Checks

```sh
npm run typecheck
npm test             # seam tests (embedded Postgres; first run downloads binaries)
```
