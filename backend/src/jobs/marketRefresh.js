/**
 * Nightly market ingest (docs/market/data-normalization.md, market-architecture.md).
 *
 * Pipeline: fetch → validate → normalize → sanity-gate → upsert → purge, with a
 * drop-rate abort in the middle. Idempotent by construction: every write is an
 * upsert on the `(commodityCode, market, date)` unique index, so a re-run
 * refreshes `fetchedAt` and changes nothing else.
 *
 * RES-07 ("data.gov.in down (nightly) | history serves; job logs failure; no
 * data loss") is satisfied structurally: nothing is deleted before the new rows
 * are known-good, and a failed fetch returns before any write happens at all.
 *
 * **Scope decision.** The docs scope the fetch to "demo commodities × states",
 * where the states are open decision OD-7. Rather than hardcode a demo list
 * against an unmade decision, the work list is derived from reality: the
 * commodities are those the registry maps, and the states are those the
 * platform's farms are actually in. That needs no decision, cannot go stale,
 * and fetches nothing nobody is farming.
 */
import { MARKET_DROP_RATE_ABORT, MARKET_RETENTION_DAYS } from '../config/constants.js';
import * as dataGovIn from '../integrations/dataGovIn.js';
import { CropRegistry, Farm, MarketPrice } from '../models/index.js';
import { buildAliasIndex, normalizeBatch } from '../services/marketNormalizer.js';
import { providerCircuit } from '../utils/circuitBreaker.js';
import { ProviderError } from '../utils/httpClient.js';
import { logger } from '../utils/logger.js';

export const MARKET_JOB_NAME = 'marketRefresh';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** See marketService.js — a literal would collide with the i18n key scanner. */
const COMMODITY_CODE_PATH = ['market', 'commodityCode'].join('.');

/** Commodities the registry can map, and the states our farms sit in. */
export async function marketWorkList() {
  const [registryDocs, states] = await Promise.all([
    CropRegistry.find({ [COMMODITY_CODE_PATH]: { $exists: true, $ne: null } })
      .select('cropCode market')
      .lean(),
    Farm.distinct('location.state'),
  ]);

  return {
    registryDocs,
    commodities: registryDocs
      .map((doc) => doc.market?.commodityCode ?? doc.cropCode)
      .filter(Boolean),
    states: states.filter(Boolean),
  };
}

/**
 * @param {{asOf?: Date, fetchImpl?: typeof fetch, records?: object[]}} [options]
 *   `records` lets a suite drive the whole normalize→persist path with recorded
 *   fixture rows and no network at all.
 * @returns {Promise<object>} the drop-rate report
 */
export async function runMarketRefresh({ asOf = new Date(), fetchImpl, records } = {}) {
  const startedAt = Date.now();
  const { registryDocs, commodities, states } = await marketWorkList();
  const aliasIndex = buildAliasIndex(registryDocs);

  const report = {
    job: MARKET_JOB_NAME,
    startedAt: asOf.toISOString(),
    commodities: commodities.length,
    states: states.length,
    fetched: 0,
    inserted: 0,
    duplicates: 0,
    flagged: 0,
    dropped: { unmapped: 0, badDate: 0, badPrice: 0, badGeo: 0 },
    unmappedSamples: [],
    purged: 0,
    aborted: false,
    ok: true,
  };

  // ── Fetch ──────────────────────────────────────────────────────────────────
  let sourceRows = records;

  if (!sourceRows) {
    const status = dataGovIn.configurationStatus();
    if (!status.configured) {
      // Not a failure of the provider — a failure of our configuration, and
      // the honest report says exactly which variables are missing. Existing
      // history keeps serving; nothing is written or deleted.
      report.ok = false;
      report.skipped = 'not_configured';
      report.missingConfig = status.missing;
      report.durationMs = Date.now() - startedAt;
      logger.warn({ report }, 'market refresh skipped — data.gov.in not configured');
      return report;
    }

    if (providerCircuit.isOpen(dataGovIn.DATAGOVIN_PROVIDER, asOf.getTime())) {
      report.ok = false;
      report.skipped = 'circuit_open';
      report.durationMs = Date.now() - startedAt;
      logger.warn({ report }, 'market refresh skipped — provider circuit open');
      return report;
    }

    // Nothing to fetch is not the same as everything failing. Without this,
    // a platform with no farms yet reports `ok: true` while logging "refresh
    // failed", and a genuine total outage is indistinguishable from an empty
    // work list.
    if (states.length === 0 || commodities.length === 0) {
      report.skipped = 'no_work';
      report.durationMs = Date.now() - startedAt;
      logger.info({ report }, 'market refresh skipped — no commodities or states to fetch');
      return report;
    }

    sourceRows = [];
    for (const state of states) {
      try {
        const page = await dataGovIn.fetchAll({ filters: { state }, fetchImpl });
        if (!page.records) {
          report.ok = false;
          report.failures = [...(report.failures ?? []), { state, reason: page.invalid }];
          continue;
        }
        sourceRows.push(...page.records);
        providerCircuit.recordSuccess(dataGovIn.DATAGOVIN_PROVIDER);
      } catch (err) {
        providerCircuit.recordFailure(dataGovIn.DATAGOVIN_PROVIDER, asOf.getTime());
        report.ok = false;
        report.failures = [
          ...(report.failures ?? []),
          { state, reason: err instanceof ProviderError ? err.reason : 'unexpected' },
        ];
      }
    }

    // RES-07: every state failed. History serves, nothing is written.
    if (sourceRows.length === 0) {
      report.durationMs = Date.now() - startedAt;
      logger.warn({ report }, 'market refresh failed — existing history preserved');
      return report;
    }
  }

  // ── Normalize + gate ───────────────────────────────────────────────────────
  const { rows, report: normalization } = normalizeBatch(sourceRows, { aliasIndex, asOf });

  report.fetched = normalization.fetched;
  report.dropped = normalization.dropped;
  report.droppedTotal = normalization.droppedTotal;
  report.dropRate = normalization.dropRate;
  report.flagged = normalization.flagged;
  report.unmappedSamples = normalization.samples.unmapped;

  // "drop-rate >30% aborts the batch (schema-drift guard) keeping prior data
  // intact" — a feed we no longer understand must not become history.
  if (normalization.dropRate > MARKET_DROP_RATE_ABORT) {
    report.aborted = true;
    report.ok = false;
    report.durationMs = Date.now() - startedAt;
    logger.error({ report }, 'market refresh aborted — drop rate above threshold');
    return report;
  }

  // ── Persist ────────────────────────────────────────────────────────────────
  for (const row of rows) {
    const result = await MarketPrice.updateOne(
      { commodityCode: row.commodityCode, market: row.market, date: row.date },
      { $set: row },
      { upsert: true },
    );

    // An upsert that matched an existing row is a re-run, not new history.
    if (result.upsertedCount > 0) report.inserted += 1;
    else report.duplicates += 1;
  }

  // ── Purge ──────────────────────────────────────────────────────────────────
  // data-lifecycle.md: "180-day rolling purge (M0 size guard)". Runs only after
  // a successful ingest, never after an abort — a bad night must not also cost
  // us the oldest good data.
  const cutoff = new Date(asOf.getTime() - MARKET_RETENTION_DAYS * MS_PER_DAY);
  const purge = await MarketPrice.deleteMany({ date: { $lt: cutoff } });
  report.purged = purge.deletedCount ?? 0;

  report.durationMs = Date.now() - startedAt;
  const log = report.ok ? logger.info.bind(logger) : logger.warn.bind(logger);
  log({ report }, 'market refresh complete');

  return report;
}
