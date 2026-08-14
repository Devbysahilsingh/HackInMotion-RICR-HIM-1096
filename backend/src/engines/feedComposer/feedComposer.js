/**
 * Feed composer — PURE (CLAUDE.md rule 5).
 *
 * Spec: docs/irrigation/recommendation-engine.md (the file is titled "Central
 * Recommendation Engine (feed composer)" — it is misfiled under irrigation/)
 * and docs/api/recommendations.md.
 *
 * Takes engine verdicts and returns feed items. No database, no clock beyond
 * `asOf`, no i18n prose — keys and params only (rule 8).
 *
 * Four decisions this file makes, each forced by a gap or contradiction in the
 * specification and each recorded here rather than left implicit:
 *
 * 1. **Dedup key.** The doc says "dedupe type+cropId+day". That collapses two
 *    simultaneous weather risks on one crop (a frost AND a heavy rain become
 *    one item, silently losing the other), and it has no answer for farm-level
 *    items with no `cropId`. The key here therefore adds a discriminator drawn
 *    from the item itself, and `userId` — which the doc omits but which is
 *    mandatory, since a key without it would collide across accounts.
 *
 * 2. **Ordering.** The documented order is CRITICAL > HIGH > MEDIUM > INFO, but
 *    the `feed` index sorts `priority: 1`, i.e. the strings ascending, which is
 *    CRITICAL, HIGH, INFO, MEDIUM — INFO above MEDIUM. Ordering is therefore
 *    done here over a bounded candidate set, not by the index. Ties break on
 *    `createdAt` descending, then on the dedup key, so the order is total and
 *    two identical runs render identically.
 *
 * 3. **Which irrigation verdicts materialise.** docs/database/relationships.md
 *    says irrigation is materialised "when priority ≥ MEDIUM"; the priority
 *    table assigns WAIT_RAIN and NO_NEED to INFO. Both cannot hold. Resolved by
 *    what the item asks the farmer to *do*: WAIT_RAIN_EXPECTED changes today's
 *    behaviour ("hold off, rain is coming") and is emitted as INFO;
 *    NO_IRRIGATION_NEEDED asks for nothing and would put one dead item per crop
 *    per day into the feed, so it is not materialised.
 *
 * 4. **The contradiction rule.** "contradicting pair (e.g. heavy-rain +
 *    irrigate-today) → HYBRID item 'rain expected — hold irrigation' (rule
 *    table, not LLM)". Implemented as a rule table below, and the two source
 *    items are suppressed so the farmer sees one instruction, not two opposing
 *    ones.
 */
import { FEED_MAX_ACTIVE_PER_USER, FEED_PRIORITY_RANK } from '../../config/constants.js';
import { dayKey, endOfDay } from '../../utils/day.js';

export const FEED_TYPES = Object.freeze({
  IRRIGATION: 'irrigation',
  WEATHER_RISK: 'weather-risk',
  MARKET: 'market',
});

export const PRIORITIES = Object.freeze({
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  INFO: 'INFO',
});

export const SOURCES = Object.freeze({
  WEATHER: 'WEATHER',
  RULE_ENGINE: 'RULE_ENGINE',
  MARKET: 'MARKET',
  HYBRID: 'HYBRID',
});

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Priority mapping (docs/irrigation/recommendation-engine.md, verbatim table).
 * Risk level → feed priority. A LOW risk has no row in that table; it is not
 * emitted, because a feed item a farmer never needs to act on is noise.
 */
const RISK_PRIORITY = Object.freeze({
  CRITICAL: PRIORITIES.CRITICAL,
  HIGH: PRIORITIES.HIGH,
  MEDIUM: PRIORITIES.MEDIUM,
});

/** Irrigation verdict → priority. Absent means "do not materialise". */
const IRRIGATION_PRIORITY = Object.freeze({
  IRRIGATE_TODAY: PRIORITIES.HIGH,
  IRRIGATE_IN_N_DAYS: PRIORITIES.MEDIUM,
  WAIT_RAIN_EXPECTED: PRIORITIES.INFO,
  MAINTAIN_WATER_LEVEL: PRIORITIES.MEDIUM,
});

/**
 * Conflict precedence (recommendation-engine.md:16, verbatim):
 * "WEATHER-CRITICAL > HEALTH > IRRIGATION > MARKET".
 */
const TYPE_PRECEDENCE = Object.freeze({
  [FEED_TYPES.WEATHER_RISK]: 0,
  // Phase 3 emitters. Listed now because an absent key yields NaN in the
  // comparator, which is falsy and would silently drop the documented
  // precedence rather than fail loudly.
  health: 1,
  [FEED_TYPES.IRRIGATION]: 2,
  fertilizer: 3,
  [FEED_TYPES.MARKET]: 4,
  community: 5,
  'crop-suggestion': 6,
});

/** Unknown types sort last rather than poisoning the comparison with NaN. */
const precedenceOf = (type) => TYPE_PRECEDENCE[type] ?? Number.MAX_SAFE_INTEGER;

/** validUntil per type (recommendation-engine.md:20). */
export function validUntilFor({ type, asOf, eventDate, days }) {
  // `endOfDay` is the last instant of the IST day. Stamping 23:59:59.999 *UTC*
  // onto an IST calendar date — as this once did — lands at 05:29 IST the next
  // morning, so "irrigate today" stayed live five and a half hours into the
  // following day and overlapped the next day's dedup key.
  if (type === FEED_TYPES.IRRIGATION) {
    // "irrigation EOD"
    return endOfDay(asOf);
  }
  if (type === FEED_TYPES.WEATHER_RISK) {
    // "risk = event window" — the day the risk lands, end of day.
    return endOfDay(eventDate ?? asOf);
  }
  if (type === FEED_TYPES.MARKET) {
    // "market 48h"
    return new Date(asOf.getTime() + 2 * MS_PER_DAY);
  }
  return new Date(asOf.getTime() + (days ?? 1) * MS_PER_DAY);
}

/**
 * The dedup key. Deterministic and self-describing so a stored item explains
 * why it collided with another.
 */
export function dedupKeyFor({ userId, type, cropId, farmId, discriminator, asOf }) {
  return [
    String(userId),
    type,
    // A farm-level item has no crop; the literal keeps the key's arity fixed
    // so a crop item and a farm item can never produce the same string.
    cropId ? String(cropId) : `farm:${farmId ?? 'none'}`,
    discriminator ?? '-',
    dayKey(asOf),
  ].join('|');
}

// ── Candidate builders ───────────────────────────────────────────────────────

/**
 * @param {{userId, farmId, cropId, cropCode, result, asOf}} input
 * @returns {object|null} a candidate item, or null if this verdict does not
 *   belong in the feed
 */
export function irrigationCandidate({ userId, farmId, cropId, cropCode, result, asOf }) {
  if (!result?.hasVerdict) return null;

  const priority = IRRIGATION_PRIORITY[result.verdict];
  if (!priority) return null;

  return {
    userId,
    farmId,
    cropId,
    type: FEED_TYPES.IRRIGATION,
    priority,
    source: SOURCES.RULE_ENGINE,
    titleKey: `irrigation.title${result.verdict}`,
    bodyKey: `irrigation.body${result.verdict}`,
    discriminator: result.verdict,
    data: {
      cropCode,
      verdict: result.verdict,
      amountMm: result.amountMm ?? null,
      amountLitersPerAcre: result.amountLitersPerAcre ?? null,
      days: result.days ?? null,
      mode: result.mode,
      stage: result.stage ?? null,
      // R12: "No recommendation without trace data."
      trace: result.trace,
      freshness: result.freshness ?? null,
    },
    validUntil: validUntilFor({ type: FEED_TYPES.IRRIGATION, asOf }),
  };
}

export function weatherRiskCandidate({ userId, farmId, cropId, cropCode, risk, asOf }) {
  const priority = RISK_PRIORITY[risk.level];
  if (!priority) return null;

  return {
    userId,
    farmId,
    cropId,
    type: FEED_TYPES.WEATHER_RISK,
    priority,
    source: SOURCES.WEATHER,
    titleKey: `weather.title${risk.type}`,
    bodyKey: `weather.body${risk.type}`,
    // The risk type discriminates, so a frost and a heavy rain on the same
    // crop on the same day are two items rather than one overwriting the other.
    discriminator: risk.type,
    data: {
      cropCode,
      riskType: risk.type,
      level: risk.level,
      daysAhead: risk.daysAhead,
      date: risk.date,
      thresholdSource: risk.thresholdSource,
      // Spread onto the top level, not just nested: every `weather.bodyXXX`
      // i18n template (`{{humidityThresholdPct}}`, `{{consecutiveDays}}`,
      // `{{rainMm}}`, `{{tMinC}}`, …) interpolates against this object
      // directly, and i18next leaves an unmatched `{{placeholder}}` literally
      // in the rendered string rather than failing loudly — so a param that
      // exists only under `trace` renders as raw template syntax to the
      // farmer. `trace` is kept alongside, unchanged, for `WhyTrace`.
      ...risk.data,
      trace: risk.data,
    },
    validUntil: validUntilFor({
      type: FEED_TYPES.WEATHER_RISK,
      asOf,
      eventDate: risk.date,
    }),
  };
}

/**
 * Market items are emitted only on a signal *flip* (market-insights.md:16:
 * "Signal flip vs yesterday → MEDIUM feed item"), so a steadily rising price
 * produces one item, not one every night.
 */
export function marketCandidate({ userId, cropCode, signal, previousTrend, district, asOf }) {
  if (!signal?.trend || signal.trend === previousTrend) return null;

  return {
    userId,
    type: FEED_TYPES.MARKET,
    priority: PRIORITIES.MEDIUM,
    source: SOURCES.MARKET,
    titleKey: `market.title${signal.trend}`,
    bodyKey: signal.guidanceKey,
    discriminator: `${cropCode}:${signal.trend}`,
    data: {
      cropCode,
      trend: signal.trend,
      previousTrend: previousTrend ?? null,
      changePct7d: signal.changePct7d ?? null,
      changePct30d: signal.changePct30d ?? null,
      momentumDiverges: Boolean(signal.momentumDiverges),
      // `market.guidanceRising`/`guidanceFalling` interpolate `{{pct}}` (and
      // `guidanceRising` also `{{district}}`) against this object directly —
      // same class of bug as the weather-risk fix above. `pct` is a
      // magnitude (never negative; the template itself carries "up"/"down"),
      // rounded to one decimal so the sentence reads as a price, not a float.
      pct: signal.changePct7d == null ? null : Math.round(Math.abs(signal.changePct7d) * 10) / 10,
      district: district ?? null,
      trace: signal.trace ?? null,
    },
    validUntil: validUntilFor({ type: FEED_TYPES.MARKET, asOf }),
  };
}

// ── Contradiction resolution ─────────────────────────────────────────────────

/**
 * Rule table, not an LLM. Each entry names a pair that must not both reach the
 * farmer and the single item that replaces them.
 */
const CONTRADICTIONS = [
  {
    id: 'RAIN_VS_IRRIGATE',
    matches: (a, b) =>
      a.type === FEED_TYPES.IRRIGATION &&
      a.data.verdict === 'IRRIGATE_TODAY' &&
      b.type === FEED_TYPES.WEATHER_RISK &&
      b.data.riskType === 'HEAVY_RAIN',
    resolve: (irrigation, rain) => ({
      ...irrigation,
      source: SOURCES.HYBRID,
      // The rain is the more urgent fact and sets the level.
      priority: rain.priority,
      titleKey: 'irrigation.titleHoldForRain',
      bodyKey: 'irrigation.bodyHoldForRain',
      discriminator: 'HYBRID_RAIN_HOLD',
      data: {
        ...irrigation.data,
        supersedes: ['IRRIGATE_TODAY', 'HEAVY_RAIN'],
        // `irrigation.bodyHoldForRain` interpolates `{{rainMm}}` and
        // `{{date}}` directly — both now sit at the top level of `rain.data`
        // (weatherRiskCandidate's own fix, above), not three levels deep at
        // `rain.data.trace.rainMm`.
        rainMm: rain.data.rainMm,
        date: rain.data.date,
        rain: rain.data,
      },
    }),
  },
];

/**
 * Applies the rule table within each crop. Returns a new array; inputs are not
 * mutated (purity).
 */
export function resolveContradictions(candidates) {
  const byCrop = new Map();
  for (const candidate of candidates) {
    const key = candidate.cropId ? String(candidate.cropId) : '-';
    if (!byCrop.has(key)) byCrop.set(key, []);
    byCrop.get(key).push(candidate);
  }

  const resolved = [];

  for (const group of byCrop.values()) {
    const consumed = new Set();

    for (const rule of CONTRADICTIONS) {
      for (const a of group) {
        if (consumed.has(a)) continue;
        for (const b of group) {
          if (a === b || consumed.has(b)) continue;
          if (!rule.matches(a, b)) continue;

          consumed.add(a);
          consumed.add(b);
          resolved.push(rule.resolve(a, b));
          break;
        }
      }
    }

    for (const candidate of group) {
      if (!consumed.has(candidate)) resolved.push(candidate);
    }
  }

  return resolved;
}

// ── Composition ──────────────────────────────────────────────────────────────

/**
 * Deduplicates, orders and caps.
 *
 * @param {{candidates: object[], asOf: Date}} input
 * @returns {{items: object[], dropped: {duplicates: number, capped: number}}}
 */
export function composeFeed({ candidates = [], asOf = new Date() } = {}) {
  const resolved = resolveContradictions(candidates);

  // Dedup: one item per key. The higher-priority item wins a collision, so a
  // re-run that escalates a risk replaces rather than being discarded.
  const byKey = new Map();
  let duplicates = 0;

  for (const candidate of resolved) {
    const key = dedupKeyFor({ ...candidate, asOf });
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, { ...candidate, dedupKey: key });
      continue;
    }

    duplicates += 1;
    if (FEED_PRIORITY_RANK[candidate.priority] < FEED_PRIORITY_RANK[existing.priority]) {
      byKey.set(key, { ...candidate, dedupKey: key });
    }
  }

  const ordered = [...byKey.values()].sort(
    (a, b) =>
      FEED_PRIORITY_RANK[a.priority] - FEED_PRIORITY_RANK[b.priority] ||
      precedenceOf(a.type) - precedenceOf(b.type) ||
      // Total order: without a final tiebreak, two items written in the same
      // millisecond would order differently between runs.
      a.dedupKey.localeCompare(b.dedupKey),
  );

  // "Cap: max 20 active/user; INFO evicted first". The sort already puts INFO
  // last, so the cap is a slice — and the eviction count is reported rather
  // than silently applied.
  const items = ordered.slice(0, FEED_MAX_ACTIVE_PER_USER);

  return {
    items,
    dropped: { duplicates, capped: ordered.length - items.length },
  };
}

/** Query-time expiry predicate — expiry is a job, not a Mongo TTL. */
export const isActive = (item, asOf = new Date()) =>
  !item.acknowledgedAt && new Date(item.validUntil) > asOf;

export { FEED_PRIORITY_RANK };
