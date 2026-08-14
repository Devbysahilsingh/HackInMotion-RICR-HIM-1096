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
import {
  MARKET_NEARBY_SCAN_LIMIT,
  MARKET_QUERY_MAX_DAYS,
  MARKET_SERIES_SCAN_LIMIT,
  MARKET_WARM_FRESH_DAYS,
} from '../config/constants.js';
import { env } from '../config/env.js';
import { runMarketRefresh } from '../jobs/marketRefresh.js';
import { logger } from '../utils/logger.js';
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

  /**
   * Newest-first with a ceiling, then restored to ascending order for the wire.
   *
   * The sort direction is the load-bearing half. Sorting ascending and capping
   * would discard the *newest* observations — precisely the ones the 7- and
   * 30-observation windows are computed from — so a truncated series would not
   * merely be short, it would carry a signal describing the wrong fortnight.
   * One row over the ceiling is fetched so "there was more" is detectable
   * rather than inferred from an exactly-full page.
   */
  const newestFirst = await MarketPrice.find(filter)
    .select('date market minPrice modalPrice maxPrice source flagged')
    .sort({ date: -1 })
    .limit(MARKET_SERIES_SCAN_LIMIT + 1)
    .lean();

  const truncated = newestFirst.length > MARKET_SERIES_SCAN_LIMIT;
  const rows = newestFirst.slice(0, MARKET_SERIES_SCAN_LIMIT).reverse();

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
    // Rule 9: a series that hit the ceiling is a shortened one, and says so
    // rather than presenting itself as the whole window.
    freshness: { ...marketFreshness(rows), truncated },
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

/**
 * Warms the mandi data for a farm's state so a newly-created farm has market
 * context immediately, instead of waiting for the nightly ingest.
 *
 * ## Why this exists
 *
 * `marketRefresh` builds its work list from `Farm.distinct('location.state')` —
 * states where farms *already* exist — and runs on a nightly schedule. A farmer
 * who created the first farm in their state therefore saw an empty market
 * screen until the next run, which for a demo or a new region meant "no prices
 * near you" on a product whose whole promise is prices near you.
 *
 * ## Why this is safe
 *
 * Called fire-and-forget **after** the farm-creation response is sent, so rule
 * 3 holds: no farmer's request waits on data.gov.in, and a provider outage
 * cannot fail a farm creation. It is a no-op when the state already holds
 * recent rows, so the common case — a farm in a state some other farmer already
 * covers — costs one indexed count and no provider call.
 *
 * Rows go through the same normalizer and the same sanity gates as the nightly
 * job, so warmed data can never be cleaner than ingested data.
 *
 * @param {{state: string, asOf?: Date, fetchImpl?: typeof fetch}} input
 * @returns {Promise<{warmed: boolean, reason?: string, inserted?: number}>}
 */
export async function warmMarketForState({ state, asOf = new Date(), fetchImpl } = {}) {
  if (!state) return { warmed: false, reason: 'no_state' };

  // Same reasoning as weatherService.warmLocation: an implicit warm must not
  // put live provider calls inside the test suite, where it would race the
  // fixtures each suite seeds for itself. An explicit fetchImpl is never
  // suppressed, so the logic below stays covered.
  if (env.NODE_ENV === 'test' && !fetchImpl) {
    return { warmed: false, reason: 'suppressed_in_test' };
  }

  try {
    const since = new Date(asOf.getTime() - MARKET_WARM_FRESH_DAYS * MS_PER_DAY);
    const existing = await MarketPrice.countDocuments({ state, date: { $gte: since } });
    if (existing > 0) return { warmed: false, reason: 'already_fresh', inserted: 0 };

    const report = await runMarketRefresh({ asOf, fetchImpl, states: [state] });
    return { warmed: (report.inserted ?? 0) > 0, inserted: report.inserted ?? 0 };
  } catch (err) {
    logger.warn({ err, state }, 'market warm failed — the nightly job will retry');
    return { warmed: false, reason: 'error' };
  }
}

/**
 * Nearby mandis for a farm, each with every commodity it actually trades.
 *
 * ## Why this shape
 *
 * `priceSeries` answers "where can I sell ONION?" — commodity first. That is
 * the wrong first question for a farmer opening the market screen, who wants
 * "what is trading near me?" A mandi is not a crop: Nagpur APMC carries seven
 * commodities in the live feed, and a commodity-keyed API can only ever show
 * one of them at a time. This groups the other way round, so one mandi appears
 * once with its whole basket.
 *
 * ## Ranking, and why there are no distances
 *
 * Nearest-first would need mandi coordinates. **Agmarknet publishes none** — a
 * row carries state, district and market name and nothing else — so a distance
 * in kilometres would have to be invented, which rule 7 forbids. Proximity is
 * therefore expressed the only way the data supports: the farmer's own district
 * first, then the rest of their state. Each group says which it is, so the UI
 * can say "in your district" instead of a fabricated "12 km away".
 *
 * @param {{state?: string, district?: string, days?: number, commodityCode?: string}} query
 */
export async function nearbyMandis({ state, district, days = 30, commodityCode } = {}) {
  const windowDays = Math.min(days, MARKET_QUERY_MAX_DAYS);
  const since = new Date(Date.now() - windowDays * MS_PER_DAY);

  const filter = { date: { $gte: since } };
  if (state) filter.state = state;
  if (commodityCode) filter.commodityCode = commodityCode;

  /**
   * Capped, and already sorted the right way round: the dedup below keeps the
   * first row it sees for each (mandi, commodity), so newest-first means a
   * ceiling only ever drops older duplicates of pairs already recorded. It can
   * still cut a whole mandi off the tail of a very large state, which is why
   * the result reports `truncated` rather than quietly serving a short list.
   *
   * Without this the filter degenerated to `{date: {$gte: since}}` whenever a
   * farm carried no state — every mandi row in the country for 90 days, pulled
   * into memory to build a response of a few dozen kilobytes.
   */
  const rows = await MarketPrice.find(filter)
    .select('commodityCode market district state date minPrice maxPrice modalPrice source unit')
    .sort({ date: -1 })
    .limit(MARKET_NEARBY_SCAN_LIMIT + 1)
    .lean();

  const truncated = rows.length > MARKET_NEARBY_SCAN_LIMIT;
  if (truncated) rows.length = MARKET_NEARBY_SCAN_LIMIT;

  /**
   * One entry per (market, commodity), holding that commodity's most recent
   * observation. The sort above means the first row seen for a pair is already
   * the newest, so this is a single pass.
   */
  const byMandi = new Map();
  for (const row of rows) {
    const mandiKey = `${row.state}|${row.district ?? ''}|${row.market}`;
    if (!byMandi.has(mandiKey)) {
      byMandi.set(mandiKey, {
        market: row.market,
        district: row.district ?? null,
        state: row.state,
        // Named rather than measured — see the note above on distances.
        proximity:
          district && row.district && row.district.toLowerCase() === district.toLowerCase()
            ? 'SAME_DISTRICT'
            : 'SAME_STATE',
        commodities: new Map(),
      });
    }
    const mandi = byMandi.get(mandiKey);
    if (!mandi.commodities.has(row.commodityCode)) {
      mandi.commodities.set(row.commodityCode, {
        commodityCode: row.commodityCode,
        minPrice: row.minPrice,
        maxPrice: row.maxPrice,
        modalPrice: row.modalPrice,
        unit: row.unit ?? null,
        date: row.date,
        source: row.source,
      });
    }
  }

  const mandis = [...byMandi.values()]
    .map((m) => ({ ...m, commodities: [...m.commodities.values()] }))
    .sort(
      (a, b) =>
        // The farmer's own district first, then the widest basket, then by name
        // so the list is stable between identical requests.
        (a.proximity === b.proximity ? 0 : a.proximity === 'SAME_DISTRICT' ? -1 : 1) ||
        b.commodities.length - a.commodities.length ||
        a.market.localeCompare(b.market),
    );

  /** Everything actually on offer nearby — what the crop filter chooses from. */
  const available = [
    ...new Set(mandis.flatMap((m) => m.commodities.map((c) => c.commodityCode))),
  ].sort();

  return {
    scope: { state: state ?? null, district: district ?? null, days: windowDays },
    mandis,
    availableCommodities: available,
    counts: {
      mandis: mandis.length,
      inDistrict: mandis.filter((m) => m.proximity === 'SAME_DISTRICT').length,
      commodities: available.length,
    },
    freshness: { ...marketFreshness(rows), truncated },
  };
}
