# Farms API

All Auth; ownership: every farm addressed by id is loaded and checked `farm.userId === req.user.id` else 404.

| Endpoint | Notes |
|---|---|
| GET `/farms` | List own farms (+ crop counts). Cache: client 60s. |
| POST `/farms` | Req `{name, location{lat?,lon?,state,district,source}, sizeValue, sizeUnit, soilType, irrigationMethod}` → 201. Side effect: location registered for weather refresh job (next cycle ≤3h; plus immediate on-demand fetch attempt so the demo isn't waiting). Limit 10 farms/user. |
| GET `/farms/:id` | Farm + its crops + latest weather snapshot ref + freshness meta. |
| PATCH `/farms/:id` | Partial update, same validation. Location change re-registers weather key. |
| DELETE `/farms/:id` | Cascade crops/logs/recommendations (lifecycle doc). → 204. |

Errors: 404, 422. Dependencies: farms, crops, weatherSnapshots, recommendations.
