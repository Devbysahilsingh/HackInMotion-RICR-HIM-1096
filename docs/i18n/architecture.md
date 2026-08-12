# i18n Architecture (Hindi + English, full parity)

## Stack
i18next on both surfaces (react-i18next web; i18next + react-i18next in Expo). **Canonical resources: `shared/i18n/{en,hi}/{namespace}.json`** — single source; web imports directly (Vite), mobile via metro `watchFolders` config pointing at `../shared` (documented in mobile/architecture.md). No per-surface forks of translations; surface-specific keys live in `web`/`mobile` namespaces within the same tree.

## Namespaces
`common` (buttons, nav, states) · `auth` · `farm` · `crop` · `health` · `weather` · `irrigation` · `market` · `fertilizer` · `cropRec` · `community` · `voice` · `errors` (messageKey targets) · `agri` (terminology layer — see agricultural-terminology.md).

## Rules (enforced)
1. **Zero hardcoded user-facing strings** — ESLint `i18next/no-literal-string` on web+mobile src (JSX text); PR checklist item.
2. **Language-neutral data layer:** DB stores keys + params (`titleKey`,`bodyKey`,`data`), codes (`TOMATO_EARLY_BLIGHT`), enums — rendering localizes at the edge. API returns messageKey, never prose.
3. **Parity gate:** script `scripts/check-i18n.mjs` diffs en vs hi key sets — missing keys fail the check (Day-3 blocking item); fallbackLng 'en' is a safety net, not a strategy.
4. **Formatting:** Intl via i18next-icu-lite conventions — dates (`hi-IN` locale), numbers (Indian digit grouping ₹1,00,000), units (quintal/acre localized labels).
5. **Language selection:** first-run screen; persisted (users.language + local storage); switchable in Settings; device-locale default (hi → Hindi).
6. **Pluralization:** i18next plural forms for hi (Hindi has 2 forms — standard config).

## Dynamic/AI content localization
Engine outputs = keys + numeric params → fully localized. Gemini visualFindings (free English strings) shown under an "AI observations" section with translation deferred (labeled English on hi UI — honest limitation, P3: translation pass); everything decision-bearing (diagnosis name, guidance, severity) comes from KB keys and is fully Hindi.
