# ADR-004 · Registry-driven crops with support tiers
**Status:** Accepted · 2026-08-12
**Context:** deep support for 9 priority crops must not become a product ceiling; farmer-centric requirement.
**Decision:** `cropRegistry` documents carry ALL crop knowledge (agronomy, diseases, fertilizer, market mapping, ML support) + supportLevel ∈ {SPECIALIZED, GENERAL, LIMITED, UNSUPPORTED}; engines read registry only; **crop-name conditionals in code are banned**.
**Alternatives:** hardcoded crop modules (faster day-1, rewrite-per-crop forever); config files without tiers (dishonest uniform claims).
**Reason:** extensibility without code changes; honesty about coverage becomes structural.
**Trade-offs:** registry seed authoring effort up front (sourced data — also our KB anyway).
