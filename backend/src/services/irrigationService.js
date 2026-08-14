/**
 * Irrigation orchestration: gathers the engine's inputs, records the ledger.
 *
 * The split docs/irrigation/irrigation-model.md insists on is kept literally:
 * DATA is assembled here, CALCULATION happens in the pure engine, and
 * RECOMMENDATION (i18n keys, priority) happens in the route and the feed
 * composer. "Presentation never alters math" — nothing in this file adjusts a
 * number the engine produced.
 *
 * Reads only. No provider is contacted (CLAUDE.md rule 3): the ET₀ series comes
 * from the cached snapshot the weather job wrote.
 */
import { computeIrrigation } from '../engines/irrigation/computeIrrigation.js';
import { CropRegistry, IrrigationLog } from '../models/index.js';
import { validationError } from '../utils/errors.js';
import { freshnessOf, latestSnapshot } from './weatherService.js';

/** MongoDB duplicate-key error code — the signal a replay was collapsed. */
const DUPLICATE_KEY = 11000;

/**
 * Runs the engine for one crop.
 *
 * @param {object} crop  an already-authorized Crop document
 * @param {object} farm  its farm (soil type, location) — already authorized
 * @param {{asOf?: Date}} [options]
 */
export async function irrigationAdvice(crop, farm, { asOf = new Date() } = {}) {
  const [registry, snapshot, logs] = await Promise.all([
    CropRegistry.findOne({ cropCode: crop.cropCode }).lean(),
    latestSnapshot(farm.locationKey),
    // The ledger only ever replays the last 7 days, so the query is bounded
    // rather than fetching a season of logs to discard most of them.
    IrrigationLog.find({
      cropId: crop._id,
      userId: crop.userId,
      date: { $gte: new Date(asOf.getTime() - 30 * 24 * 60 * 60 * 1000) },
    })
      .sort({ date: -1 })
      .lean(),
  ]);

  const result = computeIrrigation({
    crop: {
      sowingDate: crop.sowingDate,
      status: crop.status,
      waterBalance: crop.waterBalance,
    },
    registry: registry ?? {},
    soilType: farm.soilType,
    dailyWeather: snapshot?.daily ?? [],
    logs: logs.map((log) => ({ date: log.date, amountMm: log.amountMm })),
    asOf,
  });

  return {
    ...result,
    // Honesty label (rule 9): the verdict is only as fresh as the weather
    // behind it, and a verdict computed from a three-day-old snapshot must
    // say so rather than presenting itself as current.
    freshness: freshnessOf(snapshot, asOf),
  };
}

/**
 * Persists the crop's water-balance state after a computation.
 *
 * Kept separate from `irrigationAdvice` and called only by the feed job, not by
 * the read endpoint: a GET must not mutate, and two concurrent dashboard loads
 * must not race to write the same ledger.
 */
export async function persistWaterBalance(Crop, cropId, userId, result, asOf) {
  if (!result?.hasVerdict || typeof result.depletionMm !== 'number') return null;

  return Crop.updateOne(
    { _id: cropId, userId },
    {
      $set: {
        'waterBalance.depletionMm': result.depletionMm,
        'waterBalance.lastComputedAt': asOf,
        'waterBalance.initialized': true,
      },
    },
  );
}

/**
 * Validates a ledger entry against the crop it belongs to.
 * docs/api/irrigation.md: "Validation: date ∈ [sowingDate, today]."
 */
export function assertLogDateInRange(date, crop, asOf = new Date()) {
  const sowing = new Date(crop.sowingDate);
  const endOfToday = new Date(asOf);
  endOfToday.setHours(23, 59, 59, 999);

  if (date > endOfToday) {
    throw validationError([{ field: 'date', rule: 'future_date' }]);
  }
  // A log before sowing cannot describe this planting, and would silently
  // anchor the ledger to a date the crop did not exist.
  if (date < new Date(sowing).setHours(0, 0, 0, 0)) {
    throw validationError([{ field: 'date', rule: 'before_sowing' }]);
  }
}

/**
 * Records an irrigation event.
 *
 * **Not idempotent on the event, deliberately.** A farmer genuinely can
 * irrigate twice in one day — a unique `(cropId, date)` index would reject the
 * second event as a duplicate and under-count the water applied, which is the
 * more dangerous error. That decision is unchanged.
 *
 * **Idempotent on the submission, when the client asks for it.** The offline
 * queue (docs/offline/offline-strategy.md) may replay a write it never saw
 * acknowledged — the request left the phone, the response did not come back.
 * Without dedupe that replay double-waters the ledger and shifts the verdict.
 * A `clientRequestId` distinguishes the two cases precisely: two waterings on
 * one day carry two different ids and both persist; one watering delivered
 * twice carries the same id and lands once.
 *
 * **Two mechanisms, because one is not enough.** The unique partial index is
 * the race-proof authority: two concurrent flushes both pass a read-then-write
 * check, and only the index can stop the second write. But an index exists only
 * once `npm run indexes:build` has been run against that database, and a
 * deployment that skipped it would degrade *silently* — every replay writing a
 * second row and over-counting the water applied. So the lookup below runs
 * first as well. The index handles the concurrent case, the lookup handles the
 * un-migrated case, and neither alone covers both.
 *
 * @returns {Promise<{log: object, replayed: boolean}>} `replayed` is true when
 *   the id had already been recorded, so the route can answer 200 rather than
 *   claim a 201 it did not perform.
 */
export async function recordIrrigation({ crop, userId, date, amountMm, clientRequestId }) {
  const doc = {
    userId,
    cropId: crop._id,
    date,
    amountMm,
    // R8: an entry with no amount means "refilled to field capacity", which the
    // engine treats as a full reset — so it is recorded as an assumption, not
    // as a farmer-stated quantity.
    source: amountMm === undefined ? 'assumed' : 'farmer',
    ...(clientRequestId ? { clientRequestId } : {}),
  };

  if (!clientRequestId) {
    return { log: await IrrigationLog.create(doc), replayed: false };
  }

  // Scoped by userId as well as the id, here and below: the lookup can only
  // ever return this farmer's own row, so a guessed id cannot surface — or
  // probe for — another account's ledger.
  const alreadyRecorded = await IrrigationLog.findOne({ userId, clientRequestId });
  if (alreadyRecorded) return { log: alreadyRecorded, replayed: true };

  try {
    return { log: await IrrigationLog.create(doc), replayed: false };
  } catch (err) {
    if (err?.code !== DUPLICATE_KEY) throw err;

    // Lost the race to a concurrent flush of the same queued item. The index
    // did its job; the row that won is the answer.
    const existing = await IrrigationLog.findOne({ userId, clientRequestId });
    if (!existing) throw err;

    return { log: existing, replayed: true };
  }
}

/** Ledger history for the trace UI (docs/api/irrigation.md). */
export async function listIrrigationLogs(crop, { page, limit }) {
  const filter = { cropId: crop._id, userId: crop.userId };

  const [logs, total] = await Promise.all([
    IrrigationLog.find(filter)
      .sort({ date: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    IrrigationLog.countDocuments(filter),
  ]);

  return {
    logs: logs.map((log) => ({
      id: String(log._id),
      date: log.date,
      amountMm: log.amountMm ?? null,
      source: log.source,
    })),
    total,
  };
}
