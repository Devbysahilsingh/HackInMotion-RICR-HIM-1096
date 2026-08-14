/**
 * What to plant on one field — the orchestration layer.
 *
 * ## The pipeline, and why it is split this way
 *
 *   FarmContext → SeasonResolver → LandAvailability → MarketEvidence
 *     → recommendCrops (pure engine) → response
 *
 * Each step above this one is pure and separately testable; this file is the
 * only part that touches the database, which is what keeps CLAUDE.md rule 5
 * ("engines import nothing above utils/constants") true of the engine while
 * still letting the ranking depend on live market data.
 *
 * ## One source of truth, deliberately
 *
 * The list screen and the detail screen call the *same* function and the detail
 * screen simply selects one crop out of its result. Before this, a detail page
 * re-ran the wizard's POST with its own inputs and could legitimately show a
 * different score for the same crop on the same day — the class of bug where a
 * farmer taps "0.86" and lands on "0.81" and stops trusting the number.
 *
 * ## Market is a hard gate here and nowhere else
 *
 * `requireMarket` is set for this farm-scoped route because a farm has a
 * location and therefore a set of reachable mandis. The season-planning wizard
 * (`POST /crop-recommendation`) keeps its old behaviour: it is a "what could I
 * grow in Rabi?" question, not "what should I plant on this field", and gating
 * it on market data would silently empty it.
 */
import { CropRegistry, Crop } from '../../models/index.js';
import { recommendCrops } from '../../engines/cropRec/cropRecommendation.js';
import { nearbyMandis } from '../marketService.js';
import { resolveLandAvailability } from './landAvailability.js';
import { resolveMarketEvidence, MARKET_FRESHNESS_POLICY } from './marketEligibility.js';
import { resolveSeason } from './seasonResolver.js';

/**
 * How far back the mandi query looks for a price. Wider than the market
 * screen's default because a *planning* decision tolerates an older price than
 * a selling decision does — and the staleness cut in `marketEligibility` is
 * what actually decides eligibility, not this window.
 */
const MARKET_WINDOW_DAYS = 30;

/**
 * @param {object} farm an already-authorized Farm document (loadOwned)
 * @param {{season?: string, preference?: string, asOf?: Date, staleAfterDays?: number}} [options]
 */
export async function recommendForFarm(
  farm,
  { season, preference, asOf = new Date(), staleAfterDays } = {},
) {
  // ── FarmContext ────────────────────────────────────────────────────────────
  const crops = await Crop.find({ farmId: farm._id, userId: farm.userId })
    .select('cropCode status areaValue areaUnit sowingDate')
    .lean();

  const land = resolveLandAvailability(farm, crops);

  // ── SeasonResolver ─────────────────────────────────────────────────────────
  // An explicit season still wins: this route is farm-scoped, not opinionated.
  const resolvedSeason = resolveSeason({ asOf });
  const effectiveSeason = season ?? resolvedSeason.season;

  // ── Candidates ─────────────────────────────────────────────────────────────
  const registryCrops = await CropRegistry.find({ supportLevel: { $ne: 'UNSUPPORTED' } }).lean();

  // ── MarketAvailability ─────────────────────────────────────────────────────
  // A DB-only read (`nearbyMandis` never calls a provider), so this stays
  // inside rule 3 even though it runs on a request path.
  const nearby = await nearbyMandis({
    state: farm.location?.state,
    district: farm.location?.district,
    days: MARKET_WINDOW_DAYS,
  });

  const market = resolveMarketEvidence({ registryCrops, nearby, asOf, staleAfterDays });

  // ── Ranking ────────────────────────────────────────────────────────────────
  const result = recommendCrops({
    registryCrops,
    farm,
    season: effectiveSeason,
    preference,
    market,
    requireMarket: true,
  });

  /*
   * Crops already growing here are not a suggestion.
   *
   * Ranking wheat for a field that is already three-quarters wheat is
   * technically correct and practically useless, and the rotation note the
   * design shows ("fixes nitrogen after soybean") only makes sense once the
   * standing crops are known. They are moved to `excluded` with their own
   * reason rather than dropped, so the page can say why.
   */
  const standing = new Set(
    crops.filter((crop) => crop.status !== 'harvested').map((crop) => crop.cropCode),
  );

  const recommendations = [];
  const excluded = [...result.excluded];

  for (const entry of result.recommendations) {
    if (standing.has(entry.cropCode)) {
      excluded.push({
        cropCode: entry.cropCode,
        names: entry.names,
        reason: 'ALREADY_GROWING',
        reasonKey: 'cropRec.gateAlreadyGrowing',
        data: {},
      });
      continue;
    }
    recommendations.push(entry);
  }

  return {
    farm: {
      id: String(farm._id),
      name: farm.name,
      location: farm.location,
      soilType: farm.soilType,
      irrigationMethod: farm.irrigationMethod,
    },
    season: {
      ...resolvedSeason,
      /** What the ranking actually used, which an explicit query can override. */
      applied: effectiveSeason,
      overridden: Boolean(season) && season !== resolvedSeason.season,
    },
    land,
    /** Which crops hold the ground now — the rotation context for the reasons. */
    standingCrops: crops
      .filter((crop) => crop.status !== 'harvested')
      .map((crop) => ({
        cropCode: crop.cropCode,
        status: crop.status,
        sowingDate: crop.sowingDate ?? null,
      })),
    marketContext: {
      scope: nearby.scope,
      mandiCount: nearby.counts?.mandis ?? 0,
      commodityCount: nearby.counts?.commodities ?? 0,
      freshness: nearby.freshness,
      policy: {
        ...MARKET_FRESHNESS_POLICY,
        staleAfterDays: staleAfterDays ?? MARKET_FRESHNESS_POLICY.staleAfterDays,
      },
      windowDays: MARKET_WINDOW_DAYS,
    },
    recommendations,
    excluded,
    limitations: result.limitations,
    trace: result.trace,
  };
}

/**
 * One crop's recommendation, selected from the same ranking the list rendered.
 *
 * Deliberately *not* a second scoring path: it re-runs the identical pipeline
 * and picks the crop out of the result, so the detail screen physically cannot
 * disagree with the card the farmer tapped. A crop that is not in the ranking
 * returns its exclusion instead, which is the honest answer to "why can I not
 * see this one?".
 */
export async function recommendationForCrop(farm, cropCode, options = {}) {
  const result = await recommendForFarm(farm, options);

  const recommendation =
    result.recommendations.find((entry) => entry.cropCode === cropCode) ?? null;
  const excluded = result.excluded.find((entry) => entry.cropCode === cropCode) ?? null;

  if (!recommendation && !excluded) return null;

  return { ...result, recommendation, excludedEntry: excluded };
}
