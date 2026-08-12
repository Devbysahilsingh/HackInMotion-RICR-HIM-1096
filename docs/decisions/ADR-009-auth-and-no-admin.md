# ADR-009 · Access+refresh rotation auth; no admin surface; production security in demo
**Status:** Accepted · 2026-08-12
**Decision:** 30min access JWT (memory/SecureStore) + 7d rotating refresh with reuse-detection family revocation; bcrypt 12; ownership-404 authorization; **no admin role/routes exist** (seed scripts instead); demo environment runs identical security config; zero bypass mechanisms of any kind.
**Alternatives:** single 24h JWT (weaker story/blast radius); Firebase Auth (less demonstrable depth, external dependence); admin panel (unneeded surface + hidden-route risk class).
**Trade-offs:** rotation complexity (~4h) — accepted for genuine security depth.
