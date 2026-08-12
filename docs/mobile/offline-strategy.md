# Mobile Offline Strategy

Implements docs/offline/offline-strategy.md on device:
- persistQueryClient + AsyncStorage (maxAge 24h data, registry 7d); hydrate-on-boot ⇒ cold-start offline shows last session's dashboard/weather/market/history with ● Cached (age).
- NetInfo listener → global OfflineBanner + per-card freshness; writes disabled w/ explanation ("इंटरनेट नहीं है — दोबारा जुड़ने पर नई जानकारी मिलेगी").
- Token expiry offline: cached READ view retained (banner: reconnect to refresh) — no data wipe, no fake auth.
- Registry+symptom KB prefetched post-login ⇒ SymptomChecklist genuinely works offline (in-field value).
- TTS works offline (device engine).
- Out of scope (stated): offline analysis (server ML), fresh data, auth. P3: draft observation queue (design in docs/offline).
Tests: resilience-testing.md mobile matrix (cold-start offline, mid-flight drop during upload, reconnect refetch, banner correctness, 24h-stale warning).
