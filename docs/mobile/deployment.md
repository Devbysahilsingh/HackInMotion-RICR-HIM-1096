# Mobile Deployment

- **Demo primary: Expo Go** — instant, free, on-device; requires dev machine + phone network path (same Wi-Fi or `--tunnel`); rehearsed both; demo phone pre-loaded.
- **Backup/deliverable: EAS Build Android APK** (free tier; queue can be slow — trigger Day 3 morning, not evening). Production profile: API base = production Render URL, dev flags off. APK sideloaded on demo phone + link in README (Drive/GitHub release).
- **Config:** app.json — name (OD-4), icon/splash (assets/), android package id `in.him1096.krishisaarthi` (adjust to final name), locales en+hi, permissions minimal (CAMERA, ACCESS_FINE_LOCATION optional-flow, RECORD_AUDIO only if STT ships — P2 decision).
- **STT dev-build decision (voice doc):** if pursued, `eas build --profile development` Day 1; abandoned cleanly otherwise (TTS unaffected).
- **Not in scope (stated):** Play Store submission (review timelines >72h), iOS (future).
- **Env:** EXPO_PUBLIC_API_URL only; no secrets (mobile/security.md).
