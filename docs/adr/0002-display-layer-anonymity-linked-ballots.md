# Anonymity is a display-layer rule; ballots link to voters

Ballot rows store the voter's `user_id` (and solutions store `submitted_by`), but no individual scores or authorship are ever returned to any client — anonymity is enforced in the one server code path that serves report and session data, not by the schema. We considered unlinkable ballots (demographic snapshot only, once-only enforced by a membership flag), which would make the spec's "nobody can ever see my scores" true at rest, and rejected it to keep vote-editing, moderation, and audit options open without a schema migration.

Consequences: a database dump *can* reconstruct who voted what, so DB access is the trust boundary (see ADR-0003), and the anonymity promise to participants is "the system never shows it", not "the system cannot know it". Do not add any query path that returns per-user scores; do not "strengthen" this to unlinkable ballots without a fresh decision — features may by then depend on the link.
