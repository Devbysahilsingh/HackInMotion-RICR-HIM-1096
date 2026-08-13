/**
 * Outbound HTTP for ingestion jobs.
 *
 * Every external call in this codebase goes through here, for three reasons
 * that are each a rule rather than a preference:
 *
 *   - **A provider error never reaches a farmer.** Upstream bodies carry
 *     provider-specific prose, stack traces and sometimes the request URL
 *     (which carries an API key). `ProviderError` therefore exposes a coarse
 *     `reason` and nothing else; the body is dropped at the boundary.
 *   - **A hung provider never becomes a hung job.** Every request is bounded
 *     by an AbortController; there is no code path without a timeout.
 *   - **Keys never reach the log stream.** Only `host + pathname` is ever
 *     logged. `?api-key=` lives in the query string, so the query string is
 *     not logged, not attached to errors, and not returned.
 *
 * This module is not used on any request path — CLAUDE.md rule 3 (DB-first
 * reads) confines it to jobs and scripts.
 */
import { failureInjected, injectedDelayMs } from '../config/failureFlags.js';

/** Coarse, provider-agnostic failure kinds. Safe to log and to count. */
export const PROVIDER_FAILURE = {
  TIMEOUT: 'timeout',
  NETWORK: 'network',
  HTTP_STATUS: 'http_status',
  MALFORMED_BODY: 'malformed_body',
  INJECTED: 'injected',
};

export class ProviderError extends Error {
  /**
   * @param {string} provider  short provider id, e.g. 'open-meteo'
   * @param {string} reason    one of PROVIDER_FAILURE
   * @param {{ status?: number, cause?: unknown }} [options]
   */
  constructor(provider, reason, options = {}) {
    // The message is built from the coarse fields only. Interpolating the
    // upstream body here is how provider prose ends up in a log line.
    super(`${provider}: ${reason}${options.status ? ` (${options.status})` : ''}`);
    this.name = 'ProviderError';
    this.provider = provider;
    this.reason = reason;
    this.status = options.status;
    this.cause = options.cause;
    /**
     * Whether another attempt could plausibly succeed. Carried on the error
     * rather than re-derived at the catch site: the throw happens inside the
     * try block, so the catch cannot otherwise tell a 503 worth retrying from
     * a 401 that will fail identically forever — and retrying a 4xx burns
     * free-tier quota against a fault that is ours, not the provider's.
     */
    this.retryable = options.retryable ?? false;
  }
}

/** Everything past this is the caller's key material — never logged. */
export function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return '(unparseable url)';
  }
}

/**
 * A 5xx or 429 is worth retrying; a 4xx means the request itself is wrong and
 * retrying it just burns free-tier quota against a fault we caused.
 */
const isRetryableStatus = (status) => status === 429 || (status >= 500 && status < 600);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GETs JSON with a hard timeout and bounded retries.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {string} options.provider          id used in errors and metrics
 * @param {number} [options.timeoutMs=8000]  per-attempt ceiling
 *   (docs/architecture/resilience.md: "8s (weather/AI) · 15s (market bulk)")
 * @param {number} [options.retries=1]       additional attempts after the first
 *   (resilience.md: "1 retry, exponential jitter")
 * @param {number} [options.retryDelayMs=300] base delay; doubles per attempt and
 *   carries ±25% jitter so a shared outage does not synchronise every retry
 * @param {Record<string,string>} [options.headers]
 * @param {typeof fetch} [options.fetchImpl] injectable for tests — the suites
 *   drive this with a stub rather than reaching the real internet, so the test
 *   run is deterministic and consumes no provider quota
 * @returns {Promise<unknown>} parsed JSON
 */
export async function fetchJson(url, options = {}) {
  const {
    provider = 'unknown',
    timeoutMs = 8_000,
    // resilience.md: "1 retry, exponential jitter" — one retry, not two.
    retries = 1,
    retryDelayMs = 300,
    headers = {},
    fetchImpl = fetch,
  } = options;

  // Injection is keyed on the provider id, so a call site cannot accidentally
  // opt out of the RES matrix by forgetting to pass a flag name.
  if (failureInjected(provider)) {
    throw new ProviderError(provider, PROVIDER_FAILURE.INJECTED);
  }

  const artificialDelay = injectedDelayMs(provider);

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) {
      // Exponential with ±25% jitter, so a shared outage does not bring every
      // location's retry back at the same instant.
      const backoff = retryDelayMs * 2 ** (attempt - 1);
      await sleep(Math.round(backoff * (0.75 + Math.random() * 0.5)));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      if (artificialDelay) await sleep(artificialDelay);

      const response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json', ...headers },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ProviderError(provider, PROVIDER_FAILURE.HTTP_STATUS, {
          status: response.status,
          retryable: isRetryableStatus(response.status),
        });
      }

      try {
        return await response.json();
      } catch (err) {
        // A 200 carrying HTML (a captive portal, an outage page) is not worth
        // retrying — it is a successful response to a request we should not
        // repeat until something upstream changes.
        throw new ProviderError(provider, PROVIDER_FAILURE.MALFORMED_BODY, { cause: err });
      }
    } catch (err) {
      if (err instanceof ProviderError) {
        // A fault we caused (4xx) or a body we cannot parse will not heal on a
        // second identical request — surface it immediately.
        if (!err.retryable) throw err;
        lastError = err;
        continue;
      }

      const reason =
        err?.name === 'AbortError' || err?.name === 'TimeoutError'
          ? PROVIDER_FAILURE.TIMEOUT
          : PROVIDER_FAILURE.NETWORK;

      // Transport failures are worth one more attempt: they are exactly the
      // transient case "1 retry, exponential jitter" exists for.
      lastError = new ProviderError(provider, reason, { cause: err, retryable: true });
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new ProviderError(provider, PROVIDER_FAILURE.NETWORK);
}
