# Mobile Screen Map (MVP = P0/P1 rows)

| Screen | Priority | Content/states |
|---|---|---|
| LanguageIntro | P0 | हिंदी/English cards; 3 value slides; skippable |
| Login/Register | P0 | minimal fields, large inputs, show-password, offline notice |
| Dashboard | P0 | greeting + date (localized), feed list (PriorityChip, ack swipe, speak button P2), crop cards row, pull-refresh, freshness dots, empty→"create farm" card |
| FarmList/FarmForm | P0 | GPS button (permission flow → manual district picker fallback), soil icons, unit picker |
| CropDetail | P0 | stage timeline, verdict cards (irrigation/health/market), tabs, "I irrigated" button |
| CropForm | P0 | registry picker w/ support badges + search, sowing date calendar |
| Camera/Scan | P0 | permission flow, capture + gallery, crop auto-select if single, compress→upload progress, retry, draft-save (P3) |
| Analyzing | P0 | staged honest progress; cancel |
| AnalysisResult | P0 | verdict-first layout, source label, confidence bar, guidance sections, speak-aloud (P2), history link, low-confidence branch → retake tips + SymptomChecklist CTA |
| SymptomChecklist | P1 | guided Q&A (icons), works from cached registry offline |
| WeatherIrrigation | P0 | 7-day strip, risk badges, irrigation verdict + why-trace, simplified-mode label |
| Market | P0 | crop tabs, trend chart, signal sentence first, dated freshness |
| HistoryList | P1 | health timeline (read-only mobile MVP) |
| CommunityAlerts | P2 | advisory cards |
| Settings | P0 | language, community consent, voice toggle, logout, about+disclaimers |
| ErrorBoundary/Offline states | P0 | designed, localized |
All screens: loading skeletons, designed empty/error, offline-cached rendering with age labels.
