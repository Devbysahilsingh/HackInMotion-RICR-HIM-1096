# E2E Testing (Playwright, web)

Two journeys, chromium + mobile-viewport run:
1. **Full farmer loop (mirrors demo):** register → language हिंदी → farm create (manual district path) → crop add (tomato) → dashboard shows verdicts → upload fixture diseased-leaf image (backend live, AI tiers mocked to deterministic fixture at E2E layer) → result renders diagnosis+confidence+guidance → mark irrigated → feed updates → market tab trend renders → language switch en → logout.
2. **API-down loop:** seed cache → enable FORCE_FAIL all external → login → every P0 screen renders cached data + correct labels → no blank/broken states anywhere (screenshot assertions on each page).
Selectors: data-testid contract (stable, i18n-immune); runs against local full stack (docker-less: node+memory-ish local mongo or Atlas dev db); Day 3 gate + pre-demo smoke against PRODUCTION (read-only journey subset + one throwaway account).
Explicitly out: cross-browser matrix, load testing (recorded as future).
