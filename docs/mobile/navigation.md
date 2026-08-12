# Mobile Navigation

```
RootNavigator
├── AuthStack (signed out): Language/Intro → Login → Register
└── MainTabs (signed in; bottom tabs, icon+label, 48px targets)
    ├── Home (stack): Dashboard → RecommendationDetail → WhyTrace
    ├── Scan (stack): CropPick → Camera/Gallery → Analyzing → Result → SymptomChecklist (fallback path)
    ├── Market (stack): MarketOverview → CommodityDetail
    └── Farm (stack): FarmList → FarmDetail → CropDetail(tabs: irrigation/health/fertilizer) → forms
Settings: header gear from Home → SettingsScreen (language, consent, voice, logout)
```
Tab order rationale: Home = today's verdicts (primary loop); Scan = hero flow one tap from anywhere; Market/Farm complete the four questions. Deep links: whitelisted screens only (no token-bearing links, docs/security). Back behavior: Android hardware back respected per stack; analyzing screen blocks accidental back (confirm sheet). First-run: language screen before auth (persona P1 requirement).
