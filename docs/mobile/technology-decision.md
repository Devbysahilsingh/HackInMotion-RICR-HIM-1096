# Mobile Technology Decision

## Decision: React Native + Expo (managed workflow), Android target

| Criterion | RN + Expo | RN CLI | Flutter |
|---|---|---|---|
| Team knowledge reuse (React/JS, 1–2 devs) | ✅ maximal (components, Query, i18next, axios patterns shared conceptually with web) | ✅ same language, more native ceremony | ❌ Dart from zero — disqualifying at this team size |
| Camera / gallery / GPS / secure storage / TTS | ✅ expo-camera, image-picker, location, secure-store, speech — managed modules, no native code | manual native linking | good plugins, new ecosystem to learn |
| Voice STT | ⚠️ needs dev build (expo-speech-recognition) — decision point; **resolved intents-only, see below** | same lib works | plugin exists |
| Demo path | ✅ **Expo Go instant on-device demo** + EAS free Android APK builds (queue delays possible — build early) | local Gradle builds (slow, env setup) | Gradle builds |
| Offline/cache | ✅ AsyncStorage + Query persist | same | same concept |
| Hindi i18n | ✅ same i18next + shared/i18n resources | same | different stack (intl) |
| Risk profile | lowest for this team | medium (native toolchain time-sink) | highest (language + ecosystem) |

Trade-offs accepted: Expo managed limits native module choice (STT dev-build caveat — mitigated with planned fallback); Expo Go demo depends on dev machine + phone on same network or tunnel (rehearsed; EAS APK as backup). ADR-015.

## As built (Phase 6, 2026-08-14)
Expo **SDK 54** · React Native **0.81.5** · React **19.1.0** · TypeScript ~5.9 · React Navigation 7 (bottom tabs + native stacks) · TanStack Query 5 + `@tanstack/query-async-storage-persister` · i18next 25 / react-i18next 15 · axios 1.19. Expo modules taken: camera, image-picker, image-manipulator, location, secure-store, speech, localization, constants, linking, status-bar. Exact versions: `mobile/package.json`. No native module outside the Expo managed set, so the Expo Go demo path in deployment.md survives.

The app was **written** on SDK 57 and **migrated down** to SDK 54 the same day — see the next section for why, and `docs/development/implementation-log.md` for what the migration touched (no application source file, and no feature).

## SDK version decision — RESOLVED: pinned to Expo SDK 54, to the demo handset

**Decision.** `mobile/` targets **Expo SDK 54** (`expo@~54.0.36`), not the current SDK.

**Reason.** The demo handset has **Expo Go 54.0.8** installed and will not be upgraded. Expo Go runs only projects built against its own SDK, so the project's SDK is not a free choice — it is determined by the client already on the device. Phase 6 was implemented on SDK 57 / RN 0.86.2 / React 19.2.3, which that Expo Go refuses to load; keeping it would have meant the demo path in `deployment.md` (Expo Go over LAN, ADR-015's stated advantage) had no device behind it, with the EAS APK backup also unavailable (that build is `⚠ BLOCKED` on the Render deploy and an Expo account). A framework whose chosen benefit is an instant on-device demo has to match the device.

**How the versions were chosen.** Every pin came out of `expo@54.0.36`'s own `bundledNativeModules.json`, not from guesswork or from decrementing a major. SDK 57 versions the `expo-*` modules in lockstep at `57.x`; SDK 54 versions them independently, which is why the module numbers look unrelated to each other and to the SDK (`expo-camera` ~17.0.10, `expo-location` ~19.0.8, `expo-status-bar` ~3.0.9). Toolchain moved with them: `jest-expo` ~54.0.17, `babel-preset-expo` ~54.0.12, TypeScript ~5.9.2, `@types/react` ~19.1.17, `react-test-renderer` 19.1.0, i18next ^25.2.1 / react-i18next ^15.5.2.

**Cost accepted.**
- SDK 54 is **behind current**. The project forgoes whatever later SDKs offer and will accumulate that gap for as long as the pin holds.
- The pin is to **a device, not a date**. If that handset's Expo Go changes — reinstall, new phone, store update — the pin moves with it, and the app must be **re-tested against whatever Expo Go the device then has**. Nothing about this migration was verified on a phone (see below), so that re-test is the same unrun work either way.
- Dependency changes are no longer free-hand: anything added must resolve against SDK 54, checked with `npx expo install --check` and `npx expo-doctor`.

**What it did *not* cost.** No application source file under `mobile/src/` changed, and no Phase 6 feature was dropped. The two APIs that could plausibly have broken did not: `expo-image-manipulator`'s context API (`manipulate()` → `renderAsync()` → `saveAsync()`) exists in 14.0.8, and the `expo-camera` surface the screens use matches 17.x.

**Still true:** no APK has been built and **no physical device has run this app**, on either SDK. The pin is reasoned from the handset's stated Expo Go version, not from an observed successful launch.

## STT decision — RESOLVED: intents-only, no microphone
The Day-1 decision point above is closed. **Speech input does not ship**; `RECORD_AUDIO` is listed in `blockedPermissions` in `mobile/app.config.ts` so the manifest cannot acquire it transitively. The reasoning is written where the code is (`mobile/src/services/voice.ts`) and summarized in `mobile/README.md`:
- **Dev build** (`expo-speech-recognition`) forfeits the Expo Go demo route deployment.md names as primary — trading the demo path for an input mode.
- **Groq proxy** requires `POST /api/v1/voice/transcribe`, which does not exist in `backend/src/routes/`. Building it is a server feature and no TODO approved one.
- **Intents-only ships.** `docs/voice/voice-interface.md`'s intent layer is input-agnostic by design ("voice, tap, or typed text"), so the intents remain reachable as large tappable targets — an accessibility feature in its own right for a low-literacy user.

Voice **out** ships: `expo-speech`, device engine, works in Expo Go and offline, `hi-IN`/`en-IN` matched to the UI language, and the control hides itself when the handset reports no voice pack rather than presenting a button that silently does nothing. ADR-015 is unchanged by this — it chose the framework, not the input modes.

## Alignment rule
Mobile duplicates NO business logic: same REST contract, same shared/i18n, same shared/constants; UI layer is intentionally NOT a shrunken web port (camera-first, thumb-reach navigation, larger type).

**As built, the rule was strengthened rather than merely honoured.** Five modules that had been web-only were moved up into `shared/` when the second client landed, so both surfaces read one copy: `shared/types/api.ts` (wire types), `shared/client/errors.ts` (`ApiError` + envelope guard), `shared/client/queryKeys.ts` (query-key registry), `shared/client/units.ts` (acre-equivalent land ledger), `shared/client/format.ts` (Intl date/number formatting). `web/frontend/src/api/types.ts` is now a one-line re-export so the ~40 existing `@/api/types` imports keep resolving. That move is what surfaced the five wire-type drifts recorded in `docs/development/implementation-log.md` — a second consumer of a transcription is how you find out the transcription was wrong.
