# Mobile Testing

Pragmatic scope (no Detox in 72h — documented):
- **Unit:** hooks + services (jest-expo): useAnalyze state machine (upload→progress→retry→result), voice intent matcher, offline persist config, api interceptors (mocked axios).
- **Manual matrix (scripted checklist, run Day 2 eve + Day 3):** device = the actual demo phone + 1 emulator (Pixel API 34). Rows: auth (register/login/refresh-expiry/logout), farm+crop CRUD, camera flow happy path, gallery path, permission-denied paths, upload failure mid-flight (airplane toggle), low-confidence result branch, symptom checklist offline, weather/irrigation labels, market chart, language switch full-app sweep (hi↔en), TTS readout, offline matrix (docs/mobile/offline-strategy.md), back-button behavior, text-scale 1.3×.
- **Security:** APK strings-scan for secrets (ST-60); SecureStore usage assertion; cleartext config check.
- **Demo build verification:** Expo Go run-through + EAS APK install test on demo phone (Day 3 morning — buffer for EAS queue).
Bug bar: P0 screens crash-free through matrix ×2 consecutive runs before demo sign-off.
