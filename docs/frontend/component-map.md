# Component Map (build order = dependency order)

## ui/ primitives (Day 1)
Button (44px min target, loading state) · Input/Select/DatePicker (RHF-integrated, error slots) · Card · Badge · **PriorityChip** (🔴🟠🟡🟢 + icon + text — never color-only) · **FreshnessDot** (● Live/Cached+age/Historical/Local AI/AI-assisted tooltip) · Skeleton · EmptyState (illustration + CTA) · ErrorState (message + retry) · Modal/Sheet · Tabs · LanguageToggle · SpeakButton (TTS)

## domain/ (Day 1–2)
FeedItem (priority, title, why-expander, ack, speak) · CropCard (stage timeline mini, verdict chips) · **WhyTrace** (renders engine trace: numbers table + plain sentence — the explainability UI) · ConfidenceBar (calibrated % + band wording) · AnalysisResult (diagnosis, source label, findings, guidance sections, escalation path shown) · SymptomChecklist (guided Q&A) · UploadDropzone (progress, retry, reason-classed errors) · RiskStrip (7-day icons + risk badges) · IrrigationVerdictCard (verdict, amount, mode label, log-button) · TrendChart (Recharts line + signal badge; dataviz skill conventions at build time) · MandiTable · FertilizerStageCard (guidance + sources + disclaimer) · CropRecResultCard (score, reasons w/ sources, cautions) · CommunityAlertCard · FarmForm/CropForm · StatePicker/DistrictPicker/SoilPicker (icon-assisted)

Rules: domain components take API DTOs, no refetching inside; all text via t(); every component handles its loading/empty/error via QueryBoundary contract; storybook skipped (time) — showcase route `/dev/components` in dev builds only (not a hidden prod route — stripped from prod bundle).
