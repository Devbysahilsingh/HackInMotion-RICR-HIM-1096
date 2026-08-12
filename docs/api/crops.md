# Crops & Registry API

| Endpoint | Auth | Notes |
|---|---|---|
| GET `/registry/crops` | Public | Registry summaries `{cropCode, names, supportLevel, seasons}`; full doc with `?code=`. Cache: 1h server ETag + 7d client. Localization client-side via names/keys. |
| POST `/farms/:farmId/crops` | Auth (farm ownership) | Req `{cropCode, sowingDate, variety?, areaValue?, areaUnit?}` → 201. cropCode validated against registry; unknown code → creates NOTHING server-side fabricated: client offers "request support" path storing plain LIMITED instance with `cropCode:'OTHER'` + freeText label. Limit 12 active crops/farm. |
| GET `/farms/:farmId/crops` | Auth | List with derived stage (registry Kc timeline vs sowingDate). |
| GET `/crops/:id` | Auth | Crop + registry knowledge + latest verdicts refs. |
| PATCH `/crops/:id` | Auth | `{status, variety, areaValue}`; status transition rules enforced. |
| DELETE `/crops/:id` | Auth | Cascade logs. → 204. |

Errors: 404, 422. Dependencies: crops, cropRegistry, farms.
