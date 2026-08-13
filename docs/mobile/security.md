# Mobile Security

- **Storage:** refresh token SecureStore only; Query cache (AsyncStorage) holds non-credential user data — cleared on logout; no secrets anywhere in bundle (policy: EXPO_PUBLIC_* = public by definition; only API base URL lives there; verified by strings-scan of built APK — ST-60).
- **Network:** HTTPS only (Render/Vercel TLS); Android cleartext disabled (default); certificate pinning skipped (free-tier cert rotation would brick the app — documented decision, ADR note).
- **Deep links:** whitelisted internal screens; parameters validated; no auth/token links.
- **Permissions:** camera/location requested in-context, rationale strings localized, all features degrade when denied (picker fallback, manual location, tappable intents). Microphone is not requested at all — see below.
- **Debug hygiene:** dev menu/dev-client never in judge hands; EAS production profile builds APK with `__DEV__` off; console logs stripped via babel in prod.
- **Input validation:** client-side mirrors for UX; server remains sole authority (unchanged).
- **Privacy:** photos uploaded only on explicit user action; gallery access via system picker (scoped); analytics: none (no trackers — stated in README privacy section).
- Same zero-tolerance rules: no bypasses, no hidden modes, demo build = production security behavior.

## As built (Phase 6)

**Token custody.** Access token in JS memory only (`mobile/src/api/session.ts`); refresh token in `expo-secure-store` (Android Keystore-backed), never AsyncStorage. Neither is logged, rendered, or written to the Query cache. There is no cookie on this platform, so the refresh token travels in the **request body** — a shape `backend/src/routes/auth.js` supports on every route that accepts one. This is a platform difference, not a relaxation: the server contract is unchanged and the token is at rest in the Keystore rather than in a cookie jar.

**Single-flight refresh (`mobile/src/api/client.ts`).** Concurrent 401s share one refresh call and get one replay. This is a security property, not an optimisation: presenting a rotated refresh token twice is exactly what the server's reuse detector correctly treats as theft, and a fan-out of parallel refreshes on a flaky rural connection would revoke the whole family and sign the farmer out.

**A refusal ends the session; a transport failure does not.** `refreshSession()` clears the SecureStore token only when the server actually answered (`error.response != null`). A timeout, DNS failure or captive portal leaves the credential alone and returns null, and the app falls back to the cached read-only view (RES-11). The security story is intact because *which kind* of 4xx is still never distinguished for the caller — a revoked family, an expired token and an unknown one remain indistinguishable on the wire.

**Microphone.** `RECORD_AUDIO` is in `blockedPermissions` in `app.config.ts`, so it cannot be acquired transitively by a dependency. The shipped voice feature is text-to-speech only (technology-decision.md).

**Release-build console strip.** `mobile/babel.config.js` applies `transform-remove-console` when `NODE_ENV`/`BABEL_ENV` is `production`, keeping only `console.error` — a crash report with nothing in it helps nobody, and by convention it carries no user data.

**The only `__DEV__`-gated affordance** is showing the API base URL on the settings screen (`mobile/src/config/env.ts` exports `IS_DEV` for exactly that). It changes no security behaviour.

**ST-60 client half — the tool exists, the scan has not run.** `scripts/scan-apk-strings.mjs` (`npm run scan:apk <file.apk>`) reads the APK as a zip with Node's zlib rather than shelling out to `strings`/`unzip` (absent on Windows), decompresses the members — `assets/index.android.bundle` above all — and searches for credential *shapes* rather than a denylist of this project's keys, so a secret nobody thought to list still matches. A finding reports the member, the byte offset and the **pattern name**; the matched text is never printed. It also accepts `--bundle <file>` for a Metro bundle. ⚠ **BLOCKED:** no APK has been built, so the scan has never been executed against a real artefact. The ST-60 row in docs/testing/test-matrix.md says so.

## Status of each control

| Control | Status |
|---|---|
| Refresh token in SecureStore, access token in memory | ✔ COMPLETE — asserted by `mobile/src/api/session.test.ts` and `client.test.ts` |
| Single-flight refresh, one replay, no double presentation | ✔ COMPLETE — asserted by `client.test.ts` |
| Query cache cleared on logout | ✔ COMPLETE — code-verified |
| Console stripped in release builds | ⚠ PARTIAL — the babel plugin is configured and unit-testable only by building; no release bundle has been produced |
| No secrets in the bundle | ⚠ BLOCKED — policy holds by construction (one `EXPO_PUBLIC_*` value, the base URL), scanner written, **APK scan not run** |
| Android cleartext refused in release | ⚠ PARTIAL — the app does not opt out of the platform default, which is the whole mechanism; ⏳ MANUAL DEVICE TEST PENDING to observe it |
| Permission denial degrades every feature | ⚠ PARTIAL — branches implemented and code-verified; the OS sheets themselves are ⏳ MANUAL DEVICE TEST PENDING |
| Certificate pinning | not done, deliberately (unchanged decision above) |
| Deep links whitelisted | see navigation.md — no `linking` config ships, so there is no deep-link surface to whitelist |
