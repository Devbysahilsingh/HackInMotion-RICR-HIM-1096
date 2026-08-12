# Web UX Flows & State Design

Per-screen state contract (QueryBoundary): loading = skeleton mirroring layout; empty = designed guidance + CTA (dashboard-no-farms → onboarding card; no-health-logs → scan CTA); error = localized message + retry + freshness fallback if cache exists (show cached + banner over hard error, whenever cache is present); offline (web) = banner + cached rendering where Query cache holds data.

Key flow specifics (extends docs/product/user-flows.md for web):
- **Dashboard:** feed virtualized ≥20 items; ack swipe/button; CRITICAL items pinned; "why?" expands WhyTrace inline; TTS SpeakButton per item (P2).
- **Scan:** drag-drop or file pick; client-side downscale preview; analyzing state with staged progress copy ("checking photo → local AI → …" honest to actual tier); result page sections ordered: verdict+confidence → what we saw → do next → prevention → when to call expert → history link.
- **Farm form:** GPS button (browser geolocation permission flow + manual fallback), soil "don't know" path with explanatory tooltip + soil-test nudge; unit selector localized.
- **Market:** crop tabs; chart + signal sentence ABOVE chart (verdict-first); freshness date prominent; comparison table sortable.
- **Accessibility (accessibility.md):** landmarks, labels, focus management on route change, ESC-closable modals, prefers-reduced-motion respected.
- Responsive: mobile-first breakpoints (360px floor); nav = bottom tabs <768px, sidebar ≥768px (mirrors mobile app muscle memory).
