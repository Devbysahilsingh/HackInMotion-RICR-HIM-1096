# ADR-001 · MERN + FastAPI ML sidecar
**Status:** Accepted · 2026-08-12
**Context:** 1–2 JS-comfortable devs + Claude executing; custom ML model requirement; 72h.
**Decision:** React web + React Native mobile + Node/Express single backend + MongoDB; separate FastAPI service exclusively for ML inference.
**Alternatives:** pure MERN with JS inference (onnxruntime-node — viable but couples python training→js serving and muddies the ML story); full Python backend (splits team from JS strength); Next.js monolith (weaker separation story, no mobile benefit).
**Reason:** language leverage; runtime isolation for the Python ML stack; key isolation; independent deploy; strong viva narrative.
**Trade-offs:** one extra service to deploy/monitor (accepted; internal-only contract keeps it simple).
