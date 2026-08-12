# ADR-014 · TanStack Query + light Context; no Redux/Zustand
**Status:** Accepted · 2026-08-12
**Decision:** server state via React Query (both surfaces; mobile + AsyncStorage persistence), auth/language via small Contexts, forms via react-hook-form.
**Reason:** the app is server-state-dominant; Query's cache/staleness model directly implements our freshness UX; a global store would duplicate it as ceremony.
**Trade-offs:** none material at this scale; revisit only if complex client-only state emerges (none planned).
