/**
 * Scheduler abstraction.
 *
 * The design constraint is testability: a q3h job and a nightly job cannot be
 * proven by a suite that waits three hours. So time is a *parameter*, not an
 * ambient fact. `tick(now)` decides what is due; production calls it from one
 * cheap interval, and a test calls it directly with whatever instant it wants.
 * There are no fake timers anywhere in this project (ADR-022) — this is why
 * none are needed.
 *
 * Two further properties the jobs rely on:
 *
 *   - **A job never overlaps itself.** A run that is still in flight when the
 *     next tick arrives is skipped, not queued. Weather and market ingestion
 *     both upsert, so an overlap would be harmless but wasteful of free-tier
 *     provider quota (CLAUDE.md rule 10).
 *   - **A throwing job never stops the scheduler.** A provider outage must
 *     degrade one job, not silently kill every future run of all of them.
 */
import { logger } from '../utils/logger.js';

/**
 * @typedef {object} JobDefinition
 * @property {string} name              stable id; appears in logs and audit rows
 * @property {number} everyMs           minimum spacing between runs
 * @property {(context: {now: Date}) => Promise<unknown>} handler
 * @property {boolean} [runOnStart]     run at the first tick rather than waiting
 */

/**
 * @param {{ jobs: JobDefinition[] }} config
 */
export function createScheduler({ jobs }) {
  /** @type {Map<string, {lastStartedAt: number|null, running: boolean}>} */
  const state = new Map(jobs.map((job) => [job.name, { lastStartedAt: null, running: false }]));

  const byName = new Map(jobs.map((job) => [job.name, job]));

  function isDue(job, nowMs) {
    const entry = state.get(job.name);
    if (entry.running) return false;

    if (entry.lastStartedAt === null) {
      if (job.runOnStart !== false) return true;
      // A job that opts out of the boot run must still start its clock, or it
      // stays undue forever: `lastStartedAt` is otherwise only written by
      // `run()`, so "skip the first tick" would silently become "never run".
      // Stamping it here defers the job by one full interval, which is what
      // `runOnStart: false` means.
      entry.lastStartedAt = nowMs;
      return false;
    }

    return nowMs - entry.lastStartedAt >= job.everyMs;
  }

  /**
   * Runs one job regardless of schedule — the path an external cron trigger
   * takes, and the path a test uses to exercise a handler directly.
   * @returns {Promise<{name: string, status: 'ok'|'failed'|'skipped', result?: unknown, error?: Error, durationMs: number}>}
   */
  async function run(name, now = new Date()) {
    const job = byName.get(name);
    if (!job) throw new Error(`unknown job: ${name}`);

    const entry = state.get(name);
    if (entry.running) return { name, status: 'skipped', durationMs: 0 };

    entry.running = true;
    entry.lastStartedAt = now.getTime();
    const startedAt = now.getTime();

    try {
      const result = await job.handler({ now });
      return { name, status: 'ok', result, durationMs: Date.now() - startedAt };
    } catch (err) {
      // Logged here so a job that nobody awaits still leaves a trace; the
      // caller decides whether a failure is fatal.
      logger.error({ err, job: name }, 'scheduled job failed');
      return { name, status: 'failed', error: err, durationMs: Date.now() - startedAt };
    } finally {
      entry.running = false;
    }
  }

  /**
   * Runs everything due at `now`. Jobs run concurrently: they touch disjoint
   * collections, and serialising them would let a slow weather fetch delay the
   * nightly market ingest past its window.
   */
  async function tick(now = new Date()) {
    const due = jobs.filter((job) => isDue(job, now.getTime()));
    return Promise.all(due.map((job) => run(job.name, now)));
  }

  /**
   * Production wiring. One unref'd interval — it must never hold the process
   * open during a graceful shutdown.
   */
  function start({ intervalMs = 60_000 } = {}) {
    const timer = setInterval(() => {
      tick(new Date()).catch((err) => logger.error({ err }, 'scheduler tick failed'));
    }, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }

  return { tick, run, start, jobNames: () => [...byName.keys()] };
}
