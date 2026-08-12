# Dashboard & Recommendations API

| | |
|---|---|
| GET `/dashboard` | Auth · the single most important endpoint |
One aggregation, zero external calls:
→ 200 `{feed:[recommendations: active, unacknowledged, sorted priority→createdAt, max 20], cropCards:[{cropId, cropCode, names, stage, irrigationVerdict(min), healthFlag(latest), marketSignal(min), freshness}], farmSummary, systemStatus:{weather:'live'|'cached'|'stale', market:..., ml:'up'|'down'}}`
p95 target <800ms. Empty state (no farms) → designed onboarding payload, not empty arrays.

| | |
|---|---|
| GET `/recommendations?page=` | Auth |
Full history incl. acknowledged/expired.

| | |
|---|---|
| POST `/recommendations/:id/ack` | Auth (ownership) |
→ 204. Feed hygiene.

## Feed generation (server jobs, not request-time)
- **feed-refresh job (30min):** per user with active crops → run engines → upsert recommendations (dedupe by type+cropId+day; priority per engine rules: e.g., frost CRITICAL, irrigate-today HIGH, price-move MEDIUM, tips INFO). validUntil set (irrigation: end of day; risks: event window; market: 48h).
- Health + community items emitted event-driven at analysis/aggregation time.
- Priorities: CRITICAL 🔴 (act now, crop loss risk) · HIGH 🟠 (act today) · MEDIUM 🟡 (this week) · INFO 🟢. Icon+color+text always together (accessibility).
