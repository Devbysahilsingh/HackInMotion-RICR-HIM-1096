/**
 * Circuit-lite (docs/architecture/resilience.md).
 *
 * > "**Circuit-lite:** 3 consecutive failures/service → skip 10min (in-memory
 * >  counters; per-instance is fine at our scale)."
 *
 * In-memory is a deliberate choice, not a shortcut: the free tier runs one
 * instance, and a shared counter in Mongo would add a write to every provider
 * failure — the exact moment the system is least healthy.
 *
 * Time is injected rather than read from the clock so a suite can prove the
 * 10-minute skip and its expiry without waiting ten minutes (ADR-022 leaves
 * this project with no fake timers, by design).
 */

export const CIRCUIT_FAILURE_THRESHOLD = 3;
export const CIRCUIT_OPEN_MS = 10 * 60 * 1000;

export function createCircuitBreaker({
  threshold = CIRCUIT_FAILURE_THRESHOLD,
  openMs = CIRCUIT_OPEN_MS,
} = {}) {
  /** @type {Map<string, {consecutiveFailures: number, openedAt: number|null}>} */
  const services = new Map();

  const entryFor = (service) => {
    if (!services.has(service)) services.set(service, { consecutiveFailures: 0, openedAt: null });
    return services.get(service);
  };

  /** True while the breaker is open — the caller must skip, not call. */
  function isOpen(service, now = Date.now()) {
    const entry = entryFor(service);
    if (entry.openedAt === null) return false;

    if (now - entry.openedAt >= openMs) {
      // Half-open: one attempt is allowed through. If it fails, `recordFailure`
      // re-opens immediately because the failure count is still at threshold.
      entry.openedAt = null;
      return false;
    }
    return true;
  }

  function recordFailure(service, now = Date.now()) {
    const entry = entryFor(service);
    entry.consecutiveFailures += 1;
    if (entry.consecutiveFailures >= threshold) entry.openedAt = now;
    return entry.consecutiveFailures;
  }

  /** Any success clears the streak — the counter is *consecutive* failures. */
  function recordSuccess(service) {
    const entry = entryFor(service);
    entry.consecutiveFailures = 0;
    entry.openedAt = null;
  }

  /** Reported on /healthz so an operator can see a tripped provider. */
  function state(now = Date.now()) {
    return Object.fromEntries(
      [...services.entries()].map(([service, entry]) => [
        service,
        {
          consecutiveFailures: entry.consecutiveFailures,
          open: entry.openedAt !== null && now - entry.openedAt < openMs,
        },
      ]),
    );
  }

  return { isOpen, recordFailure, recordSuccess, state, reset: () => services.clear() };
}

/** Process-wide breaker shared by the ingestion jobs. */
export const providerCircuit = createCircuitBreaker();
