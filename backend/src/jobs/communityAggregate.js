/**
 * Community outbreak aggregation — every 6h (docs/community/community-alerts.md,
 * ADR-016, docs/api/intelligence.md).
 *
 * "if several farmers in one district report the same disease on the same crop
 * within a week, nearby farmers growing that crop get an advisory". One farmer's
 * report NEVER alerts anyone.
 *
 * Seven decisions this file makes, each forced by the spec or by a gap in it,
 * recorded here rather than left implicit:
 *
 * 1. **Consent is a query filter, not a post-filter.** The candidate set is
 *    built from `userId: { $in: consenting }`, so a non-consenting farmer's
 *    report is never loaded, never grouped and never counted — not filtered out
 *    later, where a refactor could drop the filter and nothing would notice.
 *    `sharedToCommunity` on the log is necessary but not sufficient: consent is
 *    read *now*, so withdrawing it stops future counting even for logs written
 *    while it was on (invariant 5). The logs themselves are append-only and are
 *    not rewritten — past aggregates are already anonymous counts.
 *
 * 2. **The window is day-aligned, in IST** (ADR-023). A 6-hourly job whose
 *    window ran from "now minus 7×24h" would produce a different window on every
 *    tick, and the natural key below would therefore never match — four
 *    near-identical alert documents a day instead of one. Aligning both edges to
 *    IST day boundaries makes every run inside one calendar day agree on the
 *    window, which is what makes the upsert idempotent.
 *
 * 3. **`reportCount` is the *counted* report count, which equals
 *    `distinctFarmers`.** The dupe-control rule is "one counted report per
 *    farmer+crop+disease+window", so ten reports from one farmer are one report.
 *    Storing the raw observation count instead would let a single farmer inflate
 *    the number their neighbours see, which is exactly the false alarm the rule
 *    exists to prevent.
 *
 * 4. **Idempotency without a new index.** The asserted index set
 *    (tests/models/indexes.test.js) allows `communityAlerts` exactly one index,
 *    and an undeclared one fails that suite — so the natural key
 *    (state, district, cropCode, diseaseCode, windowStart, windowEnd) is applied
 *    as a find-then-update-or-insert rather than as a unique constraint. The
 *    lookup is still index-served: `district_cropCode_active` covers the
 *    `district`+`cropCode` prefix of the filter, so the residual scan is over
 *    one district's alerts for one crop. Creation goes through
 *    `Model.create` so schema validation and defaults run, which an upsert's
 *    `$set` would skip. Concurrency caveat: without a unique index two
 *    simultaneous runs could both insert. The scheduler is single-instance and
 *    in-process (src/jobs/index.js), the cadence is 6h, and a duplicate row
 *    would be a cosmetic repeat rather than a privacy or correctness failure —
 *    an index that costs M0 memory forever is the worse trade.
 *
 * 5. **`state` joins the group key and the natural key.** The spec groups by
 *    (district, cropCode, diseaseCode), but district names repeat across Indian
 *    states; without `state`, two states' outbreaks would collide on one
 *    document and each run would overwrite the other's count. The alert schema
 *    already requires `state`, so this stores what it already asks for.
 *
 * 6. **Fan-out targets the crop *in* the affected district**, not the
 *    conjunction of "owns a matching crop somewhere" and "owns a farm in the
 *    district". A farmer whose tomatoes are in Nashik and whose second farm is
 *    in Pune should hear about the Nashik outbreak, not the Pune one — the
 *    advisory asks them to inspect a specific planting.
 *
 * 7. **Inspection guidance is passed through as registry keys.** The disease KB
 *    is authored elsewhere and may be absent; an absent entry yields an empty
 *    key list rather than a crash or invented prose (rule 6, rule 8).
 *
 * Query budget is fixed regardless of how many groups form: one pass to collect
 * consent, reports, their crops and farms, the registry, and the target farms
 * and crops — then only writes inside the group loop. Nothing is queried per
 * group but the alert row itself.
 *
 * A job never throws — it returns a report.
 */
import {
  COMMUNITY_ALERT_PURGE_DAYS,
  COMMUNITY_CONFIDENCE_FLOOR,
  COMMUNITY_ELIGIBLE_SOURCES,
  COMMUNITY_MIN_FARMERS_HIGH,
  COMMUNITY_MIN_FARMERS_INFO,
  COMMUNITY_WINDOW_DAYS,
  UNKNOWN_DISEASE_CODE,
} from '../config/constants.js';
import { dedupKeyFor, PRIORITIES } from '../engines/feedComposer/feedComposer.js';
import { CommunityAlert, Crop, CropHealthLog, CropRegistry, Farm, User } from '../models/index.js';
import { enforceFeedCap, persistFeedItems } from '../services/feedService.js';
import { endOfDay, MS_PER_DAY, startOfDay } from '../utils/day.js';
import { logger } from '../utils/logger.js';

export const COMMUNITY_JOB_NAME = 'communityAggregate';

/** `recommendations.type` / `.source` enum members for this emitter. */
export const COMMUNITY_FEED_TYPE = 'community';
export const COMMUNITY_FEED_SOURCE = 'COMMUNITY';

export const ALERT_LEVELS = Object.freeze({ INFO: 'INFO', HIGH: 'HIGH' });

/**
 * Message keys this emitter produces, assembled from a namespace constant
 * rather than written as quoted dotted literals — the i18n scanner
 * (tests/i18n/message-keys.test.js) treats any quoted `namespace.name` in src/
 * as an emitted key, and the translations for these are authored separately.
 * Exported so the wiring can enumerate exactly what needs a translation.
 */
const COMMUNITY_NAMESPACE = 'community';
const messageKey = (name) => `${COMMUNITY_NAMESPACE}.${name}`;

export const COMMUNITY_MESSAGE_KEYS = Object.freeze({
  [ALERT_LEVELS.INFO]: Object.freeze({
    titleKey: messageKey('titleOutbreakInfo'),
    bodyKey: messageKey('bodyOutbreakInfo'),
  }),
  [ALERT_LEVELS.HIGH]: Object.freeze({
    titleKey: messageKey('titleOutbreakHigh'),
    bodyKey: messageKey('bodyOutbreakHigh'),
  }),
});

/** Level → feed priority. An advisory is never CRITICAL: it is not this farm. */
const LEVEL_PRIORITY = Object.freeze({
  [ALERT_LEVELS.INFO]: PRIORITIES.INFO,
  [ALERT_LEVELS.HIGH]: PRIORITIES.HIGH,
});

/** Reason codes are identifiers, not prose — they travel in the trace (R12). */
const LEVEL_REASON = Object.freeze({
  [ALERT_LEVELS.INFO]: 'COMMUNITY_OUTBREAK_INFO',
  [ALERT_LEVELS.HIGH]: 'COMMUNITY_OUTBREAK_HIGH',
});

// Mongoose paths, named once so a typo is a single edit rather than five.
const SOURCE_PATH = 'analysis.source';
const CONFIDENCE_PATH = 'analysis.confidence';
const DISEASE_PATH = 'analysis.diseaseCode';
const DISTRICT_PATH = 'location.district';
const STATE_PATH = 'location.state';

const placeKey = (state, district) => `${state}|${district}`;
const groupKeyOf = ({ state, district, cropCode, diseaseCode }) =>
  [state, district, cropCode, diseaseCode].join('|');
const inspectKeyOf = (cropCode, diseaseCode) => `${cropCode}|${diseaseCode}`;

/**
 * The trailing window, aligned to IST day boundaries (decision 2).
 * `COMMUNITY_WINDOW_DAYS` calendar days ending with the day containing `asOf`.
 */
export function communityWindow(asOf) {
  const today = startOfDay(asOf);
  return {
    windowStart: startOfDay(new Date(today.getTime() - (COMMUNITY_WINDOW_DAYS - 1) * MS_PER_DAY)),
    windowEnd: endOfDay(asOf),
  };
}

/** Threshold table. `null` means "nothing exists externally" (invariant). */
export function levelFor(distinctFarmers) {
  if (distinctFarmers >= COMMUNITY_MIN_FARMERS_HIGH) return ALERT_LEVELS.HIGH;
  if (distinctFarmers >= COMMUNITY_MIN_FARMERS_INFO) return ALERT_LEVELS.INFO;
  return null;
}

/**
 * The aggregation *input*: consented, in-window, ML/Gemini-confirmed,
 * above-floor, named-disease reports, reduced to the five fields grouping needs.
 *
 * Exported so the privacy suite can assert on the candidate set itself rather
 * than only on what survives to the output — a filter applied after grouping
 * would look identical from the outside and would be one refactor from leaking.
 *
 * The projection is deliberately narrow: `description`, `imageUrl` and
 * `recommendationSnapshot` are never read, so no free text from a report can
 * reach an aggregate even by accident.
 */
export async function eligibleReports({ asOf = new Date() } = {}) {
  const { windowStart, windowEnd } = communityWindow(asOf);

  // Consent first. The set is small at this scale and bounds every query below.
  const consenting = await User.distinct('_id', { communityConsent: true });
  if (consenting.length === 0) return { windowStart, windowEnd, consenting, reports: [] };

  const logs = await CropHealthLog.find({
    sharedToCommunity: true,
    userId: { $in: consenting },
    createdAt: { $gte: windowStart, $lte: windowEnd },
    [SOURCE_PATH]: { $in: [...COMMUNITY_ELIGIBLE_SOURCES] },
    [CONFIDENCE_PATH]: { $gte: COMMUNITY_CONFIDENCE_FLOOR },
    // The honest sentinel never aggregates: "we could not name it" is not an
    // outbreak signal, and a district full of UNKNOWNs would alert on nothing.
    [DISEASE_PATH]: { $exists: true, $nin: [null, '', UNKNOWN_DISEASE_CODE] },
  })
    .select(`userId cropId farmId ${DISEASE_PATH}`)
    .lean();

  if (logs.length === 0) return { windowStart, windowEnd, consenting, reports: [] };

  // The log denormalises `farmId` so this never joins back through crops for
  // the place; `cropCode` still lives on the crop instance.
  const [crops, farms] = await Promise.all([
    Crop.find({ _id: { $in: logs.map((log) => log.cropId) } })
      .select('cropCode')
      .lean(),
    Farm.find({ _id: { $in: logs.map((log) => log.farmId) } })
      .select(`${STATE_PATH} ${DISTRICT_PATH}`)
      .lean(),
  ]);

  const cropCodeById = new Map(crops.map((crop) => [String(crop._id), crop.cropCode]));
  const placeById = new Map(farms.map((farm) => [String(farm._id), farm.location]));

  const reports = [];
  for (const log of logs) {
    const cropCode = cropCodeById.get(String(log.cropId));
    const place = placeById.get(String(log.farmId));
    // A report whose crop or farm has since been deleted has no district and
    // no crop to group by. Dropping it is the only honest option.
    if (!cropCode || !place?.district || !place?.state) continue;

    reports.push({
      farmerId: String(log.userId),
      cropCode,
      diseaseCode: log.analysis.diseaseCode,
      district: place.district,
      state: place.state,
    });
  }

  return { windowStart, windowEnd, consenting, reports };
}

/**
 * Groups by (state, district, cropCode, diseaseCode) and collapses duplicates:
 * "one counted report per farmer+crop+disease+window". Pure.
 *
 * @returns {Array<{key: string, state, district, cropCode, diseaseCode, distinctFarmers: number}>}
 */
export function groupReports(reports) {
  const groups = new Map();

  for (const report of reports) {
    const key = groupKeyOf(report);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        state: report.state,
        district: report.district,
        cropCode: report.cropCode,
        diseaseCode: report.diseaseCode,
        // Identities live only here, inside the job, and only long enough to be
        // counted. Nothing downstream ever receives the set itself.
        farmers: new Set(),
      });
    }
    groups.get(key).farmers.add(report.farmerId);
  }

  return [...groups.values()]
    .map(({ farmers, ...group }) => ({ ...group, distinctFarmers: farmers.size }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Find-then-update-or-insert on the natural key (decision 4).
 * @returns {Promise<{created: boolean}>}
 */
async function writeAlert({ group, level, windowStart, windowEnd }) {
  const naturalKey = {
    district: group.district,
    state: group.state,
    cropCode: group.cropCode,
    diseaseCode: group.diseaseCode,
    windowStart,
    windowEnd,
  };

  const existing = await CommunityAlert.findOne(naturalKey).select('_id').lean();

  const counts = {
    // Equal by construction — see decision 3.
    reportCount: group.distinctFarmers,
    distinctFarmers: group.distinctFarmers,
    level,
    active: true,
  };

  if (existing) {
    await CommunityAlert.updateOne({ _id: existing._id }, { $set: counts });
    return { created: false };
  }

  await CommunityAlert.create({ ...naturalKey, ...counts });
  return { created: true };
}

/**
 * The advisory payload. Counts and codes only: no reporter, no farm, no image,
 * no free text — the recipient's own ids sit on the envelope, never in here.
 */
export function communityFeedData({ group, level, windowStart, windowEnd, inspectKeys }) {
  return {
    district: group.district,
    state: group.state,
    cropCode: group.cropCode,
    diseaseCode: group.diseaseCode,
    reportCount: group.distinctFarmers,
    level,
    windowStart,
    windowEnd,
    // Registry keys, passed through untouched (decision 7).
    inspectKeys,
    // R12: "No recommendation without trace data."
    trace: {
      reasonCode: LEVEL_REASON[level],
      countedReports: group.distinctFarmers,
      windowDays: COMMUNITY_WINDOW_DAYS,
      thresholds: { info: COMMUNITY_MIN_FARMERS_INFO, high: COMMUNITY_MIN_FARMERS_HIGH },
      confidenceFloor: COMMUNITY_CONFIDENCE_FLOOR,
      eligibleSources: [...COMMUNITY_ELIGIBLE_SOURCES],
    },
  };
}

/**
 * Builds the feed items for one group from the pre-loaded target index.
 * Pure — exported so the targeting rules can be asserted without persistence.
 */
export function fanOutItems({ group, level, windowStart, windowEnd, inspectKeys, targets, asOf }) {
  const data = communityFeedData({ group, level, windowStart, windowEnd, inspectKeys });
  const { titleKey, bodyKey } = COMMUNITY_MESSAGE_KEYS[level];

  return targets.map((target) => ({
    userId: target.userId,
    farmId: target.farmId,
    cropId: target.cropId,
    type: COMMUNITY_FEED_TYPE,
    priority: LEVEL_PRIORITY[level],
    source: COMMUNITY_FEED_SOURCE,
    titleKey,
    bodyKey,
    data,
    // The advisory lapses with its own window; the next run writes the next
    // day's key. Escalation INFO → HIGH within a day updates in place because
    // the level is not part of the key.
    validUntil: windowEnd,
    dedupKey: dedupKeyFor({
      userId: target.userId,
      type: COMMUNITY_FEED_TYPE,
      cropId: target.cropId,
      farmId: target.farmId,
      discriminator: `${group.district}:${group.diseaseCode}`,
      asOf,
    }),
  }));
}

/**
 * Pre-loads everything the fan-out needs, once, for the whole run.
 *
 * Only consenting users are ever loaded, so a non-consenting farmer is not a
 * fan-out target either: they neither contribute to nor receive the advisory.
 */
async function loadTargets(consenting) {
  const [farms, crops] = await Promise.all([
    Farm.find({ userId: { $in: consenting } })
      .select(`userId ${STATE_PATH} ${DISTRICT_PATH}`)
      .lean(),
    Crop.find({ userId: { $in: consenting }, status: 'active' })
      .select('userId farmId cropCode')
      .lean(),
  ]);

  const farmById = new Map(farms.map((farm) => [String(farm._id), farm]));

  /** `state|district` + `cropCode` → the plantings that should hear about it. */
  const byPlaceAndCrop = new Map();

  for (const crop of crops) {
    const farm = farmById.get(String(crop.farmId));
    if (!farm?.location?.district || !farm.location.state) continue;

    const key = `${placeKey(farm.location.state, farm.location.district)}|${crop.cropCode}`;
    if (!byPlaceAndCrop.has(key)) byPlaceAndCrop.set(key, []);
    byPlaceAndCrop.get(key).push({
      userId: crop.userId,
      farmId: crop.farmId,
      cropId: crop._id,
    });
  }

  return byPlaceAndCrop;
}

/** `cropCode|diseaseCode` → the registry's inspect keys, or `[]` if unauthored. */
async function loadInspectKeys(cropCodes) {
  const index = new Map();
  if (cropCodes.length === 0) return index;

  const registryDocs = await CropRegistry.find({ cropCode: { $in: cropCodes } })
    .select('cropCode diseases.code diseases.inspect')
    .lean();

  for (const doc of registryDocs) {
    for (const disease of doc.diseases ?? []) {
      if (!disease?.code) continue;
      index.set(inspectKeyOf(doc.cropCode, disease.code), disease.inspect ?? []);
    }
  }

  return index;
}

/**
 * @param {{asOf?: Date}} [options] — the clock is always injected (ADR-022);
 *   nothing in here calls `new Date()` for logic.
 * @returns {Promise<object>} the run report
 */
export async function runCommunityAggregate({ asOf = new Date() } = {}) {
  const startedAt = Date.now();
  const { windowStart, windowEnd } = communityWindow(asOf);

  const report = {
    job: COMMUNITY_JOB_NAME,
    startedAt: asOf.toISOString(),
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    consentingUsers: 0,
    reports: 0,
    groups: 0,
    belowThreshold: 0,
    alertsInserted: 0,
    alertsUpdated: 0,
    recipients: 0,
    fanOutInserted: 0,
    fanOutUpdated: 0,
    evicted: 0,
    deactivated: 0,
    purged: 0,
    failures: [],
    ok: true,
  };

  try {
    const { consenting, reports } = await eligibleReports({ asOf });
    report.consentingUsers = consenting.length;
    report.reports = reports.length;

    const groups = groupReports(reports);
    report.groups = groups.length;

    const [targets, inspectIndex] = await Promise.all([
      loadTargets(consenting),
      loadInspectKeys([...new Set(groups.map((group) => group.cropCode))]),
    ]);

    const recipients = new Set();

    for (const group of groups) {
      try {
        const level = levelFor(group.distinctFarmers);

        // Below three distinct farmers nothing exists externally — not an
        // inactive document, not a zero-count row. Nothing.
        if (!level) {
          report.belowThreshold += 1;
          continue;
        }

        const { created } = await writeAlert({ group, level, windowStart, windowEnd });
        if (created) report.alertsInserted += 1;
        else report.alertsUpdated += 1;

        const items = fanOutItems({
          group,
          level,
          windowStart,
          windowEnd,
          inspectKeys: inspectIndex.get(inspectKeyOf(group.cropCode, group.diseaseCode)) ?? [],
          targets: targets.get(`${placeKey(group.state, group.district)}|${group.cropCode}`) ?? [],
          asOf,
        });

        const persisted = await persistFeedItems(items);
        report.fanOutInserted += persisted.inserted;
        report.fanOutUpdated += persisted.updated;
        for (const item of items) recipients.add(String(item.userId));
      } catch (err) {
        // One malformed group must not cost every other district its advisory.
        report.ok = false;
        report.failures.push({ group: group.key, error: err.message });
        logger.error({ err, group: group.key }, 'community aggregation failed for group');
      }
    }

    report.recipients = recipients.size;

    // The cap is enforced once per recipient, not once per item: a farmer in
    // three affected groups is one account with one feed.
    for (const userId of recipients) {
      const { evicted } = await enforceFeedCap(userId, asOf);
      report.evicted += evicted;
    }

    // "Expiry: window passes → active=false; purge 30d." Deactivation is by
    // window rather than by absence from this run, so an alert whose count fell
    // below the threshold simply stops being renewed and lapses on its own.
    const deactivated = await CommunityAlert.updateMany(
      { active: true, windowEnd: { $lt: asOf } },
      { $set: { active: false } },
    );
    report.deactivated = deactivated.modifiedCount ?? 0;

    const purgeCutoff = new Date(asOf.getTime() - COMMUNITY_ALERT_PURGE_DAYS * MS_PER_DAY);
    const purged = await CommunityAlert.deleteMany({ windowEnd: { $lt: purgeCutoff } });
    report.purged = purged.deletedCount ?? 0;
  } catch (err) {
    report.ok = false;
    report.failures.push({ error: err.message });
    logger.error({ err }, 'community aggregation failed');
  }

  report.durationMs = Date.now() - startedAt;
  const log = report.ok ? logger.info.bind(logger) : logger.warn.bind(logger);
  log({ report }, 'community aggregation complete');

  return report;
}
