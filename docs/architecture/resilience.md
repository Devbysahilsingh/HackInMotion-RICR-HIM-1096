# Resilience Architecture (LIVE → VALIDATE → CACHE → SERVE)

## Dependency resilience table
| Dependency | Primary | Fallback | Cache/last-known-good | Max stale (label) | Failure UX | Recovery |
|---|---|---|---|---|---|---|
| Weather | Open-Meteo (keyless) | OpenWeatherMap → snapshot | weatherSnapshots, TTL 6h, failures never overwrite | serve indefinitely, ● Cached + age; >48h adds warning | verdicts still render, 'simplified' mode w/o ET₀ | next cron success flips ● Live |
| Market | data.gov.in | cache → seed history | marketPrices append-only | always dated; seed = ● Historical | trends render from history | nightly job |
| Crop-health AI | custom ML | Gemini → OpenRouter → rule engine (local, cannot fail) | image-hash result cache | n/a | tier + label shown; rules tier always answers | per-request |
| Images | Cloudinary | none (dev: local tmp) | — | — | upload retry UX; analysis without stored image blocked with clear message | per-request |
| ml-service host | HF Spaces | DISABLE_ML flag → Gemini tier | — | — | invisible to user (chain) | health-checked |
| MongoDB | Atlas | none (SPOF, accepted & stated) | — | — | 500 envelope + status page honesty | Atlas SLA |
| Backend host | Render + keep-alive ping | — | — | — | cold start ~50s worst case | UptimeRobot q10min during event |

## Mechanics
- **Validate-then-cache:** external payloads schema+range-checked BEFORE persist; invalid → discarded, cache untouched, status:'stale', lastSuccessAt preserved.
- **Timeouts/retry:** 8s (weather/AI) · 15s (market bulk); 1 retry, exponential jitter.
- **Circuit-lite:** 3 consecutive failures/service → skip 10min (in-memory counters; per-instance is fine at our scale).
- **Freshness UX contract:** every data-bearing card: ● Live · ● Cached (Xh ago) · ● Historical · ● Local AI · ● AI-assisted · ● Guided assessment. Cached never masquerades as live (NFR-7).
- **No-auth-bypass rule:** degraded modes change data sources only; authn/authz/rate limits identical in every mode (threat model invariant).

## Failure-injection test plan (Day 3 + demo rehearsal; flags FORCE_FAIL_* non-prod)
12 scenarios × expected behavior: OM down→OWM; both down→cached+stale; market down→cache; ML down→Gemini; Gemini down→rules chain-through; slow API (12s)→timeout→tier; malformed weather payload→reject+keep cache; expired cache+all down→serve stale + warning; Mongo down→honest 500 envelope (no crash loop); mobile airplane-mode matrix; token-expiry offline; recovery flip-back (labels update). Each: expected UX + log assertion documented in docs/testing/resilience-testing.md.

## Demo resilience feature (rehearsed, genuine)
Live toggle FORCE_FAIL_WEATHER on stage → dashboard re-fetch → ● Cached badge appears, verdicts persist → toggle off → ● Live returns. Real engineering, shown honestly.
