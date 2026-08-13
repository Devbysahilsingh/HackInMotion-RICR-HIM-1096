# Mobile Screen Map (MVP = P0/P1 rows)

| Screen | Priority | Content/states |
|---|---|---|
| LanguageIntro | P0 | हिंदी/English cards; 3 value slides; skippable |
| Login/Register | P0 | minimal fields, large inputs, offline notice |
| Dashboard | P0 | greeting + date (localized), feed list (PriorityChip, ack, speak button), crop cards row, pull-refresh, freshness dots, empty→"create farm" card |
| FarmList/FarmForm | P0 | GPS button (permission flow → manual district fallback), soil icons, unit picker |
| CropDetail | P0 | stage timeline, verdict cards (irrigation/health/fertilizer/market), tabs, "I irrigated" form |
| CropForm | P0 | registry picker w/ support badges + search, sowing date entry |
| Camera/Scan | P0 | permission flow, capture + gallery, crop pre-selected if single, compress→upload progress, retry |
| Analyzing | P0 | staged honest progress; cancel |
| AnalysisResult | P0 | verdict-first layout, source label, confidence bar, guidance sections, speak-aloud, history link, low-confidence branch → retake tips + SymptomChecklist CTA |
| SymptomChecklist | P1 | guided Q&A, works from cached registry offline |
| WeatherIrrigation | P0 | 7-day strip, risk badges, irrigation verdict + why-trace, simplified-mode label |
| Market | P0 | crop signals first, trend chart, dated freshness, nearby-mandi browser |
| HistoryList | P1 | health timeline (read-only mobile MVP) |
| CommunityAlerts | P2 | advisory cards |
| Settings | P0 | language, land unit, community consent, voice toggle, logout, about+disclaimers |
| ErrorBoundary/Offline states | P0 | designed, localized |
All screens: loading skeletons, designed empty/error, offline-cached rendering with age labels.

## As built — 24 screen files (23 navigator routes + the crop-detail tab host) ✔ COMPLETE

Every row above ships. Files under `mobile/src/screens/`; the four result branches live in `components/domain/AnalysisResultView.tsx`, shared by two screens.

| Screen file | Data source |
|---|---|
| `intro/LanguageIntroScreen` | none — first run only; three **stacked** slides, not a carousel |
| `auth/LoginScreen` | `useAuth().login`; validation deliberately looser than register so the form is not an account-existence oracle |
| `auth/RegisterScreen` | `useAuth().register`; 422 field errors mapped back onto fields |
| `home/DashboardScreen` | `GET /dashboard`; optimistic ack with rollback |
| `home/RecommendationDetailScreen` | **no `GET /recommendations/:id` exists** — it looks the item up across the cached `/dashboard` and `/recommendations?page=1` payloads and says so honestly when an older item is not on page 1 |
| `home/HistoryScreen` | `useInfiniteQuery` over `GET /crop-health/logs` (limit 20); rows deliberately omit `confidence`/`escalated` |
| `home/HistoryDetailScreen` | `GET /crop-health/logs/:id` → `AnalysisResultView` with no retake/symptom CTAs (those belong to the Scan tab) |
| `home/CommunityScreen` | `GET /community/alerts`; **read-only by design** — no write route exists; privacy note rendered first |
| `home/CropRecommendationScreen` | 3-step wizard → `POST /crop-recommendation`; `limitations` rendered **above** the ranking, `evidenceRatio` per card |
| `farm/FarmListScreen` | `GET /farms`; surfaces `MAX_FARMS_PER_USER` before the 409 |
| `farm/FarmFormScreen` | create+edit; land ledger via `@shared/client/units`; GPS is an accelerator over a manual state/district path |
| `farm/FarmDetailScreen` | `GET /farms/:id`; delete confirm explains the cascade |
| `farm/CropFormScreen` | `GET /registry/crops` + `GET /farms/:id`; area validated against available farm acres; sowing date as three numeric fields (no date-picker dependency) |
| `farm/CropDetailScreen` | `GET /crops/:id`; header carries support level, missing-Hindi-name notice and registry `dataGaps` |
| `farm/CropDetailTabs` | four tabs — `irrigation`, `health`, `fertilizer`, `market`; only the visible tab fetches |
| `farm/WeatherScreen` | `GET /farms/:id/weather`; **risks above the forecast strip**; handles the `pending` freshness branch as a non-error; labels `ENGINE_DEFAULT` thresholds |
| `market/MarketOverviewScreen` | `GET /market/my-crops` first, then a nearby-mandi browser over `GET /market/nearby`; **no distances** — Agmarknet publishes no mandi coordinates |
| `market/CommodityDetailScreen` | `GET /market/prices`; signal sentence above the sparkline; freshness here is never `live` |
| `scan/CropPickScreen` | crop list from the cached `/dashboard` `cropCards` (one request, not `/farms` + N×`/crops`); a single crop is pre-selected but does **not** auto-navigate, because that would skip the symptom-checklist route |
| `scan/CameraScreen` | five branches: preview/retake · permission loading · permission denied (re-ask vs. open settings) · mount failure · viewfinder. Gallery fallback in every one |
| `scan/AnalyzingScreen` | `useAnalyze`; staged live-region copy, determinate progress only while measurable, explicit cancel, per-kind failure panel |
| `scan/AnalysisResultScreen` | `GET /crop-health/logs/:id` → `AnalysisResultView` with retake / symptom-check / history |
| `scan/SymptomChecklistScreen` | five one-question steps (`part`, `pattern`, `color`, `distribution`, `spread`), every axis skippable, review screen, then `POST /crop-health/symptom-check` |
| `settings/SettingsScreen` | `PATCH /users/me` for land unit, consent and voice; language via `LanguageContext` (which also syncs); logout behind a modal confirm |

**The four analysis branches** (`AnalysisResultView`): **unusable photo** (`imageAssessment` present and not `OK`) → retake guidance; **uncertain** (`diseaseCode` null or `UNKNOWN`) → no disease name, no severity follow-up, retake tips + symptom-check CTA; **confident** → name, confidence bar, source/severity/model badges, the four KB key-lists, severity follow-up; **healthy** → the confident path carrying prevention rather than treatment. Plus an expert-referral notice whenever the chain escalated or came back unknown, a ● Cached notice when the log was served from cache, and `aiObservations` in their own attributed card — never merged into the KB lists.

**Speak buttons** (`expo-speech`, via `services/voice.ts`): analysis result, dashboard/recommendation feed items, the irrigation verdict card, weather, commodity detail, crop recommendation, and the shared why-trace. The button returns nothing when the farmer has voice off, and says so when the handset reports no voice pack for the active language. Spoken text for a result is title + symptoms + next steps — `aiObservations` are deliberately excluded, because speech loses the visual attribution that makes them honest.

**SymptomChecklist offline.** The answer vocabulary is a client constant transcribed from `backend/src/engines/symptom/constants.js`, so the questionnaire itself needs no network; the crop and disease names come from the prefetched registry documents at `STALE_TIME.registry` with `retry: false`. **Only the submit requires connectivity** — which is the honest version of "works offline".

**Not built, deliberately:** feed acknowledge is a button, not a swipe (a swipe is undiscoverable for this persona and there is no undo); there is no community *write* surface; there is no draft/observation queue (P3).

⏳ **No screen has been rendered on a physical device.** Layout, thumb reach, Devanagari rendering and 1.3× text scale are all MANUAL DEVICE TEST PENDING.
