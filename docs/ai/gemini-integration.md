# Gemini Integration

Model: `gemini-2.5-flash` (free tier, vision, structured output). SDK: `@google/genai` (official). Key: `GEMINI_API_KEY` env, backend only.

## Call design
- Input: re-encoded JPEG (our sanitized copy — never the raw upload), cropCode context, description (sanitized, length-capped, injection-quarantined — see prompt-strategy.md), region/season context, ML top3 hint when escalating (labeled "unverified candidates").
- `responseMimeType: application/json` + `responseSchema` (response-schema.md) — schema-constrained decoding.
- generationConfig: temperature 0.2 (perception task, not creativity), maxOutputTokens bounded.
- Timeout 10s; retry 1 (backoff+jitter); 429/5xx → tier-down.

## Response handling (zero-trust)
Zod-parse → diseaseCode ∈ registry KB else coerced to UNKNOWN → confidence bucket mapped to numeric band → visualFindings kept as evidence strings (displayed under "AI observations", clearly attributed) → **recommendation text discarded if model emits any** (KB renders guidance). Invalid JSON after retry → tier-down. All handling identical for OpenRouter tier (same schema contract).

## What Gemini is asked to do / forbidden from doing
Do: describe visible symptoms; select the single best-matching diseaseCode FROM THE PROVIDED LIST for this crop (or UNKNOWN); estimate severity class from visible extent; flag not-a-plant / wrong-crop images. Forbidden (prompt + code enforcement): treatment advice, dosages, product names, certainty language, codes outside the list.
