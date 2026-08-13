# ADR-024 — Phase 3 crop-health chain decisions

**Status:** Accepted · **Date:** 2026-08-13 · **Phase:** 3 (P3-1..P3-8)

Records the decisions Phase 3 had to make because the specification was silent,
or because two approved documents disagreed. Everything the specification did
settle was implemented as written and is not repeated here.

---

## 1. Three documents said 10s, one said 8s — and neither number fits alone

`docs/api/crop-health.md`, `docs/ai/ai-architecture.md`,
`docs/ai/gemini-integration.md` and `docs/ml/inference-architecture.md` all give
each AI hop **10s**. `docs/architecture/resilience.md` gives **8s** for
"weather/AI" generically, and RES-08 repeats it.

The specific contract wins over the generic one, so a hop may take 10s. But the
same API document also fixes a **≤15s E2E budget**, and 10 + 10 is 20 — so a
per-hop ceiling alone cannot honour it. Neither number was wrong; the pair was
simply never reconciled.

**Decision.** A hop gets `min(AI_HOP_TIMEOUT_MS, deadline − now)` against a 15s
deadline set when the request begins, and a hop with no useful budget left is
**skipped rather than started**, recording `deadline_exhausted` in the
escalation path. The terminal rules tier is local, so exhausting the budget
degrades the answer's tier and never the response.

`resilience.md`'s 8s remains correct for the weather and market jobs it was
written about.

## 2. LIMITED crops route to the rule engine

`docs/api/crop-health.md`: "LIMITED/UNSUPPORTED → rules + honest notice".
`docs/product/crop-support-matrix.md`: LIMITED gets "Gemini best-effort".

**Decision.** The wire contract wins — the same precedent as the weather
risk-type spellings in `config/constants.js`: clients are written against the
API document. The honest notice is what makes it acceptable. A LIMITED crop has
a thin KB by definition, so a confident-looking AI answer would have nothing
reviewed behind it to render as guidance; `health.coverageLimited` says so
plainly instead.

## 3. The image-hash cache is per-user, per-crop, and hashes the re-encoded bytes

Four documents name an "image-hash cache"; none specifies a key, a scope, a TTL
or a store.

**Decision.** Key `(userId, cropId, imageHash)`, window 7 days, stored as an
`imageHash` field on `cropHealthLogs` — **no new collection**.

- **Per user.** A global cache would answer one farmer's request with another's
  analysis and would disclose that someone else uploaded the same photograph.
  AU-1 forbids it.
- **Per crop.** The same leaf declared as tomato and as potato is a different
  question: the allowed code list and the routing both change.
- **Over the re-encoded bytes, not the upload.** Two photographs of one leaf
  differ in EXIF timestamp, so raw-byte hashes would never collide and the cache
  would never hit. After sanitization the same source deterministically produces
  the same JPEG.
- **No index.** `userId_cropId_createdAt` already covers the first two key
  fields; a 10-per-day quota over a 7-day window leaves a handful of documents
  to compare, which does not justify an index on an M0 cluster.

The hash is not a security control — an attacker can trivially make two photos
hash differently. It exists so a retry does not burn free-tier quota.

## 4. A cache hit answers 200, not 201

`docs/api/crop-health.md` documents 201 for `analyze`.

**Decision.** A cache hit returns **200** with `freshness.status: "cached"` and
the previously created log. Nothing was created: an identical photograph for an
identical crop is the same observation, and writing a second row would duplicate
the farmer's timeline and inflate the community report count for that
farmer+crop+disease window. The body states the cache hit explicitly, so no
client has to infer it from the status code.

## 5. Severity banding is declared engine policy, not sourced agronomy

`analysis.severityAssessment` is an untyped `String` in the schema and no
document publishes a banding function. Real infection thresholds are
per-pathogen and per-crop; inventing a set that generalises would be fabricated
agronomy (rule 7).

**Decision.** Follow the ADR-023 weather-risk precedent — state the arithmetic,
put every input in the trace, and label the output as policy:

- Vocabulary `MILD | MODERATE | SEVERE | NOT_ASSESSED`, mirroring the AI
  schema's `severityVisual` so an input and the output are read on one scale.
- Inputs: the AI tier's `severityVisual`, and the follow-up answers
  `affectedAreaPct` (bands at ≤10% / ≤33% / above) and `spreadRate`.
- **Merged by maximum, not average.** `docs/ml/evaluation-plan.md` ranks
  "disease→HEALTHY false negatives" as the dangerous failure and calls the
  opposite direction an "acceptable asymmetry". An average lets a low visual
  estimate cancel a high measured area and under-call; a maximum cannot.
- `spreadRate: RAPID` lifts the band by one and sets `escalate`.
- No inputs → `NOT_ASSESSED`. A healthy class or an `UNKNOWN` diagnosis →
  `NOT_ASSESSED`, never a level: "mildly diseased" about a plant we could not
  name, or one we called healthy, is worse than saying nothing.

Every result carries `policy: 'ENGINE_POLICY'` so it can never be read as a
measurement.

## 6. `cropHealthLogs` stays append-only, with one bounded exception

The model comment said "append-only: never updated after write". The API
contract defines `POST /crop-health/logs/:id/severity` as amending the document.

**Decision.** Narrow the rule rather than abandon it. Only `severityFollowUp`
and `analysis.severityAssessment` may ever change, only through that one
endpoint, and only for the owning user. The diagnosis, source, confidence,
escalation path and image are never rewritten, so the record of what was
observed and what each tier said stays intact. A regression test asserts the
untouched fields.

## 7. Disease names carry a nullable Hindi, and that is the honest outcome

`localizedNameSchema` requires both languages, which is right for crop names —
those came from a bilingual Government of India document. The disease KB did
not: it is TNAU / ICAR / NIPHM extension material published in English, and rule
8 forbids translating agronomic terms without human verification.

**Decision.** Disease names use a dedicated schema with `hi` nullable and
`hiVerified` alongside. Requiring `hi` would have left only two options — drop
the entire sourced KB, or invent Hindi disease names. A null is a visible,
queryable gap that the seed prints and `dataGaps` records; a fabricated
translation would be invisible and wrong.

**This gate is currently failing, deliberately and visibly:** 0 of 408 disease
strings have Hindi. ADR-021 §1 gates cotton's *ship* on bilingual KB entries,
and that gate now has something concrete to read.

## 8. The tier is what the farmer is told; the provider is what we record

`cropHealthLogs.analysis.source` is a three-value enum and Gemini and OpenRouter
are one *tier* — "AI-assisted" either way (ai-safety rule 6 forbids blending
tiers into an anonymous "AI", but does not ask us to distinguish two vendors to
the farmer).

**Decision.** `source` stays the tier. Two fields were added: `provider`, the
specific service that answered, and `escalationPath`, one entry per hop that
declined with a coarse reason code. This satisfies ai-architecture.md's "Source
+ escalation path stored on the log" and keeps "no Gemini key" distinguishable
from "Gemini said UNKNOWN" in both the logs and the operator's `/healthz` view.

## 9. `DISABLE_*` is honoured in production; `FORCE_FAIL_*` is not

The two flag families were previously one mechanism.

**Decision.** They are separated. `FORCE_FAIL_*` / `FORCE_SLOW_*` remain
short-circuited by `isProd` — they exist to demonstrate the RES matrix.
`DISABLE_ML` / `DISABLE_GEMINI` / `DISABLE_OPENROUTER` **are** honoured in
production, because that is their entire purpose: shedding a tier whose free
quota is spent, without a redeploy (`docs/security/ai-security.md`). Both remain
routing-only — no value of either can widen access to anything, and a test
asserts a kill switch changes routing without touching validation.

## 10. Uploads are held in memory, not in a temp file

`docs/security/image-upload-security.md` step 5 says "temp file in isolated tmp
dir, deleted in finally-block".

**Decision.** Multer uses memory storage and no temporary file is ever created.
This is a strengthening, not a shortcut: the 8MB ceiling is enforced before a
byte is buffered, sharp decodes from a Buffer and Cloudinary accepts a stream,
so no path is ever constructed from user input, nothing survives a crash between
a write and its `finally`, and there is no temp directory for a second process
to read. A cleanup step that cannot fail beats one that is carefully written.

The cleanup that *does* matter is remote: if storage succeeds and a later step
fails, the orphaned Cloudinary asset is destroyed best-effort, and a cleanup
failure is logged without replacing the original error.

## 11. The heif allowlist admits AVIF

The upload doc names `{jpeg, png, webp, heic}`.

**Decision.** The magic-byte allowlist admits `avif` as well. It is the same
ISO-BMFF/HEIF container as HEIC with a different codec inside; admitting one
while refusing the other rejects a valid photograph for a reason the farmer
cannot act on. Both still have to survive decoding, which is the real arbiter.

**Honest limitation:** no valid HEVC-coded HEIC could be produced in this
environment (`heifsave: Unsupported compression` — the libvips build has no HEVC
encoder), so the heif container path is proven end-to-end with AVIF, and the
undecodable-payload path is proven with a truncated HEIF. Full HEVC-HEIC
decoding is **not** demonstrated. `sharp.metadata()` does report
`compression: 'hevc'` on a real HEIC, which indicates a decoder is present, but
that is an indication and not a proof.

## 12. POST transport was reproduced rather than added to `httpClient`

`utils/httpClient.js` documents itself as jobs-only and is GET-only. The AI
tiers are request-path POSTs.

**Decision.** The POST helper lives in `services/aiVision.js` and reproduces
httpClient's disciplines exactly — AbortController hard timeout, one retry with
±25% jitter, coarse `ProviderError` reasons, no URL query string or body in any
log or error — while importing `ProviderError` / `PROVIDER_FAILURE` / `safeUrl`
so the vocabulary stays single. Widening httpClient would have contradicted its
own stated contract; duplicating the vocabulary would have split it.

## 13. The symptom engine normalises over answerable axes only

`docs/ai/fallback-strategy.md` fixes the weights (pattern 3, part 2, color 2,
distribution 1, weather 1) and says "normalized", without saying over what.

**Decision.** `matchScore = awarded / answerable`, where `answerable` sums the
weight of axes that were **both** answered/available **and** on which the
disease declares at least one tag. Reads as "of the evidence this entry can
speak to, how much matched". The rejected alternatives are recorded in the
engine's docblock; the decisive one is that normalising over all *answered* axes
punishes an entry for the farmer volunteering more information — a leaf-curl
virus that legitimately declares no colour tag would drop from 3/3 to 3/5
because the farmer also named a colour.

Corollary: an unavailable weather axis contributes to neither numerator nor
denominator, so absence never penalises anything.

---

## Consequences

- The chain has one conductor (`services/cropHealthService.js`) and one
  provider contract (`services/aiVision.js`). Adding a fourth vision provider is
  a descriptor in a list; it touches no routing, validation or storage code.
- Adding or promoting a crop remains a registry change with no code change.
- Three gates are open and visible rather than closed by assumption: Hindi
  disease text (0/408), the calibrated thresholds the trained model must supply,
  and cotton's ADR-021 bilingual-KB ship gate.
