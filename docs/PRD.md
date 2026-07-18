# PRD — Group Decision Platform

Source: "Kog - Audit & Roadmap.pdf" (Limitless Devs, July 2026). Extracted product requirements only; audit findings, pricing, and vendor commentary omitted.

## 1. Overview

A real-time group decision-making web app for corporate feedback sessions. Participants join a live room, submit solutions, and vote via a "Tinder swipe" swipe-to-score interface. The platform's core differentiator is **guaranteed voter anonymity**: no host or admin can ever re-identify an individual's feedback, enforced at the database layer via k-anonymity.

**Users:** Hosts (run sessions, view reports), Participants (submit/vote), Org Admins.
**Scale target:** up to 100 concurrent participants per room, sub-second real-time sync, multi-tenant (isolated per organisation).

## 2. Core UX Flow

1. **Authenticate** — Participant signs in via Supabase Auth: Google sign-in or email Magic Link / One-Time Code. Identity is verified before any room access; display names are never client-asserted. (Enterprise SSO is post-MVP — see §7.)
2. **Join room** — Participant enters a 6-digit room code. The server binds their real-time channel subscription to their authenticated session.
3. **Session runs** — Host drives the room through the phases of one of **three meeting workflow types** (multi-phase state machine: e.g., solution submission → grouping → voting). All participants see phase transitions live.
4. **Submit solutions** — Participants submit free-text solutions. An AI hook (text embeddings) automatically clusters semantically similar submissions, replacing manual host grouping (removes single-host curation bias).
5. **Vote** — Participants score solutions via the swipe-to-score interface (the validated prototype UX). Votes flow: authenticated submission → real-time ingest → vote store.
6. **Report** — Host views results dashboard (heatmap-style reporting). Every data slice passes through the **anonymity guard** before display: cohorts with fewer than k participants (default k = 5) are automatically suppressed or merged into broader groupings — never displayed or discarded silently.

## 3. Functional Requirements

### 3.1 Identity & Access ("Identity Matrix Gate")
- FR-1: Auth via Supabase Auth — Google OAuth ("Sign in with Google") plus email Magic Link / One-Time Code fallback. (Enterprise SSO deferred to post-MVP.)
- FR-2: Every real-time channel subscription must be bound to a verified auth session; the server never trusts client-supplied identity (name, userId).
- FR-3: Email addresses stored hashed only, never plain text.
- FR-4: Multi-tenant isolation — every table scoped to its organisation via row-level security.

### 3.2 Meeting Engine
- FR-5: Rooms joinable via 6-digit room code.
- FR-6: Three distinct meeting workflow types, each a multi-phase pipeline with explicit state-machine phase transitions (no linear hardcoding).
- FR-7: Room state persisted (survives server restart mid-session) and horizontally scalable across instances.
- FR-8: Support ≥100 concurrent participants per room with sub-second state synchronisation.

### 3.3 Voting
- FR-9: Swipe-to-score voting interface (retain prototype interaction pattern).
- FR-10: Votes are the only record linking a user to an opinion; reporting reads only from a pre-aggregated, anonymity-checked layer, never the raw votes table.

### 3.4 AI Processing
- FR-11: Automatic semantic clustering of submitted solutions via text embeddings (each solution stores an embedding vector and cluster id); manual host grouping is eliminated.

### 3.5 Anonymity Engine
- FR-12: k-anonymity guard (configurable, default k < 5 suppressed) evaluated per demographic cohort on every host-facing query, enforced at the database layer (RPC/views), not application code.
- FR-13: Failing cohorts are merged into broader groupings, not dropped.
- FR-14: Append-only anonymity audit log recording every k-anonymity evaluation (session, k value, suppressed count, timestamp).
- FR-15: Demographic dimensions tracked per user: department, tenure bracket, role.

### 3.6 Reporting
- FR-16: Host dashboard with heatmap-style demographic reporting, fed exclusively through the anonymity guard.

### 3.7 Platform
- FR-17: Single responsive web app (desktop + mobile browsers) — no native apps.
- FR-18: Data hosted in the Sydney region; compliant with Australian Privacy Principles.

## 4. Non-Functional Requirements

- End-to-end TypeScript type safety (client, API, shared schema).
- Stateless, horizontally scalable API tier.
- Versioned database migrations; zero hardcoded config (typed environment config).
- ≥70% automated test coverage on business logic and state transitions; CI on every change; staged deploys before each pilot.
- Structured logging with alerting on failure classes.
- Dependencies kept within one minor version of current; vulnerability scanning in CI.

## 5. Data Model (proposed)

`organisations` (sso_provider, k_anonymity_min, region) → `users` (email_hash, department, tenure_bracket, role) → `sessions` (workflow_type, status, host_id) → `rooms` (room_code, phase) → `solutions` (text, embedding_vector, cluster_id) → `votes` (user_id, solution_id, score). Plus append-only `anonymity_audit_log` (session_id, k_value, suppressed_count, evaluated_at). All org-scoped via RLS.

## 6. Scope Options

- **Option A (full):** all 3 meeting workflows + AI clustering + analytics dashboard (~11 weeks).
- **Option B (lean MVP):** workflow 3 only, linear voting engine, no AI clustering, hardcoded demographic privacy blocks (~7 weeks).

## 7. Out of Scope (Phase 2)

- Enterprise SSO (OIDC/SAML per organisation).
- Dynamic tenant controls (custom demographic trackers beyond Department/Tenure).
- Cross-session trend analytics (confidence trajectory over 6-month cycles).
- Subscription metering / Stripe per-seat billing.

## 8. Open Decisions

1. Option A vs Option B for initial build.
2. Whether k < 5 is a sufficient anonymity threshold for small teams.
