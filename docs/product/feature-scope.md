# Feature Scope & Prioritization

Rule: nothing from the problem statement is deleted. Features that don't fit the 72h window at full depth get a **minimal viable implementation (MVI)** + documented expansion path. Cut order under time pressure is explicit (bottom).

## P0 — Required for functional submission
| Feature | Scope in 72h | Surface |
|---|---|---|
| Auth + ownership | Full (register/login/refresh-rotation/logout, rate limits) | Web+Mobile |
| Farm & crop management | Full CRUD, registry-driven, support badges | Web+Mobile |
| Weather intelligence | Open-Meteo pipeline + fallback + cache + risk engine | Web+Mobile |
| Irrigation engine | Full FAO-56 water balance + why-trace + degraded mode | Web+Mobile |
| Crop health AI | Full **4-tier** chain (custom ONNX on specialized crops, Gemini, OpenRouter, guided symptom rules) | Web+Mobile (camera-first) |
| Market intelligence | data.gov.in pipeline + trends + signal + fallback | Web+Mobile |
| Unified dashboard | Prioritized action feed + crop cards | Web+Mobile |
| i18n Hindi/English | Full parity | Web+Mobile |
| Error handling & resilience | Canonical codes, designed states, cache-first | All |
| Security baseline | Threat-model controls (validation, authz, uploads, rate limits, secrets) | All |

## P1 — Strong advanced capabilities (build after P0 green)
| Feature | MVI in 72h |
|---|---|
| Crop recommendation engine | Rule-based scoring over curated crop knowledge table; wizard UI (web) |
| Fertilizer guidance | Curated KB for 9 crops, stage-based guidance cards, sourced ranges |
| Irrigation event logging | "I irrigated" button + ledger effect |
| History views | Health timeline + irrigation ledger + price history |
| Explainability traces | Expandable why on all verdicts |
| Freshness indicators | Badge system on all data cards |
| Mandi comparison | Same-commodity nearby-market table |

## P2 — Polish / additional intelligence
| Feature | MVI in 72h (only if P0+P1 stable) |
|---|---|
| Community outbreak alerts | Aggregation job + advisory feed items (no map UI) |
| Voice interface | Web: Web Speech STT+TTS, 6 intents; Mobile: TTS readout only (STT per research verdict) |
| Mobile offline reads | React Query persistence + Cached badges |
| Crop recommendation on mobile | Reuse API, simple list UI |

## P3 — Future expansion (architecture + API contract + schema planned now; no build)
| Feature | Planned artifact |
|---|---|
| Yield estimation | docs/yield/ + `yieldEstimates` schema + `GET /crops/:id/yield-estimate` contract |
| Offline write queue + sync | docs/offline/ design |
| Password recovery, push notifications, iOS, on-device ML, satellite/NDVI, FPO dashboards | future-scope.md |

## Explicit cut order under time pressure (announced, not silent)
1. P2 voice mobile STT → 2. P2 community UI (keep aggregation job) → 3. P1 mandi comparison → 4. P2 offline persistence → 5. P1 crop-recommendation web wizard becomes API-only demo. **Never cut:** P0 rows, security controls, i18n parity on shipped screens, honesty labels.
