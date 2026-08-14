# Mobile Navigation

```
RootNavigator (native stack, headerShown: false)
├── bootstrapping → wordless ActivityIndicator
├── Auth  (signed out) → AuthStack:  LanguageIntro → Login → Register
└── Main  (signed in)  → MainTabs (bottom tabs, icon+label, 48px targets)
    ├── HomeTab   → HomeStack:   Dashboard → RecommendationDetail · Settings · History → HistoryDetail · CropRecommendation · Community
    ├── ScanTab   → ScanStack:   CropPick → Camera → Analyzing → AnalysisResult · SymptomChecklist
    ├── MarketTab → MarketStack: MarketOverview → CommodityDetail
    └── FarmTab   → FarmStack:   FarmList → FarmDetail → CropDetail (tabs: irrigation/health/fertilizer/market) · FarmForm · CropForm · Weather
Settings: header gear from Dashboard → HomeStack/Settings (language, land unit, consent, voice, logout)
```
Tab order rationale: Home = today's verdicts (primary loop); Scan = hero flow one tap from anywhere; Market/Farm complete the four questions. Back behavior: Android hardware back respected per stack; the Analyzing screen blocks accidental back (confirm sheet). First-run: language screen before auth (persona P1 requirement).

## As built (Phase 6)

**The two stacks are never both mounted.** `RootNavigator` renders `Main` *or* `Auth` off `useAuth().status`, so navigating back into a dashboard after logout is structurally impossible rather than guarded.

**Tabs — exact names and order:** `HomeTab` (`common:nav.dashboard`), `ScanTab` (`common:nav.scan`), `MarketTab` (`common:nav.market`), `FarmTab` (`common:nav.farms`). Icons are always paired with labels — an icon-only tab bar is unreadable to the persona this product is for. Tab bar height is `TOUCH_TARGET + 26`.

**`AuthStack` initial route** is `languageChosen ? 'Login' : 'LanguageIntro'`, resolved during boot from AsyncStorage. Skipping the language screen does *not* store a choice, so it leads again on the next cold start rather than silently defaulting.

**Settings is not a fifth tab.** It is a `HomeStack` route reached from the Dashboard header gear — the bottom bar stays at four, which is the whole reason the four questions map onto it.

**Header options** come from one shared `useStackScreenOptions()` (`navigation/screenOptions.ts`): surface-coloured header, no shadow, minimal back-button display, localized `headerBackTitle`.

**Android hardware back** is intercepted in exactly one place — `screens/scan/AnalyzingScreen.tsx` — registered only while the upload is in flight (`compressing`/`uploading`/`analyzing`), returning `true` to consume the press and raising the cancel confirmation. `Analyzing` also sets `headerBackVisible: false` and `gestureEnabled: false` in `ScanStack`, so all three routes out of the screen funnel through the same `Alert` and the same `cancel()`. Every other stack uses the platform default.

**Cross-tab jumps** are used sparingly and deliberately: the crop detail health tab jumps to `ScanTab/Camera`, the analysis result's history link jumps to `HomeTab/History`, and the empty crop-pick state jumps to `FarmTab/FarmList`.

## Deep links — none ship

`NavigationContainer` in `mobile/src/App.tsx` is rendered with **no `linking` prop**: no prefixes, no route map, no whitelist. `expo-linking` is a dependency but is never imported in `mobile/src`; the only `Linking` usage is React Native's own `Linking.openSettings()` from the camera and farm-form permission branches.

The earlier plan called for "whitelisted screens only (no token-bearing links)". As built the stronger property holds by construction: there is **no deep-link surface at all**, so there is nothing to whitelist and no parameter to validate. If linking is added later, the whitelist requirement returns with it — and the `scheme` is already reserved in `app.config.ts` (`khetri`).

## Status

| Item | Status |
|---|---|
| Stack/tab structure, route names, auth gating | ✔ COMPLETE — code-verified |
| Analyzing back-block (three paths → one confirm) | ✔ COMPLETE — code-verified; the hardware-back press itself is ⏳ MANUAL DEVICE TEST PENDING |
| Back-button behaviour across every stack | ⏳ MANUAL DEVICE TEST PENDING (testing.md matrix row) |
| Deep links | not applicable — none ship |
