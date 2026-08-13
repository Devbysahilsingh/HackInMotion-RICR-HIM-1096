# Gemini Integration

Model: `gemini-flash-latest` (free tier, vision, structured output). Key: `GEMINI_API_KEY` env, backend only.

> **Model history.** This was pinned to `gemini-2.5-flash` until 2026-08-13, when a live check found that id returning **404 NOT_FOUND** — "no longer available to new users" — for this project's key, which silently took the Gemini tier out of the chain (`escalationPath: gemini → http_status`) and dropped every analysis to the rule engine. `gemini-2.5-flash-lite` is retired the same way. The rolling `gemini-flash-latest` alias is used deliberately so a future retirement cannot repeat the outage; model drift is bounded by schema validation and the registry-closed output contract (CLAUDE.md rule 6). The single source of truth is `GEMINI_MODEL` in `backend/src/integrations/gemini.js`, and the URL test binds to that constant rather than a literal.

## Call design
- Input: re-encoded JPEG (our sanitized copy — never the raw upload), cropCode context, description (sanitized, length-capped, injection-quarantined — see prompt-strategy.md), region/season context, ML top3 hint when escalating (labeled "unverified candidates").
- `responseMimeType: application/json` + `responseSchema` (response-schema.md) — schema-constrained decoding.
- generationConfig: temperature 0.2 (perception task, not creativity), maxOutputTokens bounded.
- Timeout 10s; retry 1 (backoff+jitter); 429/5xx → tier-down.

## Response handling (zero-trust)
Zod-parse → diseaseCode ∈ registry KB else coerced to UNKNOWN → confidence bucket mapped to numeric band → visualFindings kept as evidence strings (displayed under "AI observations", clearly attributed) → **recommendation text discarded if model emits any** (KB renders guidance). Invalid JSON after retry → tier-down. All handling identical for OpenRouter tier (same schema contract).

## What Gemini is asked to do / forbidden from doing
Do: describe visible symptoms; select the single best-matching diseaseCode FROM THE PROVIDED LIST for this crop (or UNKNOWN); estimate severity class from visible extent; flag not-a-plant / wrong-crop images. Forbidden (prompt + code enforcement): treatment advice, dosages, product names, certainty language, codes outside the list.
