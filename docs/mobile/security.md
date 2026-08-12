# Mobile Security

- **Storage:** refresh token SecureStore only; Query cache (AsyncStorage) holds non-credential user data — cleared on logout; no secrets anywhere in bundle (policy: EXPO_PUBLIC_* = public by definition; only API base URL lives there; verified by strings-scan of built APK — ST-60).
- **Network:** HTTPS only (Render/Vercel TLS); Android cleartext disabled (default); certificate pinning skipped (free-tier cert rotation would brick the app — documented decision, ADR note).
- **Deep links:** whitelisted internal screens; parameters validated; no auth/token links.
- **Permissions:** camera/location/mic requested in-context, rationale strings localized, all features degrade when denied (picker fallback, manual location, tappable intents).
- **Debug hygiene:** dev menu/dev-client never in judge hands; EAS production profile builds APK with `__DEV__` off; console logs stripped via babel in prod.
- **Input validation:** client-side mirrors for UX; server remains sole authority (unchanged).
- **Privacy:** photos uploaded only on explicit user action; gallery access via system picker (scoped); analytics: none (no trackers — stated in README privacy section).
- Same zero-tolerance rules: no bypasses, no hidden modes, demo build = production security behavior.
