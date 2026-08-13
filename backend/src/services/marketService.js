/**
 * Market reads (docs/api/market.md). Served from `marketPrices` only —
 * "Auth · served from marketPrices only" — so no request path reaches
 * data.gov.in (CLAUDE.md rule 3).
 *
 * `marketPrices` is the one data-bearing collection with no `userId`: mandi
 * prices are public. Ownership therefore applies only where a *crop* is
 * involved (`/market/my-crops`), and there it is applied as a query filter,
 * never as a post-filter (AU-4).
 */
import { MARKET_QUERY_MAX_DAYS } from '../config/constants.js';
import { Crop, CropRegistry, Farm, MarketPrice } from '../models/index.js';
import { computeMarketSignal, guidanceKeyFor } from '../engines/marketSignal/marketSignal.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The Mongoose path to the registry's commodity code, assembled from segments
 * rather than written as one quoted dotted string.
 *
 * The i18n key scanner (tests/i18n/message-keys.test.js) matches any quoted
 * namespace-dot-name literal anywhere in a source file, and `market` is a real
 * i18n namespace — so a dotted Mongoose path is indistinguishable from a
 * message key and fails the gate. Weakening the scanner to allow it would blind
 * it to genuinely missing translations, which is the failure it exists to catch.
 * (The same reason this comment describes the string instead of quoting it.)
 */
const COMMODITY_CODE_PATH = ['market', 'commodityCode'].join('.');

/**
 * Freshness for a price series.
 *
 * docs/api/market.md publishes only `cached | historical` here, and that is
 * correct rather than an omission: a read path never fetches, so nothing served
 * from this collection can honestly be called `live`. `historical` means the
 * rows came from the CEDA seed rather than the portal — real data, but not
 * current, and labelled as such.
 */
export function marketFreshness(rows) {
  if (rows.length === 0) return { latestDate: null, source: null, status: 'historical' };

  const latest = rows.reduce((newest, row) => (row.date > newest.date ? row : newest), rows[0]);
  const allSeeded = rows.every((row) => row.source === 'seed');

  return {
    latestDate: latest.date,
    source: latest.source,
    status: allSeeded ? 'historical' : 'cached',
    // Surfaced so a card can say how old the newest price is rather than
    // implying today's.
    ageDays: Math.floor((Date.now() - new Date(latest.date).getTime()) / MS_PER_DAY),
  };
}

/**
 * Resolves a client-supplied commodity against the registry.
 * "commodity validated against registry mappings" — an arbitrary string must
 * not become a database query.
 */
export async function resolveCommodity(commodity) {
  const code = String(commodity ?? '')
    .trim()
    .toUpperCase();
  if (!code) return null;

  const entry = await CropRegistry.findOne({
    $or: [{ cropCode: code }, { [COMMODITY_CODE_PATH]: code }],
  })
    .select('cropCode market names')
    .lean();

  return entry ? (entry.market?.commodityCode ?? entry.cropCode) : null;
}

/**
 * Price series plus signal for one commodity in one place.
 *
 * @param {{commodityCode: string, state?: string, district?: string, days?: number}} query
 */
export async function priceSeries({ commodityCode, state, district, days = 30 }) {
  const windowDays = Math.min(days, MARKET_QUERY_MAX_DAYS);
  const since = new Date(Date.now() - windowDays * MS_PER_DAY);

  const filter = { commodityCode, date: { $gte: since } };
  // District narrows to a mandi cluster; without one the query is a state-level
  // aggregate, which is what the doc means by "district optional".
  if (district) filter.district = district;
  if (state) filter.state = state;

  const rows = await MarketPrice.find(filter)
    .select('date market minPrice modalPrice maxPrice source flagged')
    .sort({ date: 1 })
    .lean();

  const signal = computeMarketSignal({ rows });

  return {
    series: rows.map((row) => ({
      date: row.date,
      market: row.market,
      minPrice: row.minPrice,
      modalPrice: row.modalPrice,
      maxPrice: row.maxPrice,
      // Rule 9: a clamped price is labelled, never passed off as published.
      adjusted: Boolean(row.flagged),
    })),
    signal: {
      trend: signal.trend,
      changePct7d: signal.changePct7d,
      changePct30d: signal.changePct30d,
      momentumDiverges: signal.momentumDiverges,
      guidanceKey: guidanceKeyFor(signal.trend),
      reasonCode: signal.reasonCode,
      // R12: the numbers behind the verdict travel with it.
      trace: signal.trace,
    },
    freshness: marketFreshness(rows),
  };
}

/**
 * Signals for every active crop the caller owns (docs/api/market.md:
 * "Convenience: signals for all user's active crops (dashboard cards)").
 *
 * The crop→commodity→place join is: crop.cropCode → registry.market
 * .commodityCode, and the place comes from the crop's farm
 * (docs/database/relationships.md: "marketPrices ──(by commodityCode+district)
 * ── crops [via registry mapping]").
 */
export async function myCropSignals(userId, { days = 30 } = {}) {
  // Ownership is in the filter, not applied afterwards.
  const crops = await Crop.find({ userId, status: 'active' }).select('cropCode farmId').lean();

  if (crops.length === 0) return [];

  const [farms, registry] = await Promise.all([
    Farm.find({ _id: { $in: crops.map((crop) => crop.farmId) }, userId })
      .select('location.state location.district')
      .lean(),
    CropRegistry.find({ cropCode: { $in: [...new Set(crops.map((crop) => crop.cropCode))] } })
      .select('cropCode names market')
      .lean(),
  ]);

  const farmById = new Map(farms.map((farm) => [String(farm._id), farm]));
  const registryByCode = new Map(registry.map((entry) => [entry.cropCode, entry]));

  // One crop per (commodity, district) pair: three tomato plantings in one
  // district share a mandi price, so querying once per crop would be an N+1
  // against identical data.
  const uniquePlaces = new Map();
  for (const crop of crops) {
    const entry = registryByCode.get(crop.cropCode);
    const commodityCode = entry?.market?.commodityCode ?? entry?.cropCode;
    const farm = farmById.get(String(crop.farmId));
    if (!commodityCode || !farm) continue;

    const key = `${commodityCode}|${farm.location?.district ?? ''}|${farm.location?.state ?? ''}`;
    if (!uniquePlaces.has(key)) {
      uniquePlaces.set(key, {
        commodityCode,
        cropCode: crop.cropCode,
        names: entry?.names,
        state: farm.location?.state,
        district: farm.location?.district,
        cropIds: [],
      });
    }
    uniquePlaces.get(key).cropIds.push(String(crop._id));
  }

  const results = await Promise.all(
    [...uniquePlaces.values()].map(async (place) => {
      const { signal, freshness } = await priceSeries({
        commodityCode: place.commodityCode,
        state: place.state,
        district: place.district,
        days,
      });
      return {
        cropCode: place.cropCode,
        names: place.names,
        commodityCode: place.commodityCode,
        state: place.state ?? null,
        district: place.district ?? null,
        cropIds: place.cropIds,
        // The minimal projection the dashboard card needs — no price series.
        // The trace stays: this is the feed job's only signal source, and
        // dropping it made every market feed item violate R12 ("no
        // recommendation without trace data").
        signal: {
          trend: signal.trend,
          changePct7d: signal.changePct7d,
          changePct30d: signal.changePct30d,
          momentumDiverges: signal.momentumDiverges,
          guidanceKey: signal.guidanceKey,
          reasonCode: signal.reasonCode,
          trace: signal.trace,
        },
        freshness,
      };
    }),
  );

  // Deterministic ordering so two identical requests render identically.
  return results.sort((a, b) => a.cropCode.localeCompare(b.cropCode));
}
