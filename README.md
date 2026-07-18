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

## Checks

```sh
npm run typecheck
npm test             # seam tests (embedded Postgres; first run downloads binaries)
```
