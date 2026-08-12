# Mobile API Integration

Same `/api/v1` contract as web — no mobile-specific endpoints. Client policies:
- **Auth:** access token SecureStore-backed memory; 401 → single-flight refresh (SecureStore refresh token) → replay; refresh fail → AuthStack. Logout wipes SecureStore.
- **Timeouts/retry:** 15s default, 45s upload; GET retries ×2 (backoff) on network errors, mutations never auto-retry (duplication guard) except idempotent-keyed upload.
- **Pagination:** infinite-scroll via Query useInfiniteQuery (feed/history endpoints' page params).
- **Upload:** multipart with progress events; compress first (≤1600px/85% via expo-image-manipulator); idempotency uuid per attempt (server dedupe field reserved P3); failed upload → retained local draft + retry CTA.
- **Freshness/offline:** persisted Query cache; NetInfo offline ⇒ serve cache + ● Cached badges + disabled writes with explanation; reconnect ⇒ refetch active queries.
- **Versioning:** base URL env-configured; /api/v1 pinned; server messageKeys decouple copy from app releases (i18n resources ship in-app; new keys→fallback en handled).
