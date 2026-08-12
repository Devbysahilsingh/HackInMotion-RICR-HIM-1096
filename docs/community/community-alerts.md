# Community Pest/Disease Outbreak Alerts (FR-CM1 · P2)

## Product definition
Early-warning by aggregation: if several farmers in one district report the same disease on the same crop within a week, nearby farmers growing that crop get an advisory — catching outbreaks before they spread. One farmer's report NEVER alerts anyone (panic prevention).

## Privacy design (non-negotiable invariants)
1. Participation is **opt-in** (`users.communityConsent`, default false, plain-language explanation at toggle).
2. Aggregation unit is **district** — never GPS, never farm, never user.
3. `communityAlerts` documents contain counts only — no userIds, names, images, or free-text from reports (schema-level guarantee: the collection has no PII fields to leak).
4. Advisory recipients see: district, crop, disease, report count, window — nothing else.
5. Consent withdrawal stops future counting; past aggregates are already anonymous counts.

## Mechanics
- Source events: cropHealthLogs where `sharedToCommunity ∧ source∈{ml,gemini} ∧ confidence ≥ τ_community(0.8)` (rules-engine self-reports excluded — too noisy for outbreak signal).
- Aggregation job (6h): group trailing-7-day window by (district, cropCode, diseaseCode); count **distinct farmers** (dupe control: one counted report per farmer+crop+disease+window).
- Thresholds: distinctFarmers ≥3 → INFO advisory; ≥8 → HIGH. Below threshold: nothing exists externally.
- Fan-out: recommendations emitted to consenting users with matching cropCode + farm district: "14 reports of tomato early blight in Nashik district this week — inspect lower leaves for concentric ring spots" (inspection guidance from disease KB).
- Expiry: window passes → active=false; purge 30d.

## False-alarm controls
Distinct-farmer counting; confidence floor; ML/Gemini-only sources; 7-day sliding window (stale reports age out); district granularity (adjacent-district bleed is future work, not silently approximated).

## API / storage
`GET /community/alerts` (docs/api/intelligence.md) · `communityAlerts` + partial index (docs/database/). No write API — aggregation only.

## MVI (72h) vs future
MVI: consent toggle + aggregation job + advisory feed items + alerts list screen (web). Future: map view, severity weighting by confidence, extension-officer verification, adjacent-district radius, seasonal baselines (alert on deviation, not absolute count).

## Testing
Job unit tests: threshold edges (2 vs 3 farmers), dupe collapse, consent filtering, window sliding; privacy test: serialize every API payload and assert zero user-identifying fields; fan-out targeting test (wrong-crop/wrong-district users receive nothing).
