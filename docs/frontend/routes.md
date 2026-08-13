# Web Routes

| Path | Page | Guard | Notes |
|---|---|---|---|
| `/` | public landing page | — | anonymous: product landing; signed-in: forward → `/home` |
| `/home` | post-auth landing | auth | decides `/dashboard` vs `/onboarding` from the account's own data |
| `/login`, `/register` | Auth pages | guest-only | language switch visible pre-auth |
| `/onboarding` | language + intro | auth, first-run | skippable |
| `/dashboard` | Action feed + crop cards | auth | THE home screen; History entry lives in its header |
| `/farms` · `/farms/new` · `/farms/:id` · `/farms/:id/edit` | farm CRUD | auth | :id shows crops + weather strip; "What should I plant?" entry in list header |
| `/farms/:farmId/weather` | per-farm weather | auth | risks first, then forecast + charts; farm context in header |
| `/weather` | weather entry | auth | one farm → redirect to its weather; several → farm picker |
| `/farms/:farmId/crops/new` · `/crops/:id` | crop add/detail | auth | detail tabs: Status · Irrigation · Health · Fertilizer · Market; farm context in both headers; crop form enforces the land ledger client-side |
| `/scan` · `/scan/symptoms` | crop-health upload / guided questions | auth | crop picker → upload → analyzing → result |
| `/health/:logId` | analysis result/history detail | auth | |
| `/market` | nearby mandis + trends | auth | location-first: nearby mandi basket, crop filter over it; then the farmer's own crop signals |
| `/history` | advice + scan history | auth | sidebar entry (desktop) + dashboard header (mobile) |
| `/crop-recommendation` | wizard (P1) | auth | entries: farms header, feed items |
| `/community` | alerts list (P2) | auth | |
| `/settings` | profile, language, consent, logout | auth | |
| `*` | designed 404 | — | localized (`errors:notFound*`), back-home CTA |
Lazy-loaded route chunks; guards via layout routes (`<RequireAuth>`); scroll restoration; document titles localized.
