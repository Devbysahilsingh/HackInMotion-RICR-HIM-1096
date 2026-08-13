# Mobile Offline Strategy

Implements docs/offline/offline-strategy.md on device:
- persistQueryClient + AsyncStorage (maxAge 24h data, registry 7d); hydrate-on-boot ⇒ cold-start offline shows last session's dashboard/weather/market/history with ● Cached (age).
- NetInfo listener → global OfflineBanner + per-card freshness; writes disabled w/ explanation ("इंटरनेट नहीं है — दोबारा जुड़ने पर नई जानकारी मिलेगी").
- Token expiry offline: cached READ view retained (banner: reconnect to refresh) — no data wipe, no fake auth.
- Registry+symptom KB prefetched post-login ⇒ SymptomChecklist genuinely works offline (in-field value).
- TTS works offline (device engine).
- Out of scope (stated): offline analysis (server ML), fresh data, auth. P3: draft observation queue (design in docs/offline).
Tests: resilience-testing.md mobile matrix (cold-start offline, mid-flight drop during upload, reconnect refetch, banner correctness, 24h-stale warning).

## As built (Phase 6)

**Persistence.** `PersistQueryClientProvider` in `mobile/src/App.tsx` with `createAsyncStoragePersister` (key `him1096.queryCache`, `throttleTime` 2s). `maxAge` is **24h and uniform** — the "registry 7d" figure is a `staleTime`, not a second persistence window: `STALE_TIME.registry` in `shared/client/queryKeys.ts` is 7 days, so the registry is never refetched inside the 24h persisted window, but the persisted blob itself still expires with everything else. Stating it the other way round would over-claim.

**Only successful reads are written down.** `shouldPersistQuery` dehydrates `status === 'success'` only. A persisted `error` query would rehydrate as a permanent error screen on a device that is now perfectly online; a persisted `pending` one as a spinner with nothing behind it.

**`gcTime` is 24h, `staleTime` is per-domain** (`dashboard` 60s · `slowMoving` 5min for weather/market · `registry` 7d · `interactive` 30s), so data stays in cache long after it goes stale and renders *labelled* rather than being evicted (ADR-008).

**Retries.** `isRetryable` on `ApiError` gates it — a 4xx is retried zero times because the same request yields the same 4xx, and retrying a 429 makes a rate-limited farmer more rate-limited. Otherwise ×2 with exponential backoff capped at 8s. **Mutations never auto-retry**: a mutation that failed did something, or nearly did, and replaying it could double-write an irrigation log.

**NetInfo drives React Query's online manager** (`hooks/useOnlineManager.ts`). Without this the library falls back to `navigator.onLine`, which on React Native is permanently true — queries would retry into a dead radio instead of pausing and resuming on reconnect (RES-12). The same hook backs `useNetworkStatus()`, which carries a `known` flag so the UI never asserts "offline" before the first NetInfo answer has arrived.

**Foregrounding replaces window focus.** `refetchOnWindowFocus` is off in `api/queryClient.ts` — it is a browser idea — and `hooks/useAppStateRefetch.ts` does the Android equivalent on app resume, switchable off so it cannot fire while the camera is open. `refetchOnReconnect` is left on and works as-is.

**Write guard.** `hooks/useOfflineWriteGuard.ts` blocks mutations while offline and returns the explanation, rather than letting a write fail into a generic error.

**Registry prefetch (`hooks/usePrefetchRegistry.ts`).** Once per signed-in session, online only, two levels: the list (backs `useCropNames` and the crop pickers) and then each crop document sequentially (carries `diseases[].names`, `symptomTags`, `kcStages` — what the symptom screen reads). Sequential on purpose: it is background work competing with the dashboard the farmer is actually looking at. If the list never lands the session is *not* marked warmed, so the next reconnect tries again.

**Cold start offline.** `store/AuthContext.tsx` checks NetInfo before attempting `/auth/refresh`. Offline, the refresh is **not attempted** — so nothing can be refused, the stored credential survives, and the app opens on the persisted cache with `sessionUnverified` set. See authentication.md for the full branch and its one known gap.

## Verification status

| Behaviour | Status |
|---|---|
| Online manager driven by NetInfo, `known`/`online` semantics | ✔ COMPLETE — `hooks/useOnlineManager.test.ts` (5 tests) |
| Offline write guard blocks and explains | ✔ COMPLETE — `hooks/useOfflineWriteGuard.test.tsx` (3 tests) |
| Registry prefetch: once per session, skipped offline, retried on reconnect, list-then-crops | ✔ COMPLETE — `hooks/usePrefetchRegistry.test.tsx` (5 tests) |
| App-state refetch on foreground, suppressible | ✔ COMPLETE — `hooks/useAppStateRefetch.test.tsx` (6 tests) |
| Persist config: 24h maxAge, success-only dehydration, retry policy | ⚠ PARTIAL — code-verified; no test drives a real AsyncStorage rehydrate |
| RES-09 cold-start offline renders last session with ● Cached (age) | ⏳ MANUAL DEVICE TEST PENDING |
| RES-10 connection drop mid-upload → retry keeps the compressed image | ⚠ PARTIAL — the state-machine half is asserted in `hooks/useAnalyze.test.ts`; the airplane-mode-mid-flight procedure is ⏳ MANUAL DEVICE TEST PENDING |
| RES-11 token expiry offline → read-only cached mode, no wipe | ⚠ PARTIAL — the branch is implemented and code-verified in `api/client.ts` + `store/AuthContext.tsx`; the device scenario is ⏳ MANUAL DEVICE TEST PENDING |
| RES-12 recovery: labels flip to ● Live on next fetch, no stuck state | ⏳ MANUAL DEVICE TEST PENDING |

None of RES-09..12 may be reported as passing. They are device scenarios and no device has run this app.

## Not done, deliberately

- **No offline write queue.** Still the P3 backlog item it always was. Writes are blocked and explained, never queued and silently replayed.
- **No offline analysis.** The chain is server-side by design.
