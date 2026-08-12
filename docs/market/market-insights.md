# Market Insights Logic

## Trend & signal (deterministic; no prediction)
Per commodity×(district|state): daily modal price series (district median across mandis when aggregating).
- `changePct7d` = (avg last 7 obs − avg prior 7) / prior; `changePct30d` analogous.
- Signal: RISING if changePct7d ≥ +5% · FALLING ≤ −5% · else STABLE. (Threshold: agri price noise is high; ±5% avoids flappy signals — documented assumption, viva-ready.)
- Momentum note when 7d and 30d disagree ("recent uptick within a falling month").

## Guidance phrasing (i18n keys; carefully hedged)
- RISING: "Prices up {pct}% this week in {district}. If you can store safely, waiting may pay — decide with your buyer." 
- FALLING: "Prices down {pct}%. If produce is perishable, selling sooner may protect value."
- STABLE: "Prices steady around ₹{modal}/quintal."
Never: predictions, guarantees, "will rise". Tomato/onion perishability note from registry (storage caution).

## Insight emissions
Signal flip vs yesterday → MEDIUM feed item for users growing that crop in that state. Mandi comparison (P1): latest-date table across markets, sorted by modal price, distance not computed (no free reliable mandi geo-data — honest limitation; district grouping approximates "nearby").

## Tests
Signal math unit tests (synthetic series: rising/falling/flat/noisy ±4%); aggregation median correctness; guidance key selection; flip-emission dedupe.
