/**
 * ml-service — the custom vision model (docs/ml/inference-architecture.md).
 *
 * Primary tier for SPECIALIZED crops. The contract:
 *
 *   POST /predict  · X-Service-Key · multipart {image, cropCode}
 *     → {diseaseCode|null, uncertain, confidence, top3:[{code,prob}],
 *        cropMismatch?, modelVersion, latencyMs}
 *
 * Three things this module is deliberately strict about.
 *
 * **The threshold policy lives in the model, not here.** τ and τ_healthy come
 * from the trained artifact's manifest and are not known until a model exists
 * (docs/ml/confidence-strategy.md: "final value = data's answer"). The service
 * therefore returns `uncertain` as a *decision it already made*, and this client
 * never re-derives it from `confidence`. Hardcoding a τ in the backend would
 * silently override a calibrated one and would be exactly the invented number
 * CLAUDE.md rule 7 forbids.
 *
 * **`uncertain` is honoured, never overridden.** "Never force a prediction" is
 * contractual. An uncertain answer escalates; it does not become a diagnosis
 * because the confidence number looked high enough to someone reading it here.
 *
 * **Field names are normalised at this boundary.** The service speaks
 * `top3:[{code, prob}]`; the stored schema is `[{diseaseCode, confidence}]`.
 * Translating here means exactly one place knows both vocabularies.
 *
 * Not routed through utils/httpClient.js: that module is documented as
 * jobs-only and is GET-only, and this is a request-path multipart POST. The
 * same disciplines — hard AbortController timeout, coarse reason codes, no URL
 * or body in logs — are reproduced rather than borrowed.
 */
import { z } from 'zod';

import { AI_HOP_TIMEOUT_MS, AI_PROVIDERS, UNKNOWN_DISEASE_CODE } from '../config/constants.js';
import { env, requireSecret } from '../config/env.js';
import { failureInjected, injectedDelayMs, tierDisabled } from '../config/failureFlags.js';
import { logger } from '../utils/logger.js';

export const ML_PROVIDER = AI_PROVIDERS.ML;

/** Coarse, safe-to-log outcomes. `not_configured`/`disabled` are not faults. */
export const ML_FAILURE = {
  NOT_CONFIGURED: 'not_configured',
  DISABLED: 'disabled',
  TIMEOUT: 'timeout',
  NETWORK: 'network',
  HTTP_STATUS: 'http_status',
  MALFORMED_BODY: 'malformed_body',
  INJECTED: 'injected',
};

/**
 * Mirrors the documented response. `.passthrough()` is deliberately NOT used:
 * an unexpected field means the service and this client disagree about the
 * contract, and silently ignoring it is how a version skew goes unnoticed.
 * Anything genuinely optional is declared optional.
 *
 * `.strict()` is what actually delivers that. A bare `z.object()` *strips*
 * unknown keys and reports success, which is the silent-ignore this comment
 * already said was unacceptable — the intent was documented but not enforced.
 * Rejecting instead costs nothing at runtime: a contract mismatch tiers down to
 * the AI path rather than serving a half-understood answer.
 */
const predictionSchema = z
  .object({
    diseaseCode: z.string().min(1).nullable(),
    uncertain: z.boolean(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    top3: z
      .array(z.object({ code: z.string().min(1), prob: z.number().min(0).max(1) }).strict())
      .max(3)
      .default([]),
    cropMismatch: z.boolean().optional(),
    modelVersion: z.string().min(1),
    latencyMs: z.number().nonnegative().optional(),
  })
  .strict();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Asks the model.
 *
 * @param {object} input
 * @param {Buffer} input.jpeg        the sanitized image — never the raw upload
 * @param {string} input.cropCode    the crop the farmer declared
 * @param {string} [input.requestId] propagated as X-Request-Id for cross-service tracing
 * @param {number} [input.timeoutMs] the conductor passes its remaining budget
 * @param {typeof fetch} [input.fetchImpl] injectable for tests
 * @returns {Promise<
 *   | { ok: true, diseaseCode: string|null, uncertain: boolean, confidence: number|null,
 *       top3: {diseaseCode: string, confidence: number}[], cropMismatch: boolean,
 *       modelVersion: string }
 *   | { ok: false, reason: string }
 * >}
 */
export async function predict({
  jpeg,
  cropCode,
  requestId,
  timeoutMs = AI_HOP_TIMEOUT_MS,
  fetchImpl = fetch,
}) {
  if (tierDisabled(ML_PROVIDER)) return { ok: false, reason: ML_FAILURE.DISABLED };
  if (failureInjected(ML_PROVIDER)) return { ok: false, reason: ML_FAILURE.INJECTED };

  if (!env.ML_SERVICE_URL) {
    // Configuration state, not a fault. The conductor reports "tier not
    // configured" rather than "the model failed", so a missing URL never looks
    // like a model that answered UNKNOWN.
    return { ok: false, reason: ML_FAILURE.NOT_CONFIGURED };
  }

  const delay = injectedDelayMs(ML_PROVIDER);
  if (delay) await sleep(delay);

  const form = new FormData();
  // A fixed name: the original filename is never carried past the upload
  // boundary, and the service does not use it for anything.
  form.append('image', new Blob([jpeg], { type: 'image/jpeg' }), 'image.jpg');
  form.append('cropCode', cropCode);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(new URL('/predict', env.ML_SERVICE_URL), {
      method: 'POST',
      headers: {
        // The only credential this service knows. Never logged: the redaction
        // list covers `req.headers["x-service-key"]`.
        'X-Service-Key': requireSecret('SERVICE_KEY'),
        ...(requestId ? { 'X-Request-Id': requestId } : {}),
        Accept: 'application/json',
      },
      body: form,
      signal: controller.signal,
      // The X-Service-Key above is a custom header, and `fetch` replays custom
      // headers across a cross-origin redirect (only `Authorization` is
      // stripped). Following a `Location` would hand this service's shared
      // secret — and a GET — to whatever host it named, link-local metadata
      // addresses included. /predict never redirects; refusing is free.
      redirect: 'error',
    });

    if (!response.ok) {
      // Status only. An ml-service error body could quote the request, and the
      // request carries the image.
      logger.warn({ provider: ML_PROVIDER, status: response.status }, 'ml-service rejected');
      return { ok: false, reason: ML_FAILURE.HTTP_STATUS, status: response.status };
    }

    let body;
    try {
      body = await response.json();
    } catch {
      return { ok: false, reason: ML_FAILURE.MALFORMED_BODY };
    }

    const parsed = predictionSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn({ provider: ML_PROVIDER }, 'ml-service payload failed contract validation');
      return { ok: false, reason: ML_FAILURE.MALFORMED_BODY };
    }

    return normalize(parsed.data);
  } catch (err) {
    const reason =
      err?.name === 'AbortError' || err?.name === 'TimeoutError'
        ? ML_FAILURE.TIMEOUT
        : ML_FAILURE.NETWORK;
    logger.warn({ provider: ML_PROVIDER, reason }, 'ml-service call failed');
    return { ok: false, reason };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Canonical form of a class code as the registry stores it.
 *
 * Registry disease codes are `uppercase: true` in the schema and are matched
 * with `===`, while CropHealthLog uppercases `diseaseCode` at save time. An
 * un-normalised code therefore failed the registry lookup — yielding a
 * diagnosis with no symptoms, no next steps and no sources — and was then
 * persisted in the very form that would have matched. Normalising here is what
 * the AI tier already does to its own codes (aiVision.normalizeAiResult).
 */
const canonicalCode = (code) => (typeof code === 'string' ? code.trim().toUpperCase() : null);

/**
 * Service vocabulary → stored vocabulary.
 *
 * `uncertain` is passed through untouched. The one normalisation applied is
 * that an uncertain answer carries no `diseaseCode`: the service may still name
 * its top-1 for diagnostics, but a code the model itself declined to stand
 * behind must not reach a farmer as a diagnosis.
 */
function normalize(prediction) {
  const uncertain = prediction.uncertain || prediction.cropMismatch === true;

  return {
    ok: true,
    uncertain,
    diseaseCode: uncertain ? null : canonicalCode(prediction.diseaseCode),
    // A calibrated probability, unlike the AI tiers' band. Kept only when the
    // model stood behind the prediction.
    confidence: uncertain ? null : (prediction.confidence ?? null),
    top3: prediction.top3.map((entry) => ({
      diseaseCode: canonicalCode(entry.code),
      confidence: entry.prob,
    })),
    cropMismatch: prediction.cropMismatch === true,
    modelVersion: prediction.modelVersion,
  };
}

/**
 * Whether a prediction may be served as a diagnosis.
 *
 * Reads as trivial, and is stated as a named function on purpose: this is the
 * confidence gate, and it must be one line that is obviously "whatever the
 * model decided" rather than arithmetic someone can later tune in the backend.
 */
export const isServable = (prediction) =>
  prediction.ok === true &&
  prediction.uncertain === false &&
  Boolean(prediction.diseaseCode) &&
  prediction.diseaseCode !== UNKNOWN_DISEASE_CODE;
