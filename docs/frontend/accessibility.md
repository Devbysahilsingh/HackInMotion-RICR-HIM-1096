# Accessibility (web + principles shared with mobile)

Target: WCAG 2.1 AA-informed (pragmatic hackathon subset, honestly scoped):
- Contrast ≥4.5:1 all text (token palette checked at build; dataviz skill validator for chart colors); priority/status never color-alone (icon+label always).
- Touch targets ≥44×44px; generous spacing (field-usage: sunlight, dusty screens, work-worn hands).
- Semantics: native elements, labeled inputs, alt text on informative images, aria-live on analysis progress + feed updates, landmark regions, logical heading order.
- Keyboard: full tab traversal, visible focus rings, ESC/Enter conventions, focus moved to page title on route change.
- Language: `lang` attribute switches with locale (hi screen readers); dir LTR both.
- Motion: prefers-reduced-motion → transitions off.
- Low-literacy provisions (as accessibility): icon+text pairing everywhere, ≤2-tap verdicts, TTS readout (voice doc), plain-language keys mandated in translation strategy.
- Testing: axe-core pass on key pages (Day 3), manual keyboard walkthrough, NVDA spot-check on dashboard + result page if time (recorded honestly in test report).
Mobile mirrors: accessibilityLabel/Role props, 44px targets, dynamic font scale tolerance (test at 1.3×).
