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

Live at **https://group-decision-45846577542.australia-southeast1.run.app** — Cloud Run service `group-decision` (GCP project `group-decision-app`, region `australia-southeast1`, max 1 instance + session affinity for Socket.IO), backed by Supabase project `group-decision` (`dqdelrwrbjzprtwbttwj`, Sydney). Migrations in `migrations/` are applied automatically at server boot.

> **History:** the service originally lived in GCP project `mypickle-486702` — that project's billing was cut by its own budget killswitch (Jul 2026) and stays dead. Everything now runs in `group-decision-app`; ignore any `mypickle` references you find in GCP.

CI deploys on every push to `main` (`.github/workflows/deploy.yml`), authenticated via repo secret `GCP_SA_KEY` as `github-deployer@mypickle-486702.iam.gserviceaccount.com` — the SA lives in the dead project (identities aren't billing-gated) and has deploy roles granted on `group-decision-app`.

### Outage runbook

Three links in the chain can independently take the site down. Diagnose with:

```sh
# 1. Is it up? (503 = container failing at boot; check the crash log)
curl -s -o /dev/null -w "%{http_code}\n" https://group-decision-45846577542.australia-southeast1.run.app/
gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="group-decision"' \
  --project=group-decision-app --freshness=1d --limit=20

# 2. Supabase paused? Free tier auto-pauses after ~1 week idle; boot then dies with
#    "tenant/user postgres.dqdelrwrbjzprtwbttwj not found". INACTIVE = paused; restore takes ~3 min.
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" https://api.supabase.com/v1/projects | jq -r '.[] | select(.id=="dqdelrwrbjzprtwbttwj") | .status'
curl -s -X POST -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" https://api.supabase.com/v1/projects/dqdelrwrbjzprtwbttwj/restore

# 3. GCP billing cut? A $10 AUD/month budget feeds the billing-killswitch Cloud Function,
#    which unlinks billing at 100% (Cloud Run then 503s with "billing is disabled" in the logs).
gcloud billing projects describe group-decision-app          # billingEnabled: false = killswitch fired
gcloud logging read 'resource.labels.service_name="billing-killswitch"' --project=group-decision-app --limit=6
```

Google sign-in bouncing users to a dead URL after auth means the Supabase auth `site_url` is stale — check `GET/PATCH https://api.supabase.com/v1/projects/dqdelrwrbjzprtwbttwj/config/auth`.

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
gcloud run deploy group-decision --source . --project=group-decision-app --region=australia-southeast1
```

Auth chain: Google OAuth client `group-decision` (Google Auth Platform in `mypickle-486702`, published to production) → Supabase Google provider → Supabase Site URL points at the Cloud Run URL. Postgres has RLS enabled on all tables with no policies: clients never touch the Data API; the server connects directly as table owner.

## Checks

```sh
npm run typecheck
npm test             # seam tests (embedded Postgres; first run downloads binaries)
```
