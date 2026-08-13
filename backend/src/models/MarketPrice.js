import { Schema, model } from 'mongoose';

import { baseOptions } from './shared.js';

/**
 * Append-only mandi price history — this collection IS the history, there is
 * no separate archive. Not user-owned: public market data.
 */
const marketPriceSchema = new Schema(
  {
    commodityCode: { type: String, required: true, uppercase: true, trim: true },
    state: { type: String, required: true, trim: true },
    district: { type: String, required: true, trim: true },
    market: { type: String, required: true, trim: true },

    date: { type: Date, required: true },

    minPrice: { type: Number, required: true, min: 0.01, max: 100000 },
    modalPrice: { type: Number, required: true, min: 0.01, max: 100000 },
    maxPrice: { type: Number, required: true, min: 0.01, max: 100000 },

    unit: { type: String, enum: ['quintal'], required: true, default: 'quintal' },

    /** 'seed' rows are labelled Historical in the UI — never passed off as live. */
    source: { type: String, enum: ['datagovin', 'seed'], required: true },

    /**
     * True when the published modal price fell outside [min, max] and was
     * clamped to the nearest bound during ingest (docs/market/data-normalization.md:
     * "modal ∉ [min,max] → clamp to nearest bound + `flagged:true`").
     *
     * The rule was documented from the start but the field was never added, so
     * a clamped row was indistinguishable from a published one — an adjusted
     * number presenting itself as the mandi's own, which honesty rule 9
     * forbids. Added in P2-5 alongside the normalizer that sets it.
     */
    flagged: { type: Boolean, required: true, default: false },

    fetchedAt: { type: Date, required: true },
  },
  baseOptions('marketPrices'),
);

/** Makes nightly ingest idempotent: a re-run upserts rather than duplicates. */
marketPriceSchema.index(
  { commodityCode: 1, market: 1, date: 1 },
  { unique: true, name: 'commodity_market_date_unique' },
);
/** Trend queries: 30-day series for a commodity in a district. */
marketPriceSchema.index(
  { commodityCode: 1, district: 1, date: -1 },
  { name: 'commodity_district_date' },
);

export const MarketPrice = model('MarketPrice', marketPriceSchema);
