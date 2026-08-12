# AI/ML Endpoint Security

- **ml-service exposure:** internal-contract only — X-Service-Key (256-bit, env, constant-time compare) required on /predict; public surface = /healthz liveness only; OpenAPI docs disabled in prod; hosted service URL not published in client bundles (backend env only).
- **Key isolation:** Gemini/OpenRouter/Groq keys live in backend env exclusively; ml-service holds zero external keys; clients hold zero keys of any kind (APK strings-scan test).
- **Input hygiene to AI tiers:** only sanitized re-encoded images (upload doc); descriptions quarantined + injection-stripped (prompt-strategy); no PII in any prompt (state-level location max).
- **Output zero-trust:** schema validation, registry-closed diseaseCodes, advice-field discard (ai-safety rules) — an attacker-influenced model output cannot inject content into farmer guidance.
- **Quota protection:** per-user quotas (10 analyses/day) sit far below free-tier ceilings; image-hash cache dedupes; per-service daily counters alarm at 60% (system status).
- **Abuse scenarios tested:** replaying analysis calls (429), oversized images (reject), forged X-Service-Key (401 + audit), direct ml-service /predict without key from internet (401), prompt injection via description (fixture asserts guidance unchanged).
- **Kill-switches:** `DISABLE_ML`, `DISABLE_GEMINI`, `DISABLE_OPENROUTER` env flags (also power failure-injection demos) — these degrade tiers; they can never weaken auth (flags reviewed to touch routing only).
