# Central Recommendation Engine (feed composer)

Consumes every intelligence source; emits prioritized, explainable, i18n-ready feed items (`recommendations` collection). This is the layer that makes the product an advisor, not widgets.

## Item contract
`{type, priority, source: WEATHER|ML|RULE_ENGINE|MARKET|COMMUNITY|HYBRID, titleKey, bodyKey, data (i18n params + trace), confidence?, validUntil, farmId?, cropId?}`

## Priority mapping (deterministic table — viva-defensible)
| Event | Priority |
|---|---|
| Frost/heat CRITICAL risk on sensitive stage; disease confirmed high-confidence + severe | CRITICAL 🔴 |
| IRRIGATE_TODAY; HIGH weather risk; community HIGH advisory | HIGH 🟠 |
| IRRIGATE_IN_N_DAYS; market signal change on user's crop; fertilizer stage window opening; MEDIUM risks | MEDIUM 🟡 |
| WAIT_RAIN; NO_NEED confirmations; community INFO; tips | INFO 🟢 |

Conflict resolution: same crop+day contradictions resolved by precedence WEATHER-CRITICAL > HEALTH > IRRIGATION > MARKET; contradicting pair (e.g. heavy-rain + irrigate-today) → HYBRID item "rain expected — hold irrigation" (rule table, not LLM).

## Generation
- feed-refresh job 30min (idempotent upserts, dedupe type+cropId+day) + event-driven emissions (health analysis, community aggregation, market signal flip).
- Expiry: validUntil per type (irrigation EOD; risk = event window; market 48h; fertilizer = stage window).
- Cap: max 20 active/user; INFO evicted first (overload prevention — problem statement's "avoid information overload").

## Explainability
`data` carries the engine trace; UI "Why?" expander renders numbers directly. No recommendation without trace data — enforced by TS type + test.
