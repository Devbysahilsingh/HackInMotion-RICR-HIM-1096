/**
 * Job registry and last-run state.
 *
 * `/healthz` is contracted to report "jobs lastRun" (docs/deployment/
 * architecture.md), and there is deliberately no `jobRuns` collection — the
 * collection roster is fixed at 14 and CLAUDE.md forbids adding one without
 * documented justification. Run state therefore lives in memory, which is
 * honest at this scale: the free tier runs a single instance, and a restart
 * genuinely has run nothing yet.
 *
 * Catch-up on boot is required (docs/deployment/backend.md: "each job also runs
 * on boot if overdue"). In-memory state cannot say what happened before a
 * restart, so rather than probe for overdue-ness, **every job simply runs at
 * the first tick after boot**. That is safe because each one is idempotent —
 * weather and market upsert on a unique index, the feed upserts on `dedupKey`,
 * and expiry deletes only what is already past its grace period — so an
 * unnecessary catch-up run costs one provider call and never a duplicate row.
 */
import { createScheduler } from './scheduler.js';
import { runWeatherRefresh, WEATHER_JOB_NAME } from './weatherRefresh.js';
import { runMarketRefresh, MARKET_JOB_NAME } from './marketRefresh.js';
import { runFeedRefresh, FEED_JOB_NAME } from './feedRefresh.js';
import { runExpiry, EXPIRY_JOB_NAME } from './expiry.js';
import { runCommunityAggregate, COMMUNITY_JOB_NAME } from './communityAggregate.js';
import {
  COMMUNITY_AGGREGATION_INTERVAL_MS,
  FEED_REFRESH_INTERVAL_MS,
  MARKET_REFRESH_INTERVAL_MS,
  WEATHER_REFRESH_INTERVAL_MS,
} from '../config/constants.js';

/** @type {Map<string, object>} last report per job, newest only. */
const lastRuns = new Map();

function record(name, report) {
  lastRuns.set(name, {
    at: new Date().toISOString(),
    ok: report?.ok !== false,
    ...report,
  });
  return report;
}

/**
 * Reported by /healthz. Trimmed to the fields an operator needs: a full run
 * report can carry per-location failure lists that do not belong in a public
 * probe response.
 */
export function jobStatus() {
  return Object.fromEntries(
    [...lastRuns.entries()].map(([name, report]) => [
      name,
      {
        at: report.at,
        ok: report.ok,
        durationMs: report.durationMs ?? null,
      },
    ]),
  );
}

/**
 * Jobs are appended by the TODO that introduces each one, so the registry
 * always describes what actually runs rather than what is planned.
 */
export const JOBS = [
  {
    name: WEATHER_JOB_NAME,
    everyMs: WEATHER_REFRESH_INTERVAL_MS,
    handler: ({ now }) => runWeatherRefresh({ asOf: now }).then((r) => record(WEATHER_JOB_NAME, r)),
  },
  {
    name: MARKET_JOB_NAME,
    everyMs: MARKET_REFRESH_INTERVAL_MS,
    handler: ({ now }) => runMarketRefresh({ asOf: now }).then((r) => record(MARKET_JOB_NAME, r)),
  },
  {
    name: FEED_JOB_NAME,
    everyMs: FEED_REFRESH_INTERVAL_MS,
    handler: ({ now }) => runFeedRefresh({ asOf: now }).then((r) => record(FEED_JOB_NAME, r)),
  },
  {
    // Runs before expiry so a window that closed this tick is aggregated and
    // then lapsed in the same pass, rather than lingering a full cycle.
    name: COMMUNITY_JOB_NAME,
    everyMs: COMMUNITY_AGGREGATION_INTERVAL_MS,
    handler: ({ now }) =>
      runCommunityAggregate({ asOf: now }).then((r) => record(COMMUNITY_JOB_NAME, r)),
  },
  {
    name: EXPIRY_JOB_NAME,
    // Purge granularity is 7 days, so a daily sweep is ample and cheap.
    everyMs: 24 * 60 * 60 * 1000,
    handler: ({ now }) => runExpiry({ asOf: now }).then((r) => record(EXPIRY_JOB_NAME, r)),
  },
];

export const scheduler = createScheduler({ jobs: JOBS });

export { lastRuns };
