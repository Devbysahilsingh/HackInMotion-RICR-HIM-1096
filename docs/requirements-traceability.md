# Requirements Traceability Matrix

Every requirement line of the official problem statement → feature → architecture → API → DB → UI → ML/AI → test → docs → demo. Nothing dropped; challenge items carry priority + minimal-viable path. FR IDs: docs/product/requirements.md · tests: docs/testing/test-matrix.md.

## Must-haves
| Requirement (source §) | FR | Feature/Arch | API | DB | UI (web/mobile) | ML/AI | Testing | Priority | Status |
|---|---|---|---|---|---|---|---|---|---|
| Secure sign-up/login (§1) | FR-A1..A4,A6 | JWT+refresh rotation (docs/security/authentication) | /auth/* | users, refreshTokens, auditLogs | Auth pages/screens | — | ST-01..05 | P0 | **BACKEND DONE (P1-3)** — ST-01..05 green; clients pending Phase 5/6 |
| Data private per account (§1) | FR-A5 | ownership middleware, AU-1..7 | all protected | userId on all owned docs | — | — | ST-10, ST-20 | P0 | **BACKEND DONE (P1-4)** — ST-10 green (matrix from route table); ST-20 needs community data |
| Farm profile: location/size/soil/crops (§2) | FR-F1..F2 | farm+crop domain, registry | /farms*, /crops*, /registry | farms, crops, cropRegistry | Farm/Crop forms both surfaces | — | API+RTL+matrix | P0 | **BACKEND DONE (P1-5/6/7)** — API suites green, registry seeded; UI pending Phase 5/6 |
| Profile drives personalization, no generic advice (§2) | FR-F3..F4 | engines consume ≥3 profile factors; degradation notices | engine endpoints | — | why-traces, nudges | — | engine fixtures (soil changes → verdict changes) | P0 | PLANNED |
| Real weather → irrigation guidance (§3, core) | FR-W1, FR-I1..I3 | Open-Meteo→OWM→cache; FAO-56 engine (docs/irrigation) | /farms/:id/weather, /crops/:id/irrigation(+log) | weatherSnapshots, irrigationLogs | Weather/Irrigation pages+cards | — | FAO vectors, RES-01..03 | P0 | PLANNED |
| Weather risk alerts (rain/frost/heat) (§3) | FR-W2 | risk rules × registry sensitivity | in weather response + feed | recommendations | RiskStrip, feed items | — | per-risk fixtures | P0 | PLANNED |
| API researched+documented (§3) | — | ADR-007; docs/weather, docs/market/data-source; README section | — | — | — | — | — | P0 | DOCUMENTED |
| Photo+description crop observations (§4) | FR-H1 | upload pipeline (docs/security/image-upload) | POST /crop-health/analyze | cropHealthLogs (+Cloudinary) | Scan flows (camera-first mobile) | — | ST-30 | P0 | PLANNED |
| Analyze → flag issues + next-step guidance (§4) | FR-H2..H4, H6 | ML→Gemini→OpenRouter→rules chain; KB guidance | analyze, symptom-check, severity | cropRegistry.diseases | AnalysisResult, SymptomChecklist | **custom EffNet-B0 + Gemini + rule engine** | router matrix, ML battery, adversarial | P0 | PLANNED |
| Approach documented+justified (§4) | — | docs/ml/* (11), docs/ai/* (6), ADR-003/005/006 | — | — | — | — | — | P0 | DOCUMENTED |
| Market price trends for crops (§5) | FR-M1..M3 | data.gov.in→normalize→history→signal (docs/market) | /market/* | marketPrices | Market pages, TrendChart | — | normalizer+signal units, RES-07 | P0 | PLANNED |
| Price source documented (§5) | — | docs/market/data-source; ADR in README | — | — | — | — | — | P0 | DOCUMENTED |
| Unified dashboard, "act on today" (§6) | FR-D1..D3 | feed composer, priorities (docs/irrigation/recommendation-engine) | GET /dashboard, ack | recommendations | Dashboard both surfaces | — | composer tests, E2E | P0 | PLANNED |
| Persistent storage all entities (§7) | FR-DB1 | 14 collections (docs/database) | — | all | — | — | model+index tests | P0 | PLANNED |
| Responsive clean UI, mobile-first, icons/colors (§8) | FR-U1 | web responsive + native app; PriorityChip icon+text | — | — | all screens; accessibility.md | — | RTL, Lighthouse, matrix | P0 | PLANNED |
| Graceful error handling everywhere (§9) | FR-E1 | error standard + QueryBoundary + resilience | error envelope | — | designed states all screens | chain degradation | ST-50, RES matrix, E2E-down | P0 | PLANNED |

## Challenge capabilities (all planned — none deleted)
| Challenge | FR | Approach | API | DB | UI | Priority / MVI | Docs |
|---|---|---|---|---|---|---|---|
| Crop Recommendation Engine | FR-R1 | sourced rule-scoring (ADR-015) | POST /crop-recommendation | cropRegistry fields | wizard (web) | **P1** full MVI | docs/crop-recommendation/ |
| Fertilizer & Resource Planning | FR-FE1 | curated TNAU/PAU/ICAR KB, two-tier, zero generated numbers | GET fertilizer-guidance | cropRegistry.fertilizer | stage cards + disclaimer | **P1** full MVI | docs/fertilizer/ |
| Voice-Based Interface (hi/en) | FR-V1 | device-native STT/TTS + keyword intents (ADR-017) | /voice/transcribe (optional) | none (privacy) | mic + intent buttons + speak-aloud | **P2** MVI: web STT+both TTS+6 intents | docs/voice/ |
| Pest/Disease Community Alerts | FR-CM1 | consent + district aggregation + thresholds (ADR-016) | GET /community/alerts | communityAlerts | advisory cards + feed | **P2** MVI: job+feed+list | docs/community/ |
| Yield Prediction | FR-Y1 | transparent district-avg estimator, cited factors; explicitly not ML | GET yield-estimate (501 until built) | yieldEstimates (reserved) | planned card design | **P3** spec+schema+API contract complete | docs/yield/ |
| Offline-First Support | FR-O1..O2 | cached reads + labels now; write-queue designed | — | client caches | banners/badges | **P2** reads; P3 queue | docs/offline/ |

## Cross-cutting mandates
| Mandate | Trace |
|---|---|
| Hindi+English everywhere | FR-U2 → docs/i18n/* → parity script (blocking) → demo language-switch beat |
| Security first-class, no backdoors | NFR-3 → docs/security/* (9 docs) → ST-01..70 → viva section |
| Resilience, no SPOF | NFR-2 → docs/architecture/resilience → RES-01..12 → live failure demo beat |
| Zero cost | NFR-5 → ADR-011 → README cost section |
| Explainability | NFR-6 → trace contract (R12) → WhyTrace UI → viva FAO walkthrough |
| Honesty (no fabricated data/metrics/labels) | NFR-7 → freshness labels, evaluation artifacts, estimator labeling → throughout |
| Deliverables: repo naming, architecture-diagram.png, api-documentation.md, presentation.pptx, README, live demo, pitch | Phase 9 TODO items + production checklist |

## Implementation status
Status values above are plan-level. **Implemented-and-verified work is tracked in `docs/development/implementation-log.md`.** As of 2026-08-12, P0-3 (development foundation) is complete; it implements no functional requirement by design — it is the platform every FR row is built on — so no row above has moved to IMPLEMENTED yet.

Verification of completeness: every numbered section of the problem statement (§1–9 must-haves, 6 challenges, deliverables list, suggested-stack "research & justify" clauses) appears above. Audit performed 2026-08-12; re-audited at each roadmap checkpoint.
