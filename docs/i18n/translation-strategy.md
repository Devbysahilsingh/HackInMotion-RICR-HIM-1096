# Translation Strategy & Workflow

## Authoring flow
1. English key authored with the feature (PR includes en entries — DoD item).
2. Hindi drafted in the same PR (Claude-drafted permitted as DRAFT).
3. **Human verification pass (mandatory):** a Hindi-literate team member reviews `hi/*.json` — batched Day 2 evening + Day 3 (team-plan task with owner). Verification state tracked via `_meta.verified` arrays per file; check-i18n reports unverified counts.
4. Agricultural/medical-adjacent terms follow the curated terminology table (below) — never free-translated per-occurrence.

## Tone/register guidance (hi)
Simple, respectful आप-form; short sentences; common rural vocabulary over Sanskritized officialese (सिंचाई not जलसेचन); numerals in digits; crop/disease names per terminology table with regional alt-names where they aid recognition.

## Priorities under time pressure (explicit)
Order: dashboard/feed → health results & guidance → irrigation/weather verdicts → farm/crop forms → auth → market → fertilizer → cropRec → community/voice → settings/help. UI never ships a screen whose PRIMARY action strings are unverified-Hindi; secondary text may carry `(draft)` marker internally but must still exist (parity gate).

## Error messages
`errors` namespace maps every canonical messageKey (docs/api/error-codes.md + reason classes) to actionable localized text — the "no blank/cryptic failures" requirement lives here.
