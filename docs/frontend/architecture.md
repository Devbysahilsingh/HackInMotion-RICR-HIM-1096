# Web Frontend Architecture

Stack: React 18 + Vite + TypeScript · TailwindCSS · React Router · **TanStack React Query** (server state) + light Context (auth session, language) — no Redux (server-state-dominant app; Query's caching/freshness model IS our UX model) · react-i18next · axios instance · Recharts (market/trend charts, per dataviz conventions).

```
web/frontend/src/
├── api/            # axios instance (interceptors: auth header, refresh-on-401 single-flight, requestId), typed endpoint fns
├── components/     # ui/ (Button, Card, Badge, FreshnessDot, PriorityChip, EmptyState, ErrorState, Skeleton)
│                   # domain/ (CropCard, FeedItem, WhyTrace, ConfidenceBar, TrendChart, RiskStrip, ...)
├── pages/          # route components (routes.md)
├── hooks/          # useAuth, useLanguage, useVoice, useFarm(s), useDashboard...
├── i18n/           # i18next init → imports shared/i18n resources
├── lib/            # formatters (Intl), constants re-exports from shared/
└── styles/
```
Patterns: Query keys per resource w/ invalidation on mutations; every page renders one of {data, skeleton-loading, designed-empty, designed-error(+retry), offline-cached} — a `<QueryBoundary>` wrapper standardizes it (no blank screens, by construction); freshness metadata from API rendered by `<FreshnessDot>` everywhere; forms: react-hook-form + zod resolvers (same schemas as backend via shared/schemas where practical).
Auth/session: access token in memory; silent bootstrap via /auth/refresh (cookie) on load; 401 → single-flight refresh → replay; refresh fail → login redirect preserving intent URL.
