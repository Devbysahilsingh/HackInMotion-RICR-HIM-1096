# Market Data Normalization

Pipeline per fetched row (job code `backend/src/jobs/market-refresh`):
1. **Parse & type:** prices → int ₹/quintal; arrival_date → ISO date (DD/MM/YYYY source format); trim/collapse whitespace.
2. **Sanity gates:** 0 < price < 100,000; modal ∉ [min,max] → clamp to nearest bound + `flagged:true`; date > today or < 90d ago → drop (counter).
3. **Canonicalize:** commodity → cropCode via alias map (miss → drop+count); state/district → canonical list (`shared/constants/geo`; fuzzy match ≥0.9 else drop+count); market name trimmed as-is (display value).
4. **Dedupe/idempotency:** unique index (commodityCode, market, date); re-runs upsert identical rows harmlessly.
5. **Job report:** {fetched, inserted, duplicates, dropped:{unmapped, badDate, badPrice}, flagged} → pino log + `/system/status`.
Quarantine philosophy: bad rows never enter history; drop-rate >30% aborts the batch (schema-drift guard) keeping prior data intact.
