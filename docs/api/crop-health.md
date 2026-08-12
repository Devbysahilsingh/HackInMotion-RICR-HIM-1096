# Crop Health API

| | |
|---|---|
| POST `/crop-health/analyze` | Auth · RL **10/day/user + 3/min burst** · multipart |
Req: `image` file (≤8MB jpeg/png/webp/heic) + `cropId` + `description?`. Ownership of cropId checked.
Pipeline (docs/ai/ai-architecture.md): validate→re-encode→Cloudinary→route by registry supportLevel: SPECIALIZED → ml-service (X-Service-Key; 10s timeout) → confidence ≥ calibrated τ? return : escalate Gemini (10s) → escalate rules; GENERAL → Gemini → rules; LIMITED/UNSUPPORTED → rules + honest notice.
→ 201 `{log: {id, imageUrl, analysis:{source, diseaseCode|UNKNOWN, confidence?, top3?, severityAssessment?, escalated}, recommendation:{titleKey, bodyKey, data}, freshness}}`
Timing budget ≤15s E2E; each tier failure degrades to next, never 500 while a tier remains. Errors: UPLOAD_ERROR(400) with reason class, 404 (crop), 422, 429; ML_ERROR/AI_ERROR only if all tiers terminal (design goal: never — rules tier is local).

| | |
|---|---|
| GET `/crop-health/logs?cropId=&page=` | Auth |
Timeline, newest first. cropId optional (all crops). → 200 list + meta.

| | |
|---|---|
| GET `/crop-health/logs/:id` | Auth (ownership) |
Full log incl. why-trace + follow-up questions state.

| | |
|---|---|
| POST `/crop-health/logs/:id/severity` | Auth · P1 |
Follow-up answers `{affectedAreaPct, spreadRate}` → severity re-assessment by rules engine → 200 updated assessment. (Severity is engine-derived — never model-fabricated.)

| | |
|---|---|
| POST `/crop-health/symptom-check` | Auth · RL 30/day |
No-photo path (rule engine directly): `{cropId, answers:{part, pattern, color, spread}}` → 200 `{candidates:[{diseaseCode, matchScore}], guidance}`. Powers low-confidence fallback UX and offline-adjacent use.

Dependencies: crops, cropRegistry, cropHealthLogs, Cloudinary, ml-service, Gemini, recommendations (emit on diseased result).
