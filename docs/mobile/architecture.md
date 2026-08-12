# Mobile Architecture

Stack: Expo SDK (current stable at implementation) · TypeScript · React Navigation (bottom tabs + native stacks) · TanStack Query + persistQueryClient(AsyncStorage) · axios instance (same interceptor pattern as web; SecureStore refresh) · i18next (shared/i18n via metro watchFolders) · expo-camera/image-picker/image-manipulator/location/secure-store/speech.

```
mobile/src/
├── api/          # axios + typed endpoints (mirror of web api layer contracts)
├── components/   # ui primitives (Pressable 48px targets, FreshnessDot, PriorityChip, ...) + domain (FeedItem, CropCard, WhyTrace, AnalysisResult...)
├── screens/      # per screen-map.md
├── navigation/   # RootNav (Auth stack | Main tabs), linking config (whitelisted routes only)
├── services/     # camera.ts (capture→compress→upload), voice.ts (TTS/STT), location.ts, offline.ts (persist config)
├── hooks/        # useAuth, useDashboard, useAnalyze (upload+progress+retry state machine)
├── store/        # AuthContext + language (matches web pattern; no Redux — ADR-014)
├── i18n/
└── utils/
```
Data flow identical to web: screens → Query hooks → api layer → backend. Zero direct MongoDB/FastAPI/external-API access; zero embedded secrets (policy + APK scan test). Offline: persisted Query cache hydrate + NetInfo-driven freshness banners (docs/offline). Errors: same messageKey rendering; global error boundary screen (localized, restart CTA).
