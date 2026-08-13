# Data Validation

Three layers — client (UX only, never trusted), API (Zod, authoritative), Mongoose (last-resort schema + enum guards). ml-service: Pydantic.

## API-layer (Zod) canonical rules
- **users:** email RFC + lowercase-trim; password ≥8 (register only — hash immediately, never logged); language enum; name 2–60 chars trimmed.
- **farms:** state/district from canonical list (`shared/constants/geo`); lat∈[6,37.5], lon∈[68,97.5] (India bounding box) when GPS; sizeValue >0 ≤ 250 acres-equivalent; enums for soil/irrigation.
- **crops:** cropCode must exist in registry (async check); sowingDate within [today−400d, today+180d]; status transitions planned→active→harvested only.
- **health upload:** multipart single file; ≤8MB; MIME sniffed (magic bytes) ∈ {jpeg,png,webp,heic→converted}; pixel bounds ≤ 6000×6000 pre-decode (bomb guard); description ≤500 chars, sanitized.
- **market queries:** commodityCode from registry mappings; district from canonical list; date ranges ≤90d.
- **irrigationLogs:** date ≤ today, ≥ sowingDate; amountMm ∈ (0,200].
- **ids:** all path ids = valid ObjectId (reject before query — prevents cast-error leaks).

## Mongoose safeguards
`strict: true` everywhere; enums mirrored; `runValidators` on updates; sanitize-v5/mongo-sanitize middleware strips `$`-operators from all inputs (NoSQL injection).

## External data validation (before caching — resilience rule "validate then cache")
- Weather payloads: schema-checked (numeric ranges: temp −30..55°C, rain 0..500mm, et0 0..15mm, RH/prob 0..100%, wind 0..300km/h; tMin ≤ tMax; no duplicate IST day); out-of-range → reject the payload **whole**, keep old cache, log. Partial acceptance is worse than rejection — a snapshot half-written from a broken feed still looks authoritative to the irrigation engine (RES-03).
  - Day count is enforced **per source**, not as a flat 14: `open-meteo` 14 (7 past + 7 forecast in one call), `openweathermap` 3. The free OWM endpoint returns forecast only, ~5 days, no history; asserting 14 against it would fail every fallback fetch and break RES-01. See docs/weather/weather-architecture.md.
- Mandi rows: numeric prices >0 <100000 ₹/quintal, modal between min/max (else clamp+flag), date parseable, commodity mapped; unmapped rows dropped with counter.
- Gemini responses: JSON schema parse; diseaseCode ∈ registry else UNKNOWN; strip any unexpected fields.
- ml-service responses: Pydantic-validated {diseaseCode, confidence, top3, modelVersion}.
