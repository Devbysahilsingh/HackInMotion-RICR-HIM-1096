# Frontend Testing (web)

Focused RTL set (quality > quantity):
- QueryBoundary contract: loading/empty/error/cached-banner rendering for a representative page (mocked Query states).
- WhyTrace: given engine trace fixture → all numbers rendered, localized labels (both locales).
- AnalysisResult: source labels per tier fixture (Local AI / AI-assisted / Guided assessment); low-confidence branch shows checklist CTA; severity marked "assessed".
- Forms: FarmForm validation messages localized; soil-unknown path shows nudge.
- Auth bootstrap: refresh-success → dashboard; refresh-fail → login; 401-mid-session single-flight refresh (msw).
- FreshnessDot + PriorityChip: icon+text presence (never color-only) — accessibility regression guard.
- i18n: lint rule (no-literal-string) enforced CI-style; spot render test with hi locale asserting Devanagari output on dashboard.
- Lighthouse pass (Day 3): performance + a11y on dashboard/scan/result — scores recorded honestly in test report, not tuned-for-screenshot.
