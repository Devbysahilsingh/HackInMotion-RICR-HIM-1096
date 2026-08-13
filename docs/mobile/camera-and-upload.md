# Camera & Upload Workflow (hero flow)

```
Scan tab → crop pick (auto if single) →
permission check → granted: expo-camera full-screen (capture guidance overlay:
  "फोटो पत्ती के पास से लें" / fill frame, steady, natural light) | denied: gallery-only + settings hint
capture/gallery → preview (retake/confirm) →
expo-image-manipulator: resize ≤1600px, JPEG q85 (typ. 3–8MB → 200–500KB: low-bandwidth
  requirement) →
upload multipart + progress bar → Analyzing (staged honest copy) →
Result | failure: reason-classed retry (network → retry keeps image in memory; validation → guidance)
```
Details: permissions requested in-context with plain-language rationale (localized), never on app launch; camera settings: autofocus, rear camera default; EXIF stripped server-side regardless (client strip too via manipulator output); gallery path validates type client-side for UX (server remains authority); upload cancellation supported; low-storage/photo-too-dark edge messages designed. Result caching: analysis response cached by log id (offline re-view). Security: nothing persisted outside app sandbox; drafts (P3) in app-private storage.

## As built (Phase 6)

### Compression — `mobile/src/services/image.ts`

| Constant | Value | Why |
|---|---|---|
| `MAX_EDGE_PX` | 1600 | the same long edge the server re-encodes to (`MAX_STORED_EDGE_PX`), so this discards only bytes the server would have discarded anyway |
| `JPEG_QUALITY` | 0.85 | the documented quality floor for a leaf lesion to stay legible |
| `MAX_UPLOAD_BYTES` | 8 MiB | mirrors the server's `MAX_UPLOAD_BYTES` so a doomed upload fails on the device in milliseconds instead of after a minute of radio time |

Only the **long** edge is constrained, and only **downward** — enlarging a small photo would invent detail the model would then read as real. Output is always JPEG.

This is a bandwidth optimisation and a privacy courtesy, **never the authority**: the server re-reads magic bytes, re-encodes and strips EXIF regardless of what arrives (ST-30).

### The upload state machine — `mobile/src/hooks/useAnalyze.ts`

Stages: `idle → compressing → uploading → analyzing → done | failed`, each with its own i18n key (`mobile:upload.*`; `done` keeps a label because the screen is still writing to the cache and swapping screens, and a blank panel there reads as a hang).

**Nothing advances on a timer.** `compressing` ends when the manipulator resolves, `uploading` ends when axios reports every byte delivered (`onUploadProgress` crossing 1.0 flips the stage to `analyzing`), and `analyzing` is the real window while the server-side ml → gemini → rules conductor runs. A progress bar that moves without progress is a fabricated status (rule 7).

**The screen owns the bytes, not the request.** `prepareForUpload` runs once and its result is held in a ref, so `retry()` re-sends the *same* compressed file rather than sending the farmer back to the camera — this is the RES-10 requirement expressed in code. `cancel()` aborts the request and bumps a run id so a late rejection cannot overwrite the cancelled state. Unmounting aborts too: an upload that outlives its screen is radio time spent on a result nobody will read.

**Failures are classified, not merged** — `classifyAnalyzeFailure` is a pure function tested against the exact envelopes `backend/src/middleware/uploadImage.js` emits:

| kind | Trigger | `canRetrySameImage` | `needsNewPhoto` |
|---|---|---|---|
| `cancelled` | the farmer stopped it (no message shown) | yes | no |
| `network` | `NETWORK_ERROR` / `TIMEOUT` | yes | no |
| `rateLimited` | 429 (3/min, 10/day per user) | yes | no |
| `photoRejected` | `UPLOAD_ERROR` with a rule in `PHOTO_CONTENT_RULES` | no | **yes** |
| `prepareFailed` | the manipulator could not decode this file | no | **yes** |
| `server` | 5xx, or `UPLOAD_ERROR` whose rule is not a content verdict | yes | no |
| `rejected` | any other 4xx — deleted crop, bad request | no | no |

`NO_FILE` and `STORAGE_UNAVAILABLE` are deliberately **outside** `PHOTO_CONTENT_RULES`: neither says anything about the image and both can succeed on a second attempt with identical bytes. Asking a farmer to walk back to the field and re-shoot for a transfer that was merely truncated would be the app's mistake charged to them.

**429 names a wait only when the server named one.** `Retry-After` is parsed by the axios interceptor onto `ApiError.retryAfterSeconds` and passed through unchanged; a 429 with no header yields `null` and the screen says "wait a little" rather than inventing a duration (rule 7). Nothing retries automatically — an automatic retry against a burst limit only deepens the block.

**Deliberately free of React Query.** This is a one-shot imperative sequence with its own cancellation; a mutation wrapper would add a provider dependency to something the test suite should be able to drive on its own.

### Permissions

Requested **in context**, never on launch, each with a localized rationale, and every branch degrades:

| Permission | Used for | Denied → |
|---|---|---|
| `CAMERA` | photographing a leaf | gallery picker (`expo-image-picker`) + `Linking.openSettings()` from `mobile/src/screens/scan/CameraScreen.tsx` |
| `ACCESS_FINE_LOCATION` | placing a farm once | manual state/district entry, with the failure named — `unavailable` (services off / no provider), `denied`, `timeout`, `outside-india` are four different sentences, not one |

`RECORD_AUDIO` is in `blockedPermissions` — see technology-decision.md.

## Verification status

| Item | Status |
|---|---|
| Stage sequence, progress semantics, cancel, retry-reuses-bytes, all seven failure classes | ✔ COMPLETE — `mobile/src/hooks/useAnalyze.test.ts`, **23 tests** |
| Analyzing screen: staged live-region copy, determinate-only progress, cancel confirmation, per-kind failure panel | ✔ COMPLETE — `mobile/src/screens/scan/AnalyzingScreen.test.tsx`, **5 tests** |
| Geolocation failure taxonomy incl. the India-bounds refusal | ✔ COMPLETE — `mobile/src/hooks/useGeolocation.test.ts`, **11 tests** |
| Compression parameters | ⚠ PARTIAL — code-verified against the server constants; no test exercises `expo-image-manipulator` (it has no JS-side implementation under `jest-expo`) |
| Camera capture, preview/retake, gallery fallback, OS permission sheets | ⏳ MANUAL DEVICE TEST PENDING |
| Real end-to-end scan against `/crop-health/analyze` with a printed leaf | ⏳ MANUAL DEVICE TEST PENDING — the screens call the real endpoint, but no device has run the flow |
| Mid-flight connection drop (RES-10) on a handset | ⏳ MANUAL DEVICE TEST PENDING |

## Not done

- **No draft queue.** Still P3, as stated above. A failed upload keeps its compressed file for the life of the screen, not across a process death.
- **No client-side "photo too dark" check.** Designed, not implemented; the server's `UNREADABLE`/low-confidence branches carry it instead.
