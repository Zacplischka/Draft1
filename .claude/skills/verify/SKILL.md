---
name: verify
description: Build/launch/drive recipe for verifying Draft1 (Group Decision) changes end-to-end — dev servers, dev-token auth, browser flows.
---

# Verifying Draft1

## Launch (two background processes)

```sh
ENGINE_PORT=3101 npm run dev:server   # room engine + embedded Postgres (.dev-pg/), dev-token auth
ENGINE_PORT=3101 npm run dev          # vite on :5173, proxies /socket.io to the engine
```

- Port 3001 is often held by an unrelated process on this machine — always set `ENGINE_PORT` on BOTH commands (vite bakes the proxy target from env at startup; editing vite.config triggers a restart that loses the env).
- Engine log line to wait for: `dev room engine on :<port>`. "database draft1_dev already exists" ERROR in the pg log is normal on re-runs.
- Kill with the PID from `lsof -tnP -iTCP:<port> -sTCP:LISTEN` — the engine's SIGTERM handler stops embedded Postgres cleanly.

## Drive (browser at http://localhost:5173)

Dev sign-in is a name field (dev-token mode `dev:<name>` — same name = same identity, so a fresh name gives a first-time user). Flows worth driving:

- fresh name → first-time profile form → Save → home
- reload → returning user lands straight on home
- account chip (top right) → Edit profile (prefilled) / Sign out
- kill + restart the engine under a live tab → socket auto-reconnects, lands back on home

## Gotchas

- Clicks right after a page reload race the socket connect — screenshot first, then click.
- `resize_window` doesn't take effect on this machine's Chrome (fullscreen/managed window); responsive checks need another approach.
