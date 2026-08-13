/**
 * Scheduler — unit tests.
 *
 * The whole point of the abstraction is that `tick(now)` takes the instant as
 * an argument, so a q3h job is provable in microseconds without a fake timer
 * (ADR-022). Every case below therefore passes an explicit `now`; the only
 * real timing anywhere is the manually-resolved promise used to hold a handler
 * open across two ticks.
 *
 * The three properties under test are the ones the ingestion jobs depend on:
 * due-ness, non-overlap, and a throwing handler that degrades one job rather
 * than the scheduler.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createScheduler } from '../../src/jobs/scheduler.js';

/** A fixed epoch, so every expectation below is a literal. */
const T0 = new Date('2026-08-13T00:00:00.000Z');
const at = (ms) => new Date(T0.getTime() + ms);

const HOUR = 60 * 60 * 1000;

/** A job that records the `now` it was handed, so due-ness is observable. */
function recordingJob(overrides = {}) {
  const runs = [];
  return {
    runs,
    definition: {
      name: 'recorder',
      everyMs: 3 * HOUR,
      handler: async ({ now }) => {
        runs.push(now.toISOString());
        return { ran: runs.length };
      },
      ...overrides,
    },
  };
}

// ── Due-ness ────────────────────────────────────────────────────────────────

describe('scheduler · tick runs a job only when it is due', () => {
  it('runs on the first tick, then not again until everyMs has elapsed', async () => {
    const { runs, definition } = recordingJob();
    const scheduler = createScheduler({ jobs: [definition] });

    const first = await scheduler.tick(T0);
    assert.equal(first.length, 1);
    assert.equal(first[0].name, 'recorder');
    assert.equal(first[0].status, 'ok');
    assert.deepEqual(first[0].result, { ran: 1 });

    assert.deepEqual(await scheduler.tick(at(HOUR)), [], 'ran an hour into a 3h cadence');
    assert.deepEqual(await scheduler.tick(at(3 * HOUR - 1)), [], 'ran 1ms early');

    const due = await scheduler.tick(at(3 * HOUR));
    assert.equal(due.length, 1);
    assert.equal(runs.length, 2);
  });

  it('measures the interval from the last start, not from the first tick', async () => {
    const { runs, definition } = recordingJob();
    const scheduler = createScheduler({ jobs: [definition] });

    await scheduler.tick(T0);
    await scheduler.tick(at(4 * HOUR));
    await scheduler.tick(at(6 * HOUR));
    assert.equal(runs.length, 2, 'ran again only 2h after the previous start');

    await scheduler.tick(at(7 * HOUR));
    assert.deepEqual(runs, [
      T0.toISOString(),
      at(4 * HOUR).toISOString(),
      at(7 * HOUR).toISOString(),
    ]);
  });

  it('hands the handler the same instant the tick was given', async () => {
    const { runs, definition } = recordingJob();
    const scheduler = createScheduler({ jobs: [definition] });

    await scheduler.tick(at(90 * 60 * 1000));

    assert.deepEqual(runs, ['2026-08-13T01:30:00.000Z']);
  });

  it('runs several due jobs in one tick and leaves the undue ones alone', async () => {
    const fast = recordingJob({ name: 'fast', everyMs: HOUR });
    const slow = recordingJob({ name: 'slow', everyMs: 24 * HOUR });
    const scheduler = createScheduler({ jobs: [fast.definition, slow.definition] });

    const boot = await scheduler.tick(T0);
    assert.deepEqual(
      boot.map((entry) => entry.name),
      ['fast', 'slow'],
    );

    const later = await scheduler.tick(at(2 * HOUR));
    assert.deepEqual(
      later.map((entry) => entry.name),
      ['fast'],
    );
    assert.equal(slow.runs.length, 1);
  });

  it('exposes the registered job names', () => {
    const scheduler = createScheduler({
      jobs: [recordingJob({ name: 'a' }).definition, recordingJob({ name: 'b' }).definition],
    });

    assert.deepEqual(scheduler.jobNames(), ['a', 'b']);
  });
});

// ── Non-overlap ─────────────────────────────────────────────────────────────

describe('scheduler · a job never overlaps itself', () => {
  it('skips a tick while the previous run is still in flight', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });

    let started = 0;
    const scheduler = createScheduler({
      jobs: [
        {
          name: 'slow-provider',
          everyMs: 1,
          handler: async () => {
            started += 1;
            await gate;
            return 'finished';
          },
        },
      ],
    });

    // Deliberately not awaited: the run is still open when the next tick lands.
    const inFlight = scheduler.tick(T0);

    const overlapping = await scheduler.tick(at(60_000));
    assert.deepEqual(overlapping, [], 'a second run started while the first was open');
    assert.equal(started, 1);

    release();
    const [result] = await inFlight;
    assert.equal(result.status, 'ok');
    assert.equal(result.result, 'finished');

    // Once it has finished, the very next tick is free to run it again.
    const resumed = await scheduler.tick(at(120_000));
    assert.equal(resumed.length, 1);
    assert.equal(started, 2);
  });

  it('reports "skipped" when run() is called during an open run', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });

    const scheduler = createScheduler({
      jobs: [{ name: 'slow-provider', everyMs: 1, handler: () => gate }],
    });

    const inFlight = scheduler.run('slow-provider', T0);

    const skipped = await scheduler.run('slow-provider', at(1_000));
    assert.deepEqual(skipped, { name: 'slow-provider', status: 'skipped', durationMs: 0 });

    release();
    assert.equal((await inFlight).status, 'ok');
  });

  it('a skipped tick does not shift the schedule of a *different* job', async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const other = recordingJob({ name: 'other', everyMs: HOUR });

    const scheduler = createScheduler({
      jobs: [{ name: 'slow', everyMs: 1, handler: () => gate }, other.definition],
    });

    const inFlight = scheduler.tick(T0);
    // `other` finishes immediately, but its `run()` only clears the running
    // flag when its own continuation is scheduled. Let the event loop drain
    // before ticking again, so this asserts "a *hung* job does not block a
    // different one" rather than the microtask ordering of two un-awaited
    // ticks — which is not something production does (start() awaits nothing
    // faster than its 60s interval).
    await new Promise(setImmediate);

    const second = await scheduler.tick(at(2 * HOUR));

    assert.deepEqual(
      second.map((entry) => entry.name),
      ['other'],
    );

    release();
    await inFlight;
  });
});

// ── Failure isolation ───────────────────────────────────────────────────────

describe('scheduler · a throwing handler degrades one job, not the scheduler', () => {
  const boom = () => {
    throw new Error('provider down');
  };

  it('returns status "failed" with the error, and never rejects the tick', async () => {
    const healthy = recordingJob({ name: 'healthy', everyMs: HOUR });
    const scheduler = createScheduler({
      jobs: [{ name: 'broken', everyMs: HOUR, handler: async () => boom() }, healthy.definition],
    });

    const [failed, ok] = await scheduler.tick(T0);

    assert.equal(failed.name, 'broken');
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error.message, 'provider down');
    assert.equal(failed.result, undefined);
    assert.equal(typeof failed.durationMs, 'number');

    // A sibling job in the same tick is unaffected.
    assert.equal(ok.status, 'ok');
    assert.equal(healthy.runs.length, 1);
  });

  it('keeps running the failing job on later ticks', async () => {
    let attempts = 0;
    const scheduler = createScheduler({
      jobs: [
        {
          name: 'flaky',
          everyMs: HOUR,
          handler: async () => {
            attempts += 1;
            if (attempts < 3) boom();
            return 'recovered';
          },
        },
      ],
    });

    assert.equal((await scheduler.tick(T0))[0].status, 'failed');
    assert.equal((await scheduler.tick(at(HOUR)))[0].status, 'failed');

    const recovered = await scheduler.tick(at(2 * HOUR));
    assert.equal(recovered[0].status, 'ok');
    assert.equal(recovered[0].result, 'recovered');
    assert.equal(attempts, 3);
  });

  it('releases the running flag so a failure cannot wedge the job forever', async () => {
    const scheduler = createScheduler({
      jobs: [{ name: 'broken', everyMs: 1, handler: async () => boom() }],
    });

    await scheduler.tick(T0);
    const again = await scheduler.tick(at(1_000));

    assert.equal(again.length, 1, 'the job stayed marked as running after it threw');
    assert.equal(again[0].status, 'failed');
  });

  it('treats a synchronously thrown error the same as a rejected promise', async () => {
    const scheduler = createScheduler({ jobs: [{ name: 'sync', everyMs: 1, handler: boom }] });

    const [result] = await scheduler.tick(T0);
    assert.equal(result.status, 'failed');
    assert.equal(result.error.message, 'provider down');
  });
});

// ── run() by name ───────────────────────────────────────────────────────────

describe('scheduler · run() is the external-trigger path', () => {
  it('runs a job regardless of whether it is due', async () => {
    const { runs, definition } = recordingJob();
    const scheduler = createScheduler({ jobs: [definition] });

    await scheduler.run('recorder', T0);
    await scheduler.run('recorder', at(1_000));

    assert.equal(runs.length, 2, 'run() honoured the cadence it is meant to bypass');
  });

  it('throws on an unknown name rather than silently doing nothing', async () => {
    const scheduler = createScheduler({ jobs: [recordingJob().definition] });

    await assert.rejects(() => scheduler.run('nope'), /unknown job: nope/);
    await assert.rejects(() => scheduler.run(''), /unknown job/);
    await assert.rejects(() => scheduler.run(undefined), /unknown job/);
  });

  it('a manual run counts towards the cadence of the next tick', async () => {
    const { runs, definition } = recordingJob();
    const scheduler = createScheduler({ jobs: [definition] });

    await scheduler.run('recorder', T0);
    assert.deepEqual(await scheduler.tick(at(HOUR)), []);

    await scheduler.tick(at(3 * HOUR));
    assert.equal(runs.length, 2);
  });
});

// ── start() ─────────────────────────────────────────────────────────────────

describe('scheduler · start() returns a stop handle', () => {
  it('hands back a function that clears the interval', () => {
    const scheduler = createScheduler({ jobs: [recordingJob().definition] });

    const stop = scheduler.start({ intervalMs: 60_000 });
    assert.equal(typeof stop, 'function');
    stop();
  });
});
