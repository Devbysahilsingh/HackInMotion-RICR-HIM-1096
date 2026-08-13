# Mobile Authentication

Same server contract (docs/api/authentication.md); client specifics:
- Refresh token: **expo-secure-store** (Android Keystore-backed, `keychainAccessible: AFTER_FIRST_UNLOCK`, key `him1096.refreshToken`) — never AsyncStorage, because the Query cache lives there in plaintext. Access token in JS memory only.
- Bootstrap: app start → SecureStore refresh present → **NetInfo check** → online: /auth/refresh → /auth/me → session; refused → AuthStack. Absent token → AuthStack.
- Bootstrap **offline** (RES-11): the refresh is *not attempted*, so nothing can be refused and the stored credential survives. The app opens on the persisted cache with `sessionUnverified` set (notice `mobile:offline.sessionUnverified`); writes stay blocked by the offline guard, and the refresh runs for real on the next NetInfo reconnect — resolving to a live session or, only then, to a signed-out state with the cache cleared.
- Rotation handled transparently by interceptor (single-flight; queued requests replay). No cookie exists on this platform, so the refresh token travels in the request body — a shape the API supports on every route that takes one.
- Logout: POST /auth/logout → SecureStore clear → Query cache clear (privacy on shared devices) → AuthStack.
- Reuse-detection response (family revoked, 401 on refresh): forced re-login with localized explanation ("सुरक्षा कारण से दोबारा लॉगिन करें").
- No biometric gate in MVP (P3: expo-local-authentication wrap of SecureStore read).
- No auth deep links; no tokens in links/logs; screenshots of auth screens contain no secrets by design.

## The offline cold start, as built

Two independent guards, at two different layers:

1. **Before the attempt — `store/AuthContext.tsx`.** Bootstrap is held until `useIsRestoring()` is false, so the offline branch can actually see a rehydrated profile. It then reads the SecureStore token; absent → `anonymous`. Present → `NetInfo.fetch()` (`isInternetReachable ?? isConnected ?? false`, defaulting to *online* when NetInfo itself throws). Offline: **nothing is sent**, so nothing can be refused, so the credential survives. The cached `{user}` is read from `queryKeys.session()`, `sessionUnverified` is set, and status becomes `authenticated`.
2. **After a failed attempt — `api/client.ts`.** `refreshSession()` clears the stored token **only when the server actually answered** (`error.response != null`). A timeout, a dropped socket or a DNS failure returns null and leaves the credential alone. Which *kind* of 4xx it was is still never exposed to the caller, so a revoked family, an expired token and an unknown one remain indistinguishable — the security property is intact.

`sessionUnverified` is not a one-shot. While it is set, a second effect subscribes to NetInfo and re-runs `resumeOnline()` on the first online event. Only if the server **refuses** is the session destroyed (access token nulled, SecureStore cleared, `queryClient.clear()`). If the device is still unreachable it stays put and waits — nothing on that path may destroy the credential. The flag surfaces as the `session-unverified-notice` on the settings screen.

There is a third branch: refresh succeeded but `/auth/me` did not. That also opens on the cache with `sessionUnverified` set rather than bouncing a farmer to a login form over one failed read.

**Logout always ends locally signed out.** `authApi.logout()` is attempted and its failure deliberately swallowed — the route sits behind `requireAuth`, and a stranded server-side refresh token expires on its own. The `finally` block nulls the access token, clears SecureStore, drops the user, clears `sessionUnverified` and calls `queryClient.clear()`; a shared handset is the assumed case and the persisted cache holds farms, prices, health history and the profile.

**Session loss is an event, not a navigation.** `api/session.ts` exposes `onSessionLost`/`emitSessionLost('refresh_failed' | 'logout')`; the interceptor emits, `AuthContext` listens, `RootNavigator` reads `status`. No auth module holds a navigator reference.

### Residual gap — stated precisely

A **captive portal** still ends the session. NetInfo may report the device online, and the portal answers the refresh request with an HTTP response of its own (a redirect or a login page), which `error.response != null` correctly cannot distinguish from our API saying no. Dead DNS and dropped sockets no longer end the session — those produce no response at all.

⚠ **Doc/code drift found and left alone:** the header comment in `mobile/src/store/AuthContext.tsx` still says "`refreshSession()` cannot tell a refusal from an unreachable server, and it clears the stored credential on either", and describes closing that gap as future work. `api/client.ts` already closes it. The comment predates the fix; the code is the truth and this document follows the code.

## Verification status

| Item | Status |
|---|---|
| Access token memory-only, refresh token SecureStore-only, never logged | ✔ COMPLETE — `mobile/src/api/session.test.ts` (8 tests) |
| Single-flight refresh, one replay, no double presentation of a rotated token | ✔ COMPLETE — `mobile/src/api/client.test.ts` (16 tests) |
| Refusal clears the credential; transport failure does not | ✔ COMPLETE — asserted in `client.test.ts` |
| Bootstrap branches (absent / offline / online / me-failed) | ⚠ PARTIAL — code-verified; no test drives `AuthContext` end to end |
| Reuse-detection forced re-login copy | ⚠ PARTIAL — the 401 path is covered; the server-side family revocation is a backend test (ST-01..05) and the on-screen result is ⏳ MANUAL DEVICE TEST PENDING |
| RES-11 on a handset (airplane mode, cold start, reconnect) | ⏳ MANUAL DEVICE TEST PENDING |
| Login/register/refresh-expiry/logout on a real device | ⏳ MANUAL DEVICE TEST PENDING |
