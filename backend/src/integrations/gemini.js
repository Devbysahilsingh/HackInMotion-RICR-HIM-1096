/**
 * Gemini 2.5 Flash — the AI-assisted vision tier (docs/ai/gemini-integration.md).
 *
 * This module is **transport only**. It shapes a request, reads one text field
 * out of the response envelope, and reports a coarse reason when it cannot.
 * Every judgement — prompt wording, schema, registry-closing, coercion,
 * confidence banding — lives in `services/aiVision.js`, so the tertiary tier
 * cannot drift into a second, weaker contract.
 *
 * **Why the REST API and not `@google/genai`.** The SDK is on the approved
 * dependency list, so this is a choice rather than a constraint: the REST
 * surface used here is two stable endpoints' worth of JSON, it keeps the
 * `fetchImpl` seam that every other integration in this codebase is tested
 * through, and adding a dependency is the integrator's call to make in its own
 * PR (docs/security/dependency-security.md). Nothing here forecloses the SDK.
 *
 * **Why the key goes in a header.** `?key=` is the documented alternative and it
 * is the wrong one: a query string reaches access logs, proxy logs, error
 * reports and `Referer` headers. `x-goog-api-key` reaches none of those, and it
 * is why `safeUrl()` (host + path, query dropped) is safe to attach to a failure
 * here — there is nothing secret left in the URL to drop.
 */
import { AI_HOP_TIMEOUT_MS, AI_PROVIDERS, AI_RETRIES } from '../config/constants.js';
import { env } from '../config/env.js';
import { tierDisabled } from '../config/failureFlags.js';
import { AI_FAILURE, postJsonToProvider, providerFailure } from '../services/aiVision.js';

export const GEMINI_PROVIDER = AI_PROVIDERS.GEMINI;

/**
 * The free-tier vision model, in exactly one place.
 *
 * docs/ai/gemini-integration.md originally pinned `gemini-2.5-flash`. That id
 * was retired for new API keys on Google's side and now answers **404
 * NOT_FOUND** — "no longer available to new users" — which took the whole
 * Gemini tier down to the rule engine. Verified live against this project's key
 * on 2026-08-13: `gemini-2.5-flash` and `gemini-2.5-flash-lite` both 404, while
 * `gemini-flash-latest`, `gemini-flash-lite-latest`, `gemini-3-flash-preview`
 * and `gemini-3.1-flash-lite` all returned 200 on a real leaf photograph.
 *
 * A rolling alias is chosen deliberately over a pinned id. The failure we hit
 * is precisely what pinning causes: a hard 404 the day Google retires a
 * version. `gemini-flash-latest` tracks the current free flash model, so the
 * tier keeps working across retirements. Model drift is contained by the layer
 * above — every response is schema-validated and registry-closed (rule 6), so a
 * changed model cannot widen what the tier is allowed to say.
 */
export const GEMINI_MODEL = 'gemini-flash-latest';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Perception, not composition — the document pins 0.2. */
const TEMPERATURE = 0.2;

/**
 * Bounded output. The schema's worst case is five 140-character findings plus a
 * handful of enums — well under 400 tokens — so this is generous headroom that
 * still caps a runaway generation. A truncated body fails JSON parsing and tiers
 * down, which is the honest outcome, not a silently half-read answer.
 */
const MAX_OUTPUT_TOKENS = 1024;

/** The upload pipeline re-encodes every image to JPEG before any AI sees it. */
const IMAGE_MIME_TYPE = 'image/jpeg';

export function buildUrl({ model = GEMINI_MODEL } = {}) {
  return `${BASE_URL}/${model}:generateContent`;
}

/**
 * Whether this tier can be attempted at all.
 *
 * The two "no" answers are kept distinct on purpose: a pulled kill switch is an
 * operator decision and a missing key is a deployment gap, and neither may ever
 * be logged or displayed as "Gemini analysed the photo and was unsure"
 * (docs/config/env.js `tierConfig`, ai-safety rule 6).
 *
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function isEnabled({ apiKey = env.GEMINI_API_KEY, envSource = process.env } = {}) {
  if (tierDisabled(GEMINI_PROVIDER, envSource)) {
    return { ok: false, reason: AI_FAILURE.DISABLED };
  }
  if (!apiKey) {
    return { ok: false, reason: AI_FAILURE.NOT_CONFIGURED };
  }
  return { ok: true };
}

/**
 * Pulls the model's text out of the response envelope.
 *
 * Parts are concatenated rather than indexed at `[0]`: the API is free to split
 * one JSON answer across parts, and reading only the first would hand the
 * validator a truncated object that looks like a model fault.
 */
export function extractText(body) {
  const candidate = body?.candidates?.[0];
  const parts = candidate?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim();
}

/**
 * One Gemini attempt.
 *
 * Never throws: the tier walk's job is to try the next provider, not to unwind.
 * Failures come back as `{ok:false, reason}` with a coarse reason and, for a
 * transport fault, the query-free endpoint.
 *
 * @param {object} params
 * @param {string} params.prompt        built by aiVision.buildPrompt
 * @param {string} params.imageBase64   base64 of the sanitised JPEG
 * @param {object} params.schema        aiVision.RESPONSE_SCHEMA
 * @param {number} [params.timeoutMs]   the conductor passes a shrinking deadline
 * @returns {Promise<{ok: true, text: string, provider: string} | {ok: false, reason: string}>}
 */
export async function analyze({
  prompt,
  imageBase64,
  schema,
  timeoutMs = AI_HOP_TIMEOUT_MS,
  retries = AI_RETRIES,
  retryDelayMs,
  apiKey = env.GEMINI_API_KEY,
  envSource = process.env,
  model = GEMINI_MODEL,
  fetchImpl,
} = {}) {
  // Re-checked here and not only at the routing layer: a caller that builds its
  // own provider list must not be able to spend a disabled tier's quota.
  const gate = isEnabled({ apiKey, envSource });
  if (!gate.ok) return gate;

  const url = buildUrl({ model });

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }, { inlineData: { mimeType: IMAGE_MIME_TYPE, data: imageBase64 } }],
      },
    ],
    generationConfig: {
      // Schema-constrained decoding — the first layer of the hallucination
      // mitigation stack (prompt-strategy.md). The server-side Zod mirror is
      // still applied to the result; this is a request, not a guarantee.
      responseMimeType: 'application/json',
      ...(schema ? { responseSchema: schema } : {}),
      temperature: TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  };

  let payload;
  try {
    payload = await postJsonToProvider(url, {
      provider: GEMINI_PROVIDER,
      body,
      // The key travels in a header so it never enters a URL, a log or a Referer.
      headers: { 'x-goog-api-key': apiKey },
      timeoutMs,
      retries,
      retryDelayMs,
      fetchImpl,
    });
  } catch (err) {
    // 429 and 5xx arrive here as `http_status` with a status — the tier-down
    // trigger the document specifies.
    return providerFailure(err, { provider: GEMINI_PROVIDER, url });
  }

  // A safety filter is a refusal, not an outage, and must not read as one.
  const blockReason = payload?.promptFeedback?.blockReason;
  if (blockReason) return { ok: false, reason: AI_FAILURE.BLOCKED, provider: GEMINI_PROVIDER };

  const text = extractText(payload);
  if (!text) return { ok: false, reason: AI_FAILURE.EMPTY_RESPONSE, provider: GEMINI_PROVIDER };

  return { ok: true, text, provider: GEMINI_PROVIDER };
}

/**
 * The provider descriptor consumed by `aiVision.analyzeWithFallback`.
 *
 * `embedSchema` is false: this transport carries the schema as a real request
 * parameter, so repeating it in the prompt would only spend tokens.
 */
export function provider(options = {}) {
  return {
    id: GEMINI_PROVIDER,
    embedSchema: false,
    enabled: () => isEnabled(options),
    call: (input) => analyze({ ...options, ...input }),
  };
}
