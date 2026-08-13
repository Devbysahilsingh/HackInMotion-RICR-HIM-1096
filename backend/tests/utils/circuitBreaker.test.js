/**
 * Circuit-lite — unit tests.
 *
 * docs/architecture/resilience.md: "3 consecutive failures/service → skip
 * 10min". Both halves of that sentence are only provable if time is an input,
 * so every call below passes an explicit `now`. There are no fake timers in
 * this project (ADR-022) and none are needed: the breaker never reads a clock
 * the test did not hand it.
 *
 * Each test builds its own breaker. The module also exports a process-wide
 * `providerCircuit`, and sharing it here would make these cases order-dependent
 * on whatever the weather suite happened to trip.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CIRCUIT_FAILURE_THRESHOLD,
  CIRCUIT_OPEN_MS,
  createCircuitBreaker,
  providerCircuit,
} from '../../src/utils/circuitBreaker.js';

/** A fixed epoch, so every expectation below is a literal. */
const T0 = new Date('2026-08-13T06:00:00.000Z').getTime();
const minutes = (n) => T0 + n * 60_000;

const SERVICE = 'open-meteo';

describe('circuit breaker · the documented constants', () => {
  it('is 3 consecutive failures and a 10-minute skip', () => {
    assert.equal(CIRCUIT_FAILURE_THRESHOLD, 3);
    assert.equal(CIRCUIT_OPEN_MS, 10 * 60 * 1000);
  });
});

describe('circuit breaker · opens after exactly three consecutive failures', () => {
  it('stays closed for the first two failures', () => {
    const breaker = createCircuitBreaker();

    assert.equal(breaker.isOpen(SERVICE, T0), false, 'open before any failure');

    assert.equal(breaker.recordFailure(SERVICE, T0), 1);
    assert.equal(breaker.isOpen(SERVICE, T0), false, 'opened after one failure');

    assert.equal(breaker.recordFailure(SERVICE, minutes(1)), 2);
    assert.equal(breaker.isOpen(SERVICE, minutes(1)), false, 'opened after two failures');
  });

  it('opens on the third, and only for the service that failed', () => {
    const breaker = createCircuitBreaker();

    breaker.recordFailure(SERVICE, T0);
    breaker.recordFailure(SERVICE, minutes(1));
    assert.equal(breaker.recordFailure(SERVICE, minutes(2)), 3);

    assert.equal(breaker.isOpen(SERVICE, minutes(2)), true);
    assert.equal(breaker.isOpen('openweathermap', minutes(2)), false, 'a neighbour was tripped');
  });

  it('honours a custom threshold', () => {
    const breaker = createCircuitBreaker({ threshold: 1 });

    breaker.recordFailure(SERVICE, T0);
    assert.equal(breaker.isOpen(SERVICE, T0), true);
  });
});

describe('circuit breaker · the 10-minute skip window', () => {
  /** A breaker already open, having tripped at T0. */
  const tripped = () => {
    const breaker = createCircuitBreaker();
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i += 1) breaker.recordFailure(SERVICE, T0);
    return breaker;
  };

  it('is open at every instant inside the window', () => {
    const breaker = tripped();

    for (const offset of [0, 1, 5, 9]) {
      assert.equal(breaker.isOpen(SERVICE, minutes(offset)), true, `closed at +${offset}min`);
    }
    assert.equal(breaker.isOpen(SERVICE, T0 + CIRCUIT_OPEN_MS - 1), true, 'closed 1ms early');
  });

  it('half-opens at exactly ten minutes, letting one attempt through', () => {
    const breaker = tripped();

    assert.equal(breaker.isOpen(SERVICE, T0 + CIRCUIT_OPEN_MS), false);
    // The probe consumed the open state; a caller asking again inside the same
    // window is also allowed through rather than being skipped forever.
    assert.equal(breaker.isOpen(SERVICE, T0 + CIRCUIT_OPEN_MS), false);
  });

  it('re-opens immediately when the half-open probe fails', () => {
    const breaker = tripped();
    const reopenedAt = T0 + CIRCUIT_OPEN_MS;

    assert.equal(breaker.isOpen(SERVICE, reopenedAt), false, 'never half-opened');

    // The streak is still at threshold, so one more failure is enough.
    assert.equal(breaker.recordFailure(SERVICE, reopenedAt), CIRCUIT_FAILURE_THRESHOLD + 1);
    assert.equal(breaker.isOpen(SERVICE, reopenedAt), true);
    assert.equal(breaker.isOpen(SERVICE, reopenedAt + CIRCUIT_OPEN_MS - 1), true);
  });

  it('closes for good when the half-open probe succeeds', () => {
    const breaker = tripped();
    const probedAt = T0 + CIRCUIT_OPEN_MS;

    breaker.isOpen(SERVICE, probedAt);
    breaker.recordSuccess(SERVICE);

    assert.equal(breaker.isOpen(SERVICE, probedAt), false);
    assert.deepEqual(breaker.state(probedAt), {
      [SERVICE]: { consecutiveFailures: 0, open: false },
    });
  });

  it('honours a custom window', () => {
    const breaker = createCircuitBreaker({ threshold: 1, openMs: 60_000 });

    breaker.recordFailure(SERVICE, T0);
    assert.equal(breaker.isOpen(SERVICE, T0 + 59_999), true);
    assert.equal(breaker.isOpen(SERVICE, T0 + 60_000), false);
  });
});

describe('circuit breaker · the counter is *consecutive* failures', () => {
  it('a success resets the streak, so scattered failures never trip it', () => {
    const breaker = createCircuitBreaker();

    breaker.recordFailure(SERVICE, T0);
    breaker.recordFailure(SERVICE, minutes(1));
    breaker.recordSuccess(SERVICE);

    assert.deepEqual(breaker.state(minutes(1)), {
      [SERVICE]: { consecutiveFailures: 0, open: false },
    });

    breaker.recordFailure(SERVICE, minutes(2));
    breaker.recordFailure(SERVICE, minutes(3));
    assert.equal(
      breaker.isOpen(SERVICE, minutes(3)),
      false,
      'two failures after a success tripped it',
    );

    assert.equal(breaker.recordFailure(SERVICE, minutes(4)), 3);
    assert.equal(breaker.isOpen(SERVICE, minutes(4)), true);
  });

  it('a success on an open breaker clears both the streak and the window', () => {
    const breaker = createCircuitBreaker();
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i += 1) breaker.recordFailure(SERVICE, T0);

    breaker.recordSuccess(SERVICE);

    assert.equal(breaker.isOpen(SERVICE, T0), false);
    assert.equal(breaker.recordFailure(SERVICE, T0), 1, 'the streak was not reset');
  });
});

describe('circuit breaker · state() is the /healthz view', () => {
  it('reports one entry per service that has been seen, with a fixed shape', () => {
    const breaker = createCircuitBreaker();

    breaker.recordFailure('open-meteo', T0);
    breaker.recordFailure('open-meteo', T0);
    breaker.recordFailure('open-meteo', T0);
    breaker.recordSuccess('openweathermap');

    assert.deepEqual(breaker.state(T0), {
      'open-meteo': { consecutiveFailures: 3, open: true },
      openweathermap: { consecutiveFailures: 0, open: false },
    });
  });

  it('is empty until a service has been used', () => {
    assert.deepEqual(createCircuitBreaker().state(T0), {});
  });

  it('reports closed once the window has elapsed, without consuming the half-open probe', () => {
    const breaker = createCircuitBreaker();
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i += 1) breaker.recordFailure(SERVICE, T0);

    assert.equal(breaker.state(T0 + CIRCUIT_OPEN_MS)[SERVICE].open, false);
    // Reading state must not itself half-open the breaker.
    assert.equal(breaker.state(minutes(9))[SERVICE].open, true);
  });

  it('reset() forgets every service', () => {
    const breaker = createCircuitBreaker();
    for (let i = 0; i < CIRCUIT_FAILURE_THRESHOLD; i += 1) breaker.recordFailure(SERVICE, T0);

    breaker.reset();

    assert.deepEqual(breaker.state(T0), {});
    assert.equal(breaker.isOpen(SERVICE, T0), false);
  });
});

describe('circuit breaker · the shared process-wide instance', () => {
  it('exposes the same surface as a locally built one', () => {
    for (const key of ['isOpen', 'recordFailure', 'recordSuccess', 'state', 'reset']) {
      assert.equal(typeof providerCircuit[key], 'function', `providerCircuit.${key} is missing`);
    }
  });
});
