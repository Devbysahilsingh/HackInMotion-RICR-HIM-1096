# AI Fallback Strategy — Rule-Based Symptom Engine (terminal tier)

Real functionality, not a stub: a guided differential over the registry disease KB. Runs locally in backend (no network), also user-invocable directly (`/crop-health/symptom-check` — the no-photo path).

## Mechanism
1. Question set (localized, low-literacy phrasing + icons): affected part; pattern (spots/blotches/powder/curl/wilt/holes/yellowing); color; distribution (lower/upper/all leaves); spread speed; weather context auto-attached (humidity/rain from snapshot — fungal prior).
2. Scoring: each KB disease entry carries symptom feature tags; answers → weighted match score (weights: pattern 3, part 2, color 2, distribution 1, weather-context 1); normalized.
3. Output: top candidates with matchScore bands (Possible/Likely — never "Diagnosed"), inspection guidance + next steps + prevention from KB, expert-referral threshold (score <0.4 or user-reported rapid spread → "contact KVK/Kisan Call Centre" primary CTA).
4. Honesty framing: source label "Guided assessment (no AI)"; result stored with source:'rules'; excluded from community aggregation (noise control).

## Why this is credible
It encodes the same differential logic extension workers use for first-pass triage; every mapping traces to the KB entry's sourced symptom description (TNAU CPG symptom texts etc.). Tested: fixture answer-sets → expected candidate ordering; adversarial: contradictory answers → low scores → referral path.

## Chain positions
(a) Terminal fallback when ML+Gemini+OpenRouter unavailable — app still delivers value net-down. (b) Low-confidence companion path offered alongside retake. (c) Standalone symptom checker (works offline-adjacent on mobile once registry is cached — P2 synergy).
