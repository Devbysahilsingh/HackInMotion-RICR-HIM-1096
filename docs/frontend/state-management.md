# State Management

| State class | Tool | Notes |
|---|---|---|
| Server data (farms, crops, feed, weather, market, health, registry) | React Query | staleTime: dashboard 60s, registry 7d, weather/market 5min (server cache governs true freshness — client TTLs are UX smoothing); invalidation map per mutation documented in api/ layer |
| Auth session | AuthContext (user, accessToken in memory, status) | bootstrap via refresh; interceptor wiring |
| Language | i18next, device preference | persisted localStorage (`him1096.language`); account language adopted only when the device has no choice yet — there is no `PATCH /users/me`, so it is never written back |
| Forms | react-hook-form local | zod resolvers |
| Ephemeral UI | component state | no global UI store |
No Redux/Zustand: justified — nearly all state is server state with caching semantics (Query) + two tiny contexts; adding a store would be ceremony. Recorded ADR-014.
