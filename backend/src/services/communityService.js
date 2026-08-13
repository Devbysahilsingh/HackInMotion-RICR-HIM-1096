/**
 * Community reads and the consent toggle (docs/community/community-alerts.md,
 * ADR-016, docs/api/intelligence.md: `GET /community/alerts?district=&state=`).
 *
 * There is no write API for alerts — "aggregation only" — so everything in this
 * file is either a read or the farmer's own consent flag.
 *
 * **What a recipient sees.** The privacy design says recipients see "district,
 * crop, disease, report count, window — nothing else"; the API contract lists
 * `[{district, cropCode, diseaseCode, reportCount, level, windowEnd}]`. The
 * projection below is the API contract plus exactly two fields, and omits one:
 *
 *   · `state` is added because district names repeat across Indian states, and
 *     the aggregation groups on (state, district) for that reason — serving the
 *     district without it would render "Bilaspur" ambiguously. It identifies a
 *     state, not a person.
 *   · `windowStart` is added because "window" in the privacy design is a window,
 *     not an end date: without it a client can only say "this week" as an
 *     assumption. It is the same constant offset for every alert, so it reveals
 *     nothing the job's schedule does not already publish.
 *   · `distinctFarmers` is **omitted**. It is not in the API contract and not in
 *     the recipient's list, and by construction it equals `reportCount` anyway
 *     (dupe control counts one report per farmer), so publishing it would add no
 *     information while creating a second, differently-named population counter
 *     that a future change could silently let drift away from the published one.
 *     The stored field stays — it is the count the threshold is applied to.
 *
 * `_id`, `createdAt` and `updatedAt` are omitted for the same reason: nothing
 * addresses an alert individually (there is no acknowledge, no detail route),
 * so an identifier would be surface with no purpose.
 */
import { CommunityAlert, Farm, User } from '../models/index.js';

/**
 * Ceiling on the candidate set pulled into memory for ordering.
 *
 * Alerts are bounded in practice by (a farmer's districts) × (crops) ×
 * (diseases) for one window, which is small; this exists only so that a
 * pathological district cannot make one request unbounded. Mirrors the same
 * guard in feedService.
 */
const ALERT_SCAN_LIMIT = 200;

/** HIGH before INFO. The stored strings happen to sort that way; not relied on. */
const LEVEL_RANK = { HIGH: 0, INFO: 1 };

const DISTRICT_PATH = 'location.district';
const STATE_PATH = 'location.state';

/**
 * The wire shape. Plain, serialisable, and deliberately assembled field by
 * field rather than by deleting from the document — a field added to the schema
 * cannot start being served by accident.
 */
export function toCommunityAlertJSON(alert) {
  return {
    district: alert.district,
    state: alert.state,
    cropCode: alert.cropCode,
    diseaseCode: alert.diseaseCode,
    reportCount: alert.reportCount,
    level: alert.level,
    windowStart: alert.windowStart,
    windowEnd: alert.windowEnd,
  };
}

/**
 * Active advisories for a district, or — with no district given — for every
 * district the caller actually farms in ("auto from profile if params
 * omitted").
 *
 * `windowEnd > asOf` is applied on top of `active`, not instead of it: the
 * aggregation job flips `active` every six hours, so between a window lapsing
 * at midnight IST and the next run an already-stale alert would otherwise still
 * read as current. The feed read guards `validUntil` the same way.
 *
 * @param {string|object} userId
 * @param {{district?: string, state?: string, asOf?: Date}} [query]
 * @returns {Promise<object[]>}
 */
export async function listCommunityAlerts(userId, { district, state, asOf = new Date() } = {}) {
  const filter = { active: true, windowEnd: { $gt: asOf } };

  if (district) {
    filter.district = district;
    if (state) filter.state = state;
  } else {
    // Ownership is not at stake — an alert is an anonymous district count — but
    // a farmer with no farms has no districts, and returning every district's
    // alerts would be noise rather than a privacy failure.
    const farms = await Farm.find({ userId }).select(`${STATE_PATH} ${DISTRICT_PATH}`).lean();
    const districts = [...new Set(farms.map((farm) => farm.location?.district).filter(Boolean))];
    if (districts.length === 0) return [];

    filter.district = { $in: districts };
    const states = state
      ? [state]
      : [...new Set(farms.map((farm) => farm.location?.state).filter(Boolean))];
    if (states.length > 0) filter.state = { $in: states };
  }

  const alerts = await CommunityAlert.find(filter)
    // A second line of defence under the projection function: the population
    // counter is not even read out of the database.
    .select('district state cropCode diseaseCode reportCount level windowStart windowEnd')
    .limit(ALERT_SCAN_LIMIT)
    .lean();

  return alerts
    .sort(
      (a, b) =>
        LEVEL_RANK[a.level] - LEVEL_RANK[b.level] ||
        b.reportCount - a.reportCount ||
        a.cropCode.localeCompare(b.cropCode) ||
        a.diseaseCode.localeCompare(b.diseaseCode) ||
        a.district.localeCompare(b.district),
    )
    .map(toCommunityAlertJSON);
}

/**
 * The opt-in toggle (`users.communityConsent`, default false).
 *
 * Turning it off stops future counting — the aggregation reads consent at run
 * time, so a withdrawn account's reports stop being eligible immediately, even
 * those written while it was on. Past aggregates are untouched because they are
 * already anonymous counts with nothing to withdraw, and `cropHealthLogs` is
 * append-only.
 *
 * @returns {Promise<{communityConsent: boolean}|null>} null if no such user
 */
export async function setCommunityConsent(userId, communityConsent) {
  const user = await User.findByIdAndUpdate(
    userId,
    { $set: { communityConsent: Boolean(communityConsent) } },
    { new: true },
  )
    .select('communityConsent')
    .lean();

  return user ? { communityConsent: user.communityConsent } : null;
}
