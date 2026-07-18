# Brief-over-PRD scope: build the brief, treat the PRD as reference only

The client's brief, the workflow diagram, and the working prototype define this product's scope. `docs/PRD.md` — extracted from a vendor audit document ("Kog - Audit & Roadmap", Limitless Devs) — describes a much larger product and is consulted only to fill gaps, never to add features.

Concretely, that means deliberate no-s to things the PRD requires:

- **Basic suppression instead of a k-anonymity engine.** Individual votes are never displayed, solutions are unattributed, and report cells aggregating fewer than N participants are suppressed. No DB-layer k-anonymity enforcement, no cohort merging, no anonymity audit log.
- **Two workflows, not three.** Crowdsourced (participants submit solutions) and Preset (host supplies solutions), as in the diagram. The PRD's third workflow type does not exist.
- **No AI clustering.** Host curation (combine with editable merged text, delete) replaces the PRD's embedding-based semantic clustering.
- **No multi-tenancy / org layer.** Sessions belong to individual host accounts; no organisations, RLS-per-tenant, or admin roles.
- **Google sign-in only.** No magic links / OTC, no enterprise SSO.

Why: the PRD is a vendor's expansion of a vague brief, not the client's ask. The prototype "works largely how the client wants it to" and is the ground truth for flow and functionality. Do not "fix" this codebase toward the PRD without a fresh client decision.
