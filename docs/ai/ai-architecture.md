# AI Architecture (external AI usage map)

## Where AI is used — and pointedly where it is NOT
| Surface | AI? | What |
|---|---|---|
| Crop-health vision | ✅ | Custom ML (primary, specialized crops) → **Gemini 2.5 Flash** (low-confidence escalation + GENERAL-crop primary) → OpenRouter free vision (tertiary) → rule engine (terminal, local) |
| Treatment/agronomic recommendations | ❌ | Curated KB only, keyed by diseaseCode — LLMs never author farming advice |
| Fertilizer guidance | ❌ | KB only (highest-harm hallucination class) |
| Irrigation/weather/market/crop-rec/yield | ❌ | Deterministic engines |
| Voice intent | ❌ (P3 optional no-match classify) | Keyword matcher |
| Hindi translation of KB | ❌ runtime | Human-curated at build time |

Principle: **AI perceives; engines decide; KB speaks.** Gemini extracts visual findings into a constrained schema; everything the farmer reads comes from our reviewed content.

## Chain (crop-health)
```
upload → registry route:
SPECIALIZED → ml-service ── conf ≥ τ ──────────────→ result (source: Local AI)
                └ uncertain ─→ Gemini ── valid ────→ result (source: AI-assisted)
GENERAL ────────────────────→ Gemini ── invalid/down → OpenRouter (same contract)
LIMITED/UNSUPPORTED ─────────────────────── └──────→ rule-based symptom engine (source: Guided assessment)
```
Every hop: timeout 10s, 1 retry, failures logged, next tier engaged; rule engine is local ⇒ chain never fully fails. Source + escalation path stored on the log and shown in UI (honesty labels).

## Free-tier budget & rate strategy
Gemini free tier 1,500 req/day (no card) vs our cap: 10 analyses/user/day + image-hash cache (identical photo re-analysis served from cache) ⇒ demo-day usage ≪ quota. Server-side per-service counters in /system/status; quota exhaustion behaves as service-down (next tier). OpenRouter free: 50/day — tertiary only. Keys server-side only.
