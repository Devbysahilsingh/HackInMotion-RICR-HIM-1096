# ADR-008 · DB-first serving + validate-then-cache resilience
**Status:** Accepted · 2026-08-12
**Decision:** clients read only our DB; jobs ingest external data with validation before caching; failures never overwrite last-known-good; freshness labeled in UI; fallback chains per dependency; kill-switch/failure-injection flags (non-prod).
**Alternatives:** request-time external calls (latency, quota, demo fragility); fake "demo mode" (rejected — dishonest and explicitly banned by team).
**Reason:** no single external point of failure; demo resilience is a real feature.
**Trade-offs:** data staleness bounded by job cadence (labeled, acceptable for farming decision timescales).
