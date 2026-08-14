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
React Query in-memory cache + freshness badges; **the read cache is still not persisted** — browser storage of farm data adds privacy surface on a shared device, and that decision stands.

The irrigation outbox is a deliberate, narrow exception to it, and worth stating rather than leaving the reader to notice the contradiction. What it persists is a *pending write the farmer just made* — a date and a millimetre figure — not a copy of their farm, and it is deleted the moment the server acknowledges it. The privacy objection was about accumulating readable farm history on a shared machine; a transient queue of one's own unsent entries is a different exposure, and the alternative is losing a watering the farmer believes they recorded.

## Write queue — irrigation logs (BUILT 2026-08-14) · photo drafts (still designed, not built)

**Built, on both clients.** The irrigation log is the one write a farmer makes standing in a field with no signal, so it is the one that is queued. The queue logic lives once in `shared/client/irrigationOutbox.ts`; the web binds it to `localStorage` + the browser `online` event and Android binds it to AsyncStorage + NetInfo, so the two clients cannot drift on when an item is dropped versus retried.

| Property | Behaviour |
|---|---|
| Trigger | The write is attempted first; a *transport* failure queues it. A 4xx that is not a 429 is shown as an error, never silently queued |
| Idempotency | `clientRequestId` (UUIDv4) generated **before** the first attempt, so a replay carries the same id the original request did |
| Server dedupe | Unique partial index `(userId, clientRequestId)` **and** a pre-write lookup — the index for concurrent flushes, the lookup for a database where `indexes:build` has not run |
| Replay answer | `200` + `replayed: true` with the original row (not `201`) |
| Honesty | Queued rows render above the server's, dashed and labelled `irrigation:logPendingBadge` — never merged into accepted history (rule 9) |
| Bounds | 5 attempts per item, 50 items max (oldest dropped first); flush is serial, because the write is rate-limited 10/day and a reconnect burst would spend that on 429s |
| Storage safety | Queue holds a date and a millimetre figure — no credential, no image. That is why AsyncStorage is acceptable here and not for the refresh token |

**A watering is not a day.** Two genuine waterings on one date carry two ids and both persist; only a re-delivery of the same submission collapses. Collapsing on `(cropId, date)` would under-count applied water, which is the more dangerous error.

**Still designed, not built:** draft crop-health observations (photo + description) saved locally (expo-file-system + metadata row) → visible in history as "Pending upload" → connectivity listener drains queue → same client-generated uuid dedupe. Deliberately excluded from the built queue: multi-megabyte binaries in a queue that must survive a process death is a materially different problem. Crop and farm creation are excluded too — they happen at setup, on wifi.

## On-device ML (evaluated, deferred)
ONNX→TFLite conversion of EfficientNet-B0 (~20MB) is technically plausible but adds a native inference dependency + accuracy-parity validation we cannot responsibly do in 72h → **future scope**, path documented in docs/ml/model-versioning.md. Hackathon architecture stays Mobile→Backend→FastAPI.

## Testing
Airplane-mode matrix (docs/testing/resilience-testing.md): cold-start offline, mid-session drop, reconnect refresh, stale-badge correctness, token-expiry-offline behavior.
