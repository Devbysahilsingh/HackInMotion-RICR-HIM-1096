/**
 * Whether a crop can actually be evaluated against a nearby market — PURE.
 *
 * ## Why market availability is a gate rather than a score
 *
 * A recommendation the farmer cannot price is advice they cannot act on. If no
 * mandi within reach has reported a commodity, then "plant this" is a
 * suggestion to grow something with no known buyer nearby — and the honest
 * answer is to leave it out of the ranking and say why, not to rank it and
 * leave the market column empty.
 *
 * It is deliberately **not** folded into the weighted score. The four
 * agronomic weights are published in docs/crop-recommendation/engine.md and are
 * asserted verbatim by the engine suite; quietly adding a fifth would change
 * every existing score and make the documented figures wrong. Market evidence
 * therefore does two things it can do honestly: it decides *eligibility*, and
 * it breaks *ties* between crops the agronomy scores equally.
 *
 * ## Freshness policy, in one place
 *
 * Mandi reporting is irregular — a mandi that trades wheat every day may
 * publish twice a week — so "no report today" is not "no market". The bands
 * below are the single policy for how old a price may be before it stops
 * counting, and they are read by both the gate and the UI so the two cannot
 * disagree about what "stale" means.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How old the newest report may be, by band. `STALE` is the eligibility edge:
 * beyond `staleAfterDays` a crop is excluded from the ranking outright.
 */
export const MARKET_FRESHNESS_POLICY = Object.freeze({
  freshWithinDays: 1,
  recentWithinDays: 3,
  olderWithinDays: 7,
  /**
   * The eligibility cut. Chosen to match `nearbyMandis`' own default 30-day
   * query window's usefulness rather than to a published agronomic figure: a
   * price older than a month describes a different market, but one from last
   * week is still what a farmer is selling into. Configurable per call so a
   * region with thin reporting can be widened without editing the engine.
   */
  staleAfterDays: 30,
});

export const MARKET_BANDS = Object.freeze({
  FRESH: 'FRESH',
  RECENT: 'RECENT',
  OLDER: 'OLDER',
  STALE: 'STALE',
});

export const MARKET_UNAVAILABLE_REASONS = Object.freeze({
  /** The registry maps this crop to no mandi commodity at all. */
  NO_COMMODITY_MAPPING: 'NO_COMMODITY_MAPPING',
  /** Mapped, but no mandi within reach reported it in the window. */
  NO_NEARBY_REPORT: 'NO_NEARBY_REPORT',
  /** Reported, but the newest report is past the staleness cut. */
  REPORT_TOO_OLD: 'REPORT_TOO_OLD',
});

/**
 * Builds one market-evidence record per registry crop.
 *
 * @param {object} input
 * @param {object[]} input.registryCrops  lean cropRegistry documents
 * @param {{commodities?: object[], mandis?: object[], scope?: object}} input.nearby
 *   the `nearbyMandis` payload for this farm's own state and district
 * @param {Date} [input.asOf]
 * @param {number} [input.staleAfterDays]
 * @returns {Map<string, object>} cropCode → evidence
 */
export function resolveMarketEvidence({
  registryCrops = [],
  nearby = {},
  asOf = new Date(),
  staleAfterDays = MARKET_FRESHNESS_POLICY.staleAfterDays,
} = {}) {
  const byCommodity = new Map(
    (nearby.commodities ?? []).map((entry) => [entry.commodityCode, entry]),
  );

  const evidence = new Map();

  for (const crop of registryCrops) {
    /*
     * The registry's own crop → commodity mapping, with the crop code as the
     * fallback. This is the same join `marketService.resolveCommodity` uses, so
     * a crop the market screen can price is a crop this can price.
     */
    const commodityCode = crop.market?.commodityCode ?? crop.cropCode;

    if (!commodityCode) {
      evidence.set(crop.cropCode, unavailable(MARKET_UNAVAILABLE_REASONS.NO_COMMODITY_MAPPING));
      continue;
    }

    const row = byCommodity.get(commodityCode);
    if (!row?.latest) {
      evidence.set(
        crop.cropCode,
        unavailable(MARKET_UNAVAILABLE_REASONS.NO_NEARBY_REPORT, { commodityCode }),
      );
      continue;
    }

    const ageDays = Math.floor((asOf.getTime() - new Date(row.latest.date).getTime()) / MS_PER_DAY);
    const band = bandFor(ageDays);

    if (ageDays > staleAfterDays) {
      evidence.set(
        crop.cropCode,
        unavailable(MARKET_UNAVAILABLE_REASONS.REPORT_TOO_OLD, {
          commodityCode,
          ageDays,
          band,
        }),
      );
      continue;
    }

    evidence.set(crop.cropCode, {
      available: true,
      commodityCode,
      mandi: row.latest.market,
      district: row.latest.district ?? null,
      state: row.latest.state ?? null,
      /**
       * `SAME_DISTRICT` when the mandi that filed the newest report sits in the
       * farmer's own district. No kilometre figure appears anywhere here:
       * Agmarknet publishes no mandi coordinates, so a distance would have to
       * be invented (rule 7).
       */
      proximity:
        nearby.scope?.district &&
        row.latest.district &&
        row.latest.district.toLowerCase() === String(nearby.scope.district).toLowerCase()
          ? 'SAME_DISTRICT'
          : 'SAME_STATE',
      modalPrice: row.latest.modalPrice,
      minPrice: row.latest.minPrice,
      maxPrice: row.latest.maxPrice,
      unit: row.latest.unit ?? null,
      reportedAt: row.latest.date,
      ageDays,
      band,
      mandiCount: row.mandiCount ?? 1,
      observations: row.observations ?? 1,
      /** The signal engine's own verdict, never recomputed here. */
      trend: row.trend ?? null,
      changePct7d: row.changePct7d ?? null,
    });
  }

  return evidence;
}

function bandFor(ageDays) {
  const policy = MARKET_FRESHNESS_POLICY;
  if (ageDays <= policy.freshWithinDays) return MARKET_BANDS.FRESH;
  if (ageDays <= policy.recentWithinDays) return MARKET_BANDS.RECENT;
  if (ageDays <= policy.olderWithinDays) return MARKET_BANDS.OLDER;
  return MARKET_BANDS.STALE;
}

const unavailable = (reason, detail = {}) => ({ available: false, reason, ...detail });
