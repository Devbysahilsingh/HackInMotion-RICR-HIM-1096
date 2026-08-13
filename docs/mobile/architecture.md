# Mobile Architecture

Stack: Expo SDK 54 · React Native 0.81 · React 19 · TypeScript · React Navigation 7 (bottom tabs + native stacks) · TanStack Query 5 + `PersistQueryClientProvider`(AsyncStorage) · axios instance (same interceptor pattern as web; SecureStore refresh) · i18next (shared/i18n via metro watchFolders) · expo-camera/image-picker/image-manipulator/location/secure-store/speech/localization.

```
mobile/src/
├── api/          # axios instance + interceptors, typed endpoints, query client, session (token custody)
├── components/   # ui/ primitives (Pressable 48px targets, FreshnessDot, PriorityChip, ...) + domain/ (FeedItemCard, CropCard, WhyTrace, AnalysisResultView, IrrigationVerdictCard, ...) + AppErrorBoundary + OfflineBanner + QueryBoundary
├── config/       # env.ts — the API base URL, and nothing else
├── hooks/        # useAnalyze (upload+progress+retry state machine), useGeolocation, useOnlineManager, useOfflineWriteGuard, useAppStateRefetch, usePrefetchRegistry, useApiError, useCropNames
├── i18n/         # init + messageKey resolution (resources come from shared/i18n)
├── navigation/   # RootNavigator (Auth stack | Main tabs) → four feature stacks
├── screens/      # per screen-map.md — one directory per tab, plus intro/ and settings/
├── services/     # image.ts (compress), voice.ts (TTS)
├── store/        # AuthContext + LanguageContext (no Redux — ADR-014)
└── theme/        # design tokens (palette transcribed from the web app)
```
Data flow identical to web: screens → Query hooks → api layer → backend. Zero direct MongoDB/FastAPI/external-API access; zero embedded secrets (policy + APK scan test). Offline: persisted Query cache hydrate + NetInfo-driven freshness banners (docs/offline). Errors: same messageKey rendering; global error boundary screen (localized, restart CTA).

## As built — what changed from the plan

**There is no `services/camera.ts`, `services/location.ts` or `services/offline.ts`.** Camera capture belongs to the screen that owns the viewfinder, location to `hooks/useGeolocation.ts`, persistence config to `api/queryClient.ts`. Three service modules that would each have had one caller were not created; `services/` holds the two pieces of genuinely reusable non-React logic (`image.ts`, `voice.ts`).

**There is no `utils/`.** What would have gone in it lives in `shared/client/` and is used by both surfaces.

**`store/` holds two contexts, not four.** `AuthContext` owns the session and the bootstrap; `LanguageContext` owns the language and its `PATCH /users/me` sync. The signed-in **user profile is not a third store** — it lives in the React Query cache at `queryKeys.session()`, so it rides the existing persister, is dropped by the same `queryClient.clear()` on logout, and lets an offline cold start greet the farmer by name.

**Three app-global cache behaviours are mounted once**, in a `NetworkBridge` component inside `AuthProvider` that renders `null`: `useOnlineManager`, `useAppStateRefetch`, `usePrefetchRegistry`.

**Boot order is load-bearing.** `App.tsx` awaits the stored language, initialises i18n, and only then constructs the query client and mounts the providers. Until that resolves it renders a wordless, brand-coloured splash — there is no language yet, so there is nothing honest to say. A Hindi speaker never sees a frame of English.

## `shared/` and Metro — the one non-default piece of bundler config

The canonical translations and wire types live above this package root (ADR-018 — one source, no per-surface fork), and Metro refuses to serve files outside the project root unless they are watched explicitly. `mobile/metro.config.js`:

- `watchFolders = ['../shared']`
- `resolver.nodeModulesPaths = [mobile/node_modules]` — `shared/` has no `node_modules` of its own, so anything it imports must resolve out of this package
- `resolver.extraNodeModules = { '@shared': ../shared, '@': ./src }` — spelled the same way as in `tsconfig.json`, `jest.config.js` and the web's vite config, so an import line can be moved between surfaces unchanged. Declared explicitly rather than relying on Metro's tsconfig-paths support, which is one line versus an experiment that can change shape.

**`disableHierarchicalLookup` is deliberately NOT set, and that is a defect fix rather than an omission.** The usual monorepo recipe turns it on to stop a second copy of React being resolved from a parent directory — but this repo root carries only lint and formatting tooling, no React and no React Native, so there is nothing to shadow. Turning it on **breaks the build**: Expo's own transitive dependencies (`expo-asset`, `expo-font`, …) are installed nested under `node_modules/expo/node_modules`, and a flat-only resolver cannot see them. It was set during Phase 6, it broke, and the reasoning is now a comment in the file so nobody re-adds it from a blog post.

Jest needs the same three aliases plus one more: `^@babel/runtime/(.*)$ → mobile/node_modules/@babel/runtime/$1`, because the helpers Babel injects into a transpiled `shared/` module would otherwise resolve from `shared/` and find nothing. The alternative was giving the repo root a dependency tree it does not need (ADR-019: apps keep their own).

## What moved into `shared/` when this client landed

Five modules that had been web-only, so both surfaces read one copy instead of two transcriptions:

| Module | Contents |
|---|---|
| `shared/types/api.ts` | every wire type and enum (`web/frontend/src/api/types.ts` is now a one-line re-export) |
| `shared/client/errors.ts` | `ApiError`, `isApiError`, `isApiErrorBody`, `isRetryable`, `retryAfterSeconds` |
| `shared/client/queryKeys.ts` | the query-key registry and `STALE_TIME` tiers |
| `shared/client/units.ts` | acre-equivalent land-ledger arithmetic |
| `shared/client/format.ts` | Intl date/number/currency formatting, `localizedName` |

That move is what surfaced the five wire-type drifts recorded in the Phase 6 entry of `docs/development/implementation-log.md`: a transcription with one consumer is unfalsifiable, and the web's fixtures had been wrong the same way the types were, so the tests were green against a contract the server does not implement.

## Boundaries that hold

- Zero business logic on the client. No engine, no threshold, no NPK number, no agronomic string is computed here — `AXIS_VALUES` in the symptom screen is the one transcribed constant, and it is a UI vocabulary, not a decision.
- Zero direct access to MongoDB, the ml-service, Cloudinary or any external provider. Everything goes through `/api/v1`.
- One secret-free public value in the bundle: the API base URL.
- `eslint.config.js` gained a mobile block: RN globals (Hermes timers/fetch, Metro `require`, bundler-injected `__DEV__`), `react-hooks` rules, and **no** `react-refresh/only-export-components` — that rule describes Vite's fast-refresh boundary, not Metro's.
