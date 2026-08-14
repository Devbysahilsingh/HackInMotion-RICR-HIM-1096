# Product Specification

**Product:** Smart Farm Decision Support System (working name: Khetri — OD-4)
**Surfaces:** Web (React) + Android mobile (React Native/Expo) · **Languages:** Hindi + English

## One-line definition
A farmer opens the app and knows, in their language, what to act on today — irrigation, weather risk, crop health, fertilizer timing, market moves — with every recommendation explained and personalized to their farm.

## Product model (farmer-centric)

```
Farmer (account, language, preferences)
 └── Farm (location/GPS, size+unit, soil type, irrigation method)
      └── Crop instance (registry crop, variety?, sowing date, area, status)
           ├── Current conditions (derived: stage, weather, water balance)
           ├── Health observations (photos + analyses + outcomes)
           ├── Irrigation ledger (recommendations + logged events)
           ├── Fertilizer guidance (stage-driven)
           ├── Market context (mandi trends for crop)
           └── History (all of the above, time-ordered)
```

The **decision loop** every feature serves: Farmer → Farm → Crop → Current conditions → Data collection → Intelligence engines → Risk detection → Recommendation (prioritized, explained) → Action → Outcome/History. History feeds back (irrigation ledger updates water balance; health logs feed community aggregation; logged actions refine guidance).

## Core surfaces & screens

| Screen | Purpose | Priority |
|---|---|---|
| Onboarding / language select | First-run language + intro | P0 |
| Auth (register/login) | Account | P0 |
| Dashboard ("Aaj / Today") | Prioritized action feed (CRITICAL/HIGH/MEDIUM/INFO) + status cards | P0 |
| Farm setup / edit | Location (GPS or state→district picker), size+unit, soil, irrigation method | P0 |
| Crop add / detail | Registry picker, sowing date, stage timeline, per-crop verdicts | P0 |
| Crop health (camera-first on mobile) | Capture → analyze → result + guidance + history | P0 |
| Weather & irrigation | 7-day ag-forecast, risk strip, irrigation verdict + why-trace, "I irrigated" log | P0 |
| Market | Trend chart, signal, mandi comparison for user's crops | P0 |
| Fertilizer guidance | Stage-based nutrient guidance per crop | P1 |
| Crop recommendation | "What should I plant next season?" wizard + scored results | P1 |
| Community alerts | District-level outbreak advisories | P2 |
| Yield estimate | Transparent estimator with uncertainty | P3 (API+schema planned) |
| Settings | Language, profile, logout | P0 |

Every screen defines loading / empty / error / offline states (see ux-flows.md). No blank screens ever.

## System responses & tone
- Verdict-first: "Irrigate tomorrow morning (~25 mm)" before any chart.
- Why always available: expandable trace with real numbers.
- Honest states: confidence shown; "can't identify confidently" is a valid, designed outcome.
- Freshness labels: ● Live · ● Cached (2h) · ● Historical · ● Local AI · ● AI-assisted.
- Simple language, both locales; icons + color coding for low-literacy scanning (never color alone — icon+text too).

## Personalization contract
Every recommendation must consume ≥3 of: location, soil, crop, stage, sowing date, size, irrigation method, logged history. If farm data is missing → ask for it or degrade with an explicit "add soil type for better advice" prompt — never silently generic.
