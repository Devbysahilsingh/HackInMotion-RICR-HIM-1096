# Functional & Non-Functional Requirements

FR IDs are referenced by `docs/requirements-traceability.md`, the API specs, and the test matrix. Priorities: P0 mandatory · P1 important · P2 polish · P3 future (architecture planned, implementation deferred).

## Auth & Accounts (problem statement §1)
- FR-A1 (P0) Register with name, email, password (policy: ≥8 chars, checked server-side).
- FR-A2 (P0) Login issuing access JWT (30m) + refresh token (7d, rotating).
- FR-A3 (P0) Refresh with rotation + reuse detection (family revocation).
- FR-A4 (P0) Logout revokes refresh token.
- FR-A5 (P0) All farmer data private to the account (ownership enforced server-side on every resource).
- FR-A6 (P0) Login rate limiting + generic auth errors (no account enumeration).
- FR-A7 (P2) Password change. FR-A8 (P3) Email-based recovery (needs mail service — out of zero-cost MVP; documented).

## Farm Profile (§2)
- FR-F1 (P0) Create/edit/delete farms: location (GPS lat/lon or state+district), land size + unit (acre/hectare/bigha), soil type (8 + unknown), irrigation method (canal/borewell/rainfed/drip/sprinkler/unknown).
- FR-F2 (P0) Multiple farms per farmer; multiple crops per farm (current + planned via future sowing date).
- FR-F3 (P0) Profile data drives every engine (personalization contract: ≥3 profile factors per recommendation).
- FR-F4 (P0) Missing-data behavior: explicit degradation notices + prompts, never silent generic output.

## Weather & Irrigation & Risk (§3 — core technical component)
- FR-W1 (P0) 7-day forecast per farm location from Open-Meteo (ET₀, rain sum+probability, Tmin/Tmax, humidity, wind) + 7-day history; OpenWeatherMap fallback; cache-first serving with freshness metadata.
- FR-W2 (P0) Agricultural risk engine: heavy rain, extreme heat, frost/cold, high wind, excess humidity (disease-conducive), dry spell — mapped through crop sensitivity (registry) to LOW/MEDIUM/HIGH/CRITICAL with recommended action.
- FR-I1 (P0) FAO-56 water-balance irrigation engine per crop instance: verdict (IRRIGATE_TODAY / IRRIGATE_IN_N_DAYS / WAIT_RAIN_EXPECTED / NO_IRRIGATION_NEEDED) + mm and liters/acre amount + full why-trace.
- FR-I2 (P1) "I irrigated today" event logging updating the water balance ledger.
- FR-I3 (P0) Degraded mode without ET₀ (rain+temperature heuristics), explicitly labeled.

## Crop Health (§4)
- FR-H1 (P0) Photo upload (web file / mobile camera+gallery) + optional description, validated & re-encoded server-side.
- FR-H2 (P0) Analysis pipeline: custom ML (specialized crops) → confidence gate → Gemini Vision (low-confidence + GENERAL crops) → rule-based symptom engine (always available); source labeled in result.
- FR-H3 (P0) Structured result: diseaseCode, confidence, severity assessment (engine-derived, not model-fabricated), symptoms, what-to-inspect, next steps, prevention, expert-help threshold — all from curated knowledge base, localized.
- FR-H4 (P0) Low confidence never forced; designed "cannot identify" outcome with retake tips + symptom checklist path.
- FR-H5 (P1) Health history timeline per crop.
- FR-H6 (P0) Unsupported crop: honest coverage notice; safe general functionality continues (never fabricate).

## Market (§5)
- FR-M1 (P0) Daily mandi prices for user's crops (data.gov.in → validate → normalize → MongoDB history); serve trends (30-day), momentum signal RISING/FALLING/STABLE + plain-language guidance; always date-labeled.
- FR-M2 (P1) Nearby mandi comparison (same commodity, district/state filter).
- FR-M3 (P0) Fallback: cache → seed historical data (labeled Historical). No price prediction claims.

## Dashboard (§6)
- FR-D1 (P0) Unified feed answering "what do I act on today": items from all engines, prioritized CRITICAL/HIGH/MEDIUM/INFO, color+icon+text coded, acknowledgeable.
- FR-D2 (P0) Per-crop status cards (stage, irrigation verdict, health flag, market signal).
- FR-D3 (P1) Freshness indicators on every data-bearing card.

## Database (§7)
- FR-DB1 (P0) Persist accounts, farms, crops, health logs+analyses, weather cache/history, irrigation recommendations+events, market history, recommendations, audit events. Schemas: docs/database/.

## UI (§8)
- FR-U1 (P0) Responsive web (mobile-first breakpoints) + native Android app; clarity for low digital literacy (≥44px targets, ≤2 taps to verdict, icon+color+text).
- FR-U2 (P0) Full Hindi + English parity across every surface and message (i18n architecture, no hardcoded strings).

## Error Handling (§9)
- FR-E1 (P0) Canonical error codes + localized actionable messages; designed loading/empty/error/offline states on every screen; no blank screens; specific handling for: API/weather/market/ML/Gemini failure, invalid image, upload failure, unsupported crop, missing location/soil, network failure, DB failure, low confidence.

## Challenge capabilities (§10–15 — all planned, none deleted)
- FR-R1 (P1) Crop recommendation engine: rule-based weighted suitability scoring (season, soil, water, agro-zone, market context) → ranked crops + reasons + constraints + risks. No profit/yield promises.
- FR-V1 (P2) Voice: STT (hi-IN/en-IN) for ~6 fixed intents + TTS readout of recommendations, both locales; graceful unsupported-device fallback. (Tech per voice research — docs/voice/.)
- FR-CM1 (P2) Community outbreak alerts: consent-based, district-level aggregation of confirmed health analyses; threshold ≥3 distinct farmers/crop/disease/7 days → advisory to matching farmers; zero reporter PII exposure.
- FR-FE1 (P1) Fertilizer guidance: curated KB (crop × stage × soil context) → nutrient focus, timing, deficiency signs; dosage ranges only with source attribution + soil-test framing; educational labeling. No hallucinated dosages.
- FR-Y1 (P3) Yield estimate: transparent estimator (district historical average × area × documented adjustment factors) with uncertainty range, labeled Estimated; schema+API planned, implemented only post-MVP.
- FR-O1 (P2) Offline-cached reads on mobile (dashboard, weather, market, history, crop info) with age labels; FR-O2 (P3) draft health-observation queue with sync.

## Non-Functional
- NFR-1 Performance: dashboard p95 <800ms (DB-only reads); analysis E2E <15s; mobile cold start <4s.
- NFR-2 Resilience: fully navigable with all external APIs down (last-known-good).
- NFR-3 Security: docs/security DoD on every feature; no backdoors/bypasses of any kind.
- NFR-4 Privacy: minimal collection; community data aggregated to district; images private per account.
- NFR-5 Cost: ₹0 external spend; free tiers only, no credit card.
- NFR-6 Explainability: every recommendation carries machine-readable trace data rendered as "why".
- NFR-7 Honesty: cached/stale/AI-assisted/estimated data always labeled as such.
