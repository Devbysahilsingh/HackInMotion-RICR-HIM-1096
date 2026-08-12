# ADR-013 · One API contract for web+mobile; React Native + Expo
**Status:** Accepted · 2026-08-12
**Decision:** mobile consumes the identical /api/v1 contract (no mobile backend, no BFF); mobile framework = React Native + Expo managed (analysis in docs/mobile/technology-decision.md).
**Alternatives:** Flutter (Dart learning cost — disqualifying), RN CLI (native toolchain time-sink), separate mobile endpoints (logic duplication banned by requirement).
**Trade-offs:** Expo managed constraints (STT dev-build caveat — planned decision point); accepted for Expo Go demo path + module ecosystem.
