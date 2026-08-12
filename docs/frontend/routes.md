# Web Routes

| Path | Page | Guard | Notes |
|---|---|---|---|
| `/` | redirect → /dashboard or /login | — | |
| `/login`, `/register` | Auth pages | guest-only | language switch visible pre-auth |
| `/onboarding` | language + intro | auth, first-run | skippable |
| `/dashboard` | Action feed + crop cards | auth | THE landing page |
| `/farms` · `/farms/new` · `/farms/:id` · `/farms/:id/edit` | farm CRUD | auth | :id shows crops + weather strip |
| `/farms/:farmId/crops/new` · `/crops/:id` | crop add/detail | auth | detail tabs: Status · Irrigation · Health · Fertilizer · Market |
| `/scan` | crop-health upload flow | auth | crop picker → upload → analyzing → result |
| `/health/:logId` | analysis result/history detail | auth | |
| `/market` | trends + comparison | auth | crop tabs from user's crops |
| `/crop-recommendation` | wizard (P1) | auth | |
| `/community` | alerts list (P2) | auth | |
| `/settings` | profile, language, consent, logout | auth | |
| `*` | designed 404 | — | localized, back-home CTA |
Lazy-loaded route chunks; guards via layout routes (`<RequireAuth>`); scroll restoration; document titles localized.
