# Mobile Authentication

Same server contract (docs/api/authentication.md); client specifics:
- Refresh token: **expo-secure-store** (Android Keystore-backed) — never AsyncStorage. Access token in JS memory only.
- Bootstrap: app start → SecureStore refresh present → /auth/refresh → session; absent/failed → AuthStack.
- Rotation handled transparently by interceptor (single-flight; queued requests replay).
- Logout: POST /auth/logout → SecureStore clear → Query cache clear (privacy on shared devices) → AuthStack.
- Reuse-detection response (family revoked, 401 on refresh): forced re-login with localized explanation ("सुरक्षा कारण से दोबारा लॉगिन करें").
- No biometric gate in MVP (P3: expo-local-authentication wrap of SecureStore read).
- No auth deep links; no tokens in links/logs; screenshots of auth screens contain no secrets by design.
