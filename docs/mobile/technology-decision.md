# Mobile Technology Decision

## Decision: React Native + Expo (managed workflow), Android target

| Criterion | RN + Expo | RN CLI | Flutter |
|---|---|---|---|
| Team knowledge reuse (React/JS, 1–2 devs) | ✅ maximal (components, Query, i18next, axios patterns shared conceptually with web) | ✅ same language, more native ceremony | ❌ Dart from zero — disqualifying at this team size |
| Camera / gallery / GPS / secure storage / TTS | ✅ expo-camera, image-picker, location, secure-store, speech — managed modules, no native code | manual native linking | good plugins, new ecosystem to learn |
| Voice STT | ⚠️ needs dev build (expo-speech-recognition) — planned decision point Day 1 (docs/voice) | same lib works | plugin exists |
| Demo path | ✅ **Expo Go instant on-device demo** + EAS free Android APK builds (queue delays possible — build early) | local Gradle builds (slow, env setup) | Gradle builds |
| Offline/cache | ✅ AsyncStorage + Query persist | same | same concept |
| Hindi i18n | ✅ same i18next + shared/i18n resources | same | different stack (intl) |
| Risk profile | lowest for this team | medium (native toolchain time-sink) | highest (language + ecosystem) |

Trade-offs accepted: Expo managed limits native module choice (STT dev-build caveat — mitigated with planned fallback); Expo Go demo depends on dev machine + phone on same network or tunnel (rehearsed; EAS APK as backup). ADR-015.

## Alignment rule
Mobile duplicates NO business logic: same REST contract, same shared/i18n, same shared/constants; UI layer is intentionally NOT a shrunken web port (camera-first, thumb-reach navigation, larger type).
