# Relationships & Data Flow

## Entity relationships
```
users 1─┬─n farms 1──n crops n──1 cropRegistry
        ├─n refreshTokens
        ├─n cropHealthLogs (also n─1 crops)
        ├─n irrigationLogs (n─1 crops)
        ├─n recommendations (0..1 farm, 0..1 crop)
        └─n auditLogs

weatherSnapshots ──(by locationKey)── farms        [no FK; geo key join]
marketPrices ──(by commodityCode+district)── crops [via registry mapping]
communityAlerts ──(by district+cropCode)── users' farms+crops [aggregate only]
```
Reference style: ObjectId refs + **denormalized `userId` on every owned document** so authorization never needs a join. Registry referenced by immutable `cropCode` string (survives reseeding).

## Data flows
1. **Weather:** cron (3h) → per distinct farm locationKey → Open-Meteo (→OWM) → validate → upsert weatherSnapshots → engines read snapshot only.
2. **Irrigation:** request-time: crop + registry + snapshot + irrigationLogs → pure engine → verdict + trace (not stored) → materialized into recommendations by the feed job (30min) when priority ≥ MEDIUM.
3. **Health:** upload → Cloudinary → ml-service/Gemini/rules → cropHealthLogs.analysis → recommendation emitted → (consent) community aggregation job (6h) → communityAlerts → fan-out recommendations to matching users.
4. **Market:** nightly cron → data.gov.in per tracked commodity×state → normalize → insert marketPrices → trend/signal computed on read → signal changes emit recommendations.
5. **Dashboard read:** recommendations (active) + crop cards (crop+registry+latest snapshot+latest health) — single aggregation, no external calls.
