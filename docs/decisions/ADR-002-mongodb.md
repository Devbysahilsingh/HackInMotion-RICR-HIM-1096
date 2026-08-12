# ADR-002 · MongoDB (Atlas M0)
**Status:** Accepted · 2026-08-12
**Context:** entities include a document-shaped crop registry/KB, append-only caches, per-user trees; 72h iteration speed; zero cost.
**Decision:** MongoDB via Mongoose; Atlas M0 free.
**Alternatives:** Postgres (Neon/Supabase free) — stronger relational integrity, but our joins are shallow (denormalized userId), registry/KB is naturally documental, and team+Claude velocity is higher on Mongo; Supabase bundled-auth rejected (we implement auth deliberately for depth).
**Trade-offs:** no server-side transactions used (single-doc writes + idempotent jobs designed around it); M0 512MB (size budget doc).
