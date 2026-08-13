# Mobile Testing

Pragmatic scope (no Detox in 72h — documented):
- **Unit:** hooks + services (jest-expo): useAnalyze state machine (upload→progress→retry→result), offline persist config, api interceptors, network detection.
- **Manual matrix (scripted checklist):** device = the actual demo phone + 1 emulator (Pixel API 34). Rows below.
- **Security:** APK strings-scan for secrets (ST-60); SecureStore usage assertion; cleartext config check.
- **Demo build verification:** Expo Go run-through + EAS APK install test on demo phone.
Bug bar: P0 screens crash-free through matrix ×2 consecutive runs before demo sign-off.

## Automated suite as built — 11 files, 90 tests, all passing (2026-08-14)

`npm --prefix mobile test` (jest-expo). `npm --prefix mobile run typecheck` (`tsc --noEmit`) is clean.

| File | Tests | Covers |
|---|---|---|
| `src/api/client.test.ts` | 16 | bearer header, `X-Request-Id` incl. the non-Hermes fallback, single-flight refresh under concurrent 401s, one replay only, rotated token stored before the access token is published, **refusal clears the credential / transport failure does not**, `Retry-After` parsing, the full `toApiError` taxonomy, envelope unwrapping |
| `src/api/session.test.ts` | 8 | access token memory-only, refresh token SecureStore-only, SecureStore failures swallowed to null, session-lost event bus |
| `src/hooks/useAnalyze.test.ts` | 23 | every stage transition, observed progress, cancel (abort + orphaned run), retry re-sending the same compressed bytes, and each of the seven failure classes against the exact envelopes `middleware/uploadImage.js` emits |
| `src/screens/scan/AnalyzingScreen.test.tsx` | 5 | staged live-region copy, determinate-only progress, the cancel confirmation, and the per-kind failure panel incl. the `Retry-After` wait sentence |
| `src/hooks/useGeolocation.test.ts` | 11 | the failure taxonomy — services off vs. refusal vs. can't-ask-again vs. timeout vs. provider error vs. outside-India — plus six-decimal rounding, the boundary case, and late-fix discard after `clear()` |
| `src/hooks/useOnlineManager.test.ts` | 5 | NetInfo → React Query online manager, `isInternetReachable ?? isConnected`, the `known` flag before the first event |
| `src/hooks/useAppStateRefetch.test.tsx` | 6 | fires only on the background→active edge, only when online, suppressible, registry exempt from invalidation |
| `src/hooks/useOfflineWriteGuard.test.tsx` | 3 | blocked only once NetInfo has answered; reason string |
| `src/hooks/usePrefetchRegistry.test.tsx` | 5 | once per session, skipped offline, retried on reconnect, list-then-crops sequencing, not marked warmed on failure |
| `src/components/domain/WhyTrace.test.tsx` | 4 | heterogeneous trace steps render whatever numbers they carry |
| `src/components/domain/IrrigationVerdictCard.test.tsx` | 4 | verdict copy, the three honesty labels, null-verdict branch |

`jest.setup.js` mocks exactly five native-only modules — `expo-secure-store` (an in-memory Map with `__reset`, so token custody stays assertable), `expo-localization`, `expo-constants`, `expo-speech`, AsyncStorage and NetInfo. The interceptors, the upload state machine and the offline configuration all run for real.

### Two mobile tests asserted impossible things, and were corrected

Both were written before the assertion was checked against the thing it describes:

- **`INDIA_BOUNDS` is a rectangle, not a border.** A test used Kathmandu as its example of a coordinate outside India — but Kathmandu (27.7, 85.3) sits *inside* the crude bounding box (lat 6–37.5, lon 68–97.5), as do Colombo and most of Bangladesh. The check being tested is agreement with the server's rectangle, not knowledge of where India ends, so the fixture is now Dubai and the comment says why.
- **A six-decimal rounding expectation written to five.** The hook rounds to six decimals; the expected value had five. Corrected to the six the code produces.

Neither was a product defect. Both were tests that would have passed for the wrong reason or failed for no reason, which is worse than no test.

## Manual device matrix — ⏳ NOT RUN

**No physical device and no emulator has run this app.** Every row below is pending; none may be reported as passed.

| # | Row | Status |
|---|---|---|
| 1 | Auth: register / login / refresh expiry / logout | ⏳ PENDING |
| 2 | Farm + crop CRUD incl. the land-ledger refusal | ⏳ PENDING |
| 3 | Camera flow happy path (printed leaf) | ⏳ PENDING |
| 4 | Gallery path | ⏳ PENDING |
| 5 | Permission-denied paths (camera, location), incl. can't-ask-again → settings | ⏳ PENDING |
| 6 | Upload failure mid-flight (airplane toggle) — RES-10 | ⏳ PENDING |
| 7 | Low-confidence result branch → retake tips + symptom-check CTA | ⏳ PENDING |
| 8 | Symptom checklist offline | ⏳ PENDING |
| 9 | Weather/irrigation honesty labels (simplified mode, `ENGINE_DEFAULT`, freshness) | ⏳ PENDING |
| 10 | Market chart + dated freshness | ⏳ PENDING |
| 11 | Language switch full-app sweep (hi↔en), Devanagari rendering on a low-end handset | ⏳ PENDING |
| 12 | TTS readout, incl. the no-voice-pack branch | ⏳ PENDING |
| 13 | Offline matrix RES-09..12 (cold start, mid-flight drop, token expiry offline, recovery) | ⏳ PENDING |
| 14 | Back-button behaviour per stack + the Analyzing block | ⏳ PENDING |
| 15 | Text scale 1.3× | ⏳ PENDING |
| 16 | ST-60 APK strings scan on a built artefact | ⚠ BLOCKED — no APK has been built |
| 17 | EAS APK install on the demo phone | ⚠ BLOCKED — no APK has been built |

The bug bar (P0 screens crash-free through the matrix ×2 consecutive runs) therefore has **zero runs against it**.

## Not done, deliberately

- **No Detox / no E2E on device.** Unchanged from the plan.
- **No voice intent-matcher unit test.** The plan listed one; there is no intent matcher on this surface, because STT does not ship (technology-decision.md). The web's matcher tests still cover the shared intent vocabulary.
- **No test drives `expo-image-manipulator`.** It has no JS-side implementation under `jest-expo`; the compression parameters are code-verified against the server constants they mirror.
- **No `AuthContext` end-to-end test.** The bootstrap branches are code-verified; the pieces they call (`refreshSession`, SecureStore custody, NetInfo) are each covered.
