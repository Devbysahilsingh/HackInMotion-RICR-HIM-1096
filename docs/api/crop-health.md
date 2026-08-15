# Crop Health API

Shipped in Phase 3 (`backend/src/routes/cropHealth.js`). Conventions in docs/api/error-codes.md apply; only deltas are stated here. `imagePublicId` is `select: false` on the model and is **never** served (AU-5).

| | |
|---|---|
| POST `/crop-health/analyze` | Auth · RL **10/day/user + 3/min burst** · `multipart/form-data` |
Req parts: `image` (file, required, ≤8MB) · `cropId` (24-hex ObjectId, required) · `description?` (≤500 chars) · `shareToCommunity?` (`"true"`\|`"false"` — multipart carries strings, so the field is an enum coerced to boolean). Schema is **strict**: any other field → 422. Format is decided by magic bytes (jpg/png/webp/heic/avif); the client's filename and `Content-Type` are never consulted.
Middleware order is `requireAuth → burst limiter → daily limiter → multer → Zod` — a rate-limited caller is refused before 8MB is buffered, and multipart fields do not exist until multer has run.
Ownership: `cropId` is resolved by a `{_id, userId}` query **and** its farm by a second one (AU-3); either miss → 404.
Pipeline: sanitize (sniff → header bomb guard → decode+re-encode JPEG q85 ≤1600px, EXIF dropped) → **cache lookup** → Cloudinary → tier chain → persist.
→ **201** `{log: <full log>}` on a new analysis · **200** `{log}` with `freshness.status: "cached"` on a cache hit.
Errors: `UPLOAD_ERROR` 400 (reason-classed, below) · 404 (crop or its farm not owned) · 422 (fields) · 429 (either bucket). `ML_ERROR`/`AI_ERROR` are unreachable by construction — the terminal rules tier is local and needs no key, network or quota.

**Full log shape** (`presentLog`, detail form):

```
{ id, cropId, imageUrl, description|null, status, sharedToCommunity, createdAt,
  analysis: { source: 'ml'|'gemini'|'rules'|null,
              sourceLabelKey,            // health.sourceLocalAi | .sourceAiAssisted | .sourceGuided
              diseaseCode,               // registry code or 'UNKNOWN'
              confidence|null, severityAssessment|null, escalated,
              modelVersion|null,
              top3: [{diseaseCode, confidence}],
              escalationPath: [{provider, reason}] },
  recommendation: { titleKey, data: { diseaseCode, source, confidenceKind, confidenceBand,
                                      severity, severityPolicy, escalated,
                                      symptomKeys, inspectKeys, nextStepKeys, preventionKeys,
                                      sourceRefs, aiObservations, imageAssessment,
                                      supportLevel, severityTrace, generatedAt } },
  severityFollowUp: {affectedAreaPct, spreadRate, answeredAt} | null,
  coverageNoticeKey,                     // health.coverageLimited | .coverageUnsupported | null
  freshness: { source, fetchedAt, status: 'live'|'cached' } }
```

Deviation from the global convention: `freshness` sits **on the log object**, not in `meta`. It is present on the detail shape only; the `/logs` summary carries no freshness field.

`recommendation.data` holds i18n **keys** only — no farmer-facing prose crosses the API. `aiObservations` are the model's `visualFindings`, carried under their own attributed field, never blended into guidance. `confidenceKind` is `CALIBRATED` (ml), `BAND` (AI tiers — a fixed number per band, **not** a probability) or `MATCH_SCORE` (rules).

**Cache hit returns 200, not 201.** The cache is keyed on `(userId, cropId, imageHash)` over a 7-day window — never global, because a global cache would let one farmer's analysis answer another's request and would leak that someone else uploaded the same photograph (AU-1). `imageHash` is SHA-256 of the *re-encoded* bytes, so a genuine re-upload is recognised while EXIF-differing shots of one leaf are not forced to collide. On a hit **nothing is created**: the identical photograph for the identical crop is the same observation, and a second row would duplicate the timeline and inflate community counts — so 201 would be a lie. The body says so via `freshness.status: "cached"` rather than making a client infer it from the status code. Recorded in ADR-024.

**Routing by `cropRegistry.supportLevel`** (registry-driven; adding or promoting a crop is a registry change, not a code change):

| supportLevel | Primary tier | Escalation |
|---|---|---|
| SPECIALIZED | ml-service (`X-Service-Key`) | model `uncertain`/down → Gemini → OpenRouter → rules |
| GENERAL | Gemini | OpenRouter → rules |
| LIMITED | **rules + honest notice** (`health.coverageLimited`) | — (terminal) |
| UNSUPPORTED | rules + honest notice (`health.coverageUnsupported`) | — (terminal) |

LIMITED routing resolves a contradiction: this document routed LIMITED to rules while `docs/product/crop-support-matrix.md` says LIMITED gets "Gemini best-effort" — the wire contract wins (clients are written against the API document), and the honest coverage notice is what makes it acceptable rather than a confident-looking AI answer over a KB that cannot support it.

Gemini and OpenRouter are **one tier, two transports**: both report `source: 'gemini'` (the honesty label is "AI-assisted" either way) and the specific transport is recorded in `analysis.provider` (`ml-service` \| `gemini` \| `openrouter` \| `null` for rules).

**Timing.** Each hop gets `min(15s, time left)` against a **35s E2E deadline**. The per-hop ceiling alone cannot honour the budget; a hop with **no budget left is skipped, not started** (recorded as `deadline_exhausted`), which is what guarantees the local rules tier still runs inside the budget. Exhausting the budget degrades the answer's *tier*, never the response. Both figures were raised on 2026-08-15 from a live measurement of the two AI tiers (Gemini 2.18s, OpenRouter 9.82s): the budget starts before the Cloudinary upload, and at 15s the last tier could not fit. The 35s ceiling sits under both clients' 45s upload timeout.

**`analysis.escalationPath`** is the honesty record: one `{provider, reason}` entry per hop that declined, in order. Reason codes only — a provider message can quote the request. Vocabulary: `uncertain` · `not_configured` · `disabled` · `deadline_exhausted` · `timeout` · `network` · `http_status` · `malformed_body` · `malformed_json` · `schema_invalid` · `empty_response` · `blocked` · `injected`. "No Gemini key" (`not_configured`) and "Gemini said UNKNOWN" are never the same string.

**UPLOAD_ERROR reason classes** — `400`, `details: [{field: "image", rule: <class>}]`, one messageKey per class:

| rule | messageKey | Fired by |
|---|---|---|
| `NO_FILE` | `errors.uploadNoFile` | no part, or an empty one |
| `TOO_LARGE` | `errors.uploadTooLarge` | >8MB (multer, before buffering completes) |
| `UNEXPECTED_FIELD` | `errors.uploadUnexpectedField` | a file part not named `image`; field-count/size/name caps |
| `TOO_MANY_FILES` | `errors.uploadTooManyFiles` | more than one file part; part-count cap |
| `NOT_AN_IMAGE` | `errors.uploadNotAnImage` | magic bytes are not an image (renamed `.exe`, SVG, ZIP), or a malformed multipart envelope |
| `UNSUPPORTED_FORMAT` | `errors.uploadUnsupportedFormat` | a recognised image container we do not accept (gif, tiff, bmp, psd, raw…) |
| `DIMENSIONS_TOO_LARGE` | `errors.uploadDimensionsTooLarge` | header declares >6000px on a side or >36MP, before any decode |
| `ANIMATED` | `errors.uploadAnimated` | multi-page/animated input (animated WebP, APNG) |
| `UNREADABLE` | `errors.uploadUnreadable` | header unparseable, truncated, or the decode failed |
| `STORAGE_UNAVAILABLE` | `errors.uploadStorageUnavailable` | Cloudinary refused or is unconfigured — `rule` here carries the coarse storage kind (`not_configured`\|`timeout`\|`rejected`\|`injected`) rather than the class name |

Classes are deliberately coarse: an honest user learns what to fix without a hostile one learning which guard fired. Pipeline rejections (the sniff/header/decode classes) are audited as `UPLOAD_REJECTED` because repeated rejects are the abuse signal; multer's transport-cap rejections short-circuit in the middleware and are not audited.

| | |
|---|---|
| GET `/crop-health/logs?cropId=&page=&limit=` | Auth · scoped |
Timeline, newest first, `userId` in the query filter (never post-filtered). `cropId` optional (all crops); `page` ≥1 default 1; `limit` ≤50 default 20. → 200 `{logs: [<summary log>]}` + `meta: {page, limit, total}`.
Summary log = `{id, cropId, imageUrl, description, status, sharedToCommunity, createdAt, analysis:{source, sourceLabelKey, diseaseCode, confidence, severityAssessment, escalated}}` — no trace, no snapshot, no escalation path.

| | |
|---|---|
| GET `/crop-health/logs/:id` | Auth · ownership (404) |
→ 200 `{log: <full log>}`, identical to the analyze detail shape including `recommendation.data.severityTrace` and `escalationPath`. `freshness.status` is always `live` here — it labels the analysis being served, not a re-run.

| | |
|---|---|
| POST `/crop-health/logs/:id/severity` | Auth · ownership (404) |
Req `{affectedAreaPct?: 0..100, spreadRate?: 'NONE'\|'SLOW'\|'RAPID'}` — strict, **at least one required** (neither → 422).
The stored analysis plus the new answers are re-run through the severity engine; there is no second severity implementation. Unsupplied answers fall back to previously stored ones. The log's `analysis.severityAssessment` and `recommendationSnapshot.data.severity`/`.severityTrace` are updated together so the timeline cannot show two levels.
→ 200 `{severity: {level, escalate, policy: "ENGINE_POLICY", reasonCode, trace, answers: {affectedAreaPct, spreadRate}}}`
`level` ∈ `MILD`\|`MODERATE`\|`SEVERE`\|`NOT_ASSESSED` · `reasonCode` ∈ `OK`\|`NO_INPUTS`\|`NOT_A_DISEASE`\|`UNKNOWN_DIAGNOSIS`.
`policy: "ENGINE_POLICY"` is provenance: the banding function is **declared policy, not sourced agronomy** (no document publishes a formula that generalises across diseases). Bands merge by `max`, not average — a low visual estimate must not cancel a high reported area — and `RAPID` spread lifts the band by one. Severity is engine-assessed, never model-fabricated; the AI's `severityVisual` is one input among several and is labelled `contributor: 'ai_visual_estimate'` in the trace.
This is the **only** endpoint that may amend a log, and only `severityFollowUp` + `analysis.severityAssessment` (+ the snapshot mirror). Diagnosis, source, confidence and image are never rewritten (ADR-024).

| | |
|---|---|
| POST `/crop-health/symptom-check` | Auth · RL 30/day · no photo |
Req `{cropId, answers: {part?, pattern?, color?, distribution?, spread?}}` — both objects strict; `answers` may be empty (the engine then reports `NO_SYMPTOMS_ANSWERED`). Ownership of crop **and** farm as for analyze.
Vocabulary: `part` LEAF·STEM·FRUIT·FLOWER·ROOT·WHOLE_PLANT · `pattern` SPOTS·BLOTCHES·POWDER·CURL·WILT·HOLES·YELLOWING·STREAKS·LESIONS·MOSAIC·ROT·STUNTING·WEBBING·RINGS · `color` YELLOW·BROWN·BLACK·WHITE·GREY·RED·ORANGE·PURPLE·TAN · `distribution` LOWER_LEAVES·UPPER_LEAVES·ALL_LEAVES·SCATTERED·MARGINS·VEINS · `spread` NONE·SLOW·RAPID. Values outside the vocabulary are reported in the trace as rejected rather than guessed at; the route caps each at 40 chars.
Weather is auto-attached from the **cached** snapshot for the farm (`weather:HIGH_HUMIDITY|RAIN|HOT_DRY|COOL_MOIST` — the fungal prior). No provider is ever called on this path (rule 3); an absent snapshot simply removes the axis.
→ 200 `{candidates: [...], guidance: {...}, trace: [...]}`
`candidates[]` = `{diseaseCode, matchScore, band, matchedTags, symptomKeys, inspectKeys, nextStepKeys, preventionKeys, sourceRefs, expertThreshold}`, best first, max 5. `band` ∈ `LIKELY` (≥0.6) \| `POSSIBLE` — **never "Diagnosed"**.
`guidance` = `{hasVerdict, reasonCode, expertReferral, expertReferralReasons, sourceLabelKey, coverageNoticeKey, answeredAxes, weatherTags}`. `reasonCode` ∈ `CANDIDATES_MATCHED`·`REGISTRY_CROP_UNAVAILABLE`·`CROP_UNSUPPORTED`·`DISEASE_KB_UNAVAILABLE`·`NO_SYMPTOMS_ANSWERED`·`KB_TAGS_UNAVAILABLE`·`NO_CANDIDATE_MATCH`; `expertReferralReasons` ⊆ `SCORE_BELOW_THRESHOLD`·`RAPID_SPREAD_REPORTED`·`NO_VERDICT`. `sourceLabelKey` is always `health.sourceGuided` ("Guided assessment — no AI").
Scoring: weights pattern 3, part 2, color 2, distribution 1, weather 1; `matchScore = awarded / answerable` over the **intersection** of answered axes and axes the KB entry declares — a silent axis is neither evidence for nor against. Deterministic: ties break on `diseaseCode`, so the registry's array order is never observable.

Dependencies: crops, cropRegistry, cropHealthLogs, weatherSnapshots (read-only), Cloudinary, ml-service, Gemini/OpenRouter. Community sharing requires **both** the per-request `shareToCommunity` and the account-level `communityConsent`; rules-tier results are excluded from aggregation entirely.
