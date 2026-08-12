# Offline / Low-Connectivity Strategy (FR-O1 P2 · FR-O2 P3)

Honest scope: this is a cloud-backed advisory app; we do NOT claim full offline capability. We design for **read resilience** (rural patchy connectivity) and document exactly what works without network.

## Works offline (mobile, P2) — cached last-known-good, always age-labeled
| Capability | Mechanism |
|---|---|
| Dashboard feed + crop cards | React Query cache persisted to AsyncStorage (persistQueryClient), hydrated on cold start |
| Weather + irrigation verdict (as last computed) | same — server already embeds freshness metadata; UI shows ● Cached (age) |
| Market trends (last fetched) | same |
| Crop health history + past recommendations | same |
| Crop/disease knowledge (registry) | prefetched + persisted (7d TTL) — includes symptom guidance: genuinely useful in-field |
| TTS readout of cached recommendations | expo-speech is on-device |

## Requires connectivity (stated in-app, not hidden)
Auth (login/refresh), new photo analysis (model is server-side), fresh weather/market, community, web STT. Expired access token offline → read-only cached mode with banner ("Reconnect to refresh"), not a logout wipe.

## Web (P2-lite)
React Query in-memory cache + freshness badges; no persistence promises (browser storage of farm data adds privacy surface for shared devices — decision: skip; documented).

## P3 — write queue (designed now, not built)
Draft crop-health observations (photo + description) saved locally (expo-file-system + metadata row) → visible in history as "Pending upload" → connectivity listener drains queue → idempotency: client-generated uuid per draft; server dedupes on it. Conflict-free by design (health logs are append-only). Sync failures: retry w/ backoff, user-visible state, never silent loss.

## On-device ML (evaluated, deferred)
ONNX→TFLite conversion of EfficientNet-B0 (~20MB) is technically plausible but adds a native inference dependency + accuracy-parity validation we cannot responsibly do in 72h → **future scope**, path documented in docs/ml/model-versioning.md. Hackathon architecture stays Mobile→Backend→FastAPI.

## Testing
Airplane-mode matrix (docs/testing/resilience-testing.md): cold-start offline, mid-session drop, reconnect refresh, stale-badge correctness, token-expiry-offline behavior.
