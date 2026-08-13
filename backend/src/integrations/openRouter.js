/**
 * OpenRouter — the tertiary vision tier (docs/ai/ai-architecture.md).
 *
 * Reached only when Gemini is disabled, unconfigured, down, or answered
 * something the schema rejected. Its free quota is 50 requests/day against
 * Gemini's 1,500, which is exactly why it is third and not second.
 *
 * Transport only, like the primary: this module shapes a chat-completions
 * request and reads the assistant message out of the envelope. It owns **no**
 * validation, no registry knowledge and no confidence mapping — those live once
 * in `services/aiVision.js`. That single-contract rule is what response-schema.md
 * means by "Same contract for OpenRouter tier".
 *
 * The one structural difference from Gemini: there is no `responseSchema`
 * parameter here, so schema-constrained decoding is unavailable and the schema
 * is embedded in the prompt instead (`embedSchema: true` below). The *server-side*
 * defence is unchanged — identical Zod validation, identical registry-closing —
 * which matters more, because a prompt instruction is a request and the
 * validator is the guarantee. `response_format: {type:'json_object'}` is
 * deliberately not sent: support varies across free models and an unsupported
 * parameter is answered with a 4xx, which would take the tier down for a
 * formatting nicety the parser already tolerates.
 */
import { AI_HOP_TIMEOUT_MS, AI_PROVIDERS, AI_RETRIES } from '../config/constants.js';
import { env } from '../config/env.js';
import { tierDisabled } from '../config/failureFlags.js';
import { AI_FAILURE, postJsonToProvider, providerFailure } from '../services/aiVision.js';

export const OPENROUTER_PROVIDER = AI_PROVIDERS.OPENROUTER;

const BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * The free-tier vision model, in exactly one place.
 *
 * **This id is a free-tier choice and will need updating.** OpenRouter rotates
 * which models carry the `:free` suffix; when this one is retired the call fails
 * with a 4xx and the tier drops to the local rule engine — degraded, never
 * wrong.
 *
 * That is exactly what happened to the previous value. `qwen/qwen2.5-vl-72b-
 * instruct:free` now answers **404** — "This model is unavailable for free. The
 * paid version is available now" — and OpenRouter's suggested paid slug is
 * refused here on principle: rule 10 forbids introducing a paid service.
 *
 * Replacement verified live on 2026-08-13 by calling every model OpenRouter
 * advertises with `image` in its input modalities at zero prompt/completion
 * price, using a real leaf photograph. Of the eight advertised, this was the
 * only genuine free VLM that answered correctly: the nemotron content-safety
 * model returns an empty completion (it is a classifier, not a VLM), and the
 * remainder returned 400/429/502.
 */
export const OPENROUTER_MODEL = 'google/gemma-4-26b-a4b-it:free';

/** Matches the primary's setting — perception, not composition. */
const TEMPERATURE = 0.2;
const MAX_OUTPUT_TOKENS = 1024;

/** The upload pipeline re-encodes every image to JPEG before any AI sees it. */
const IMAGE_MIME_TYPE = 'image/jpeg';

export function buildUrl() {
  return BASE_URL;
}

/**
 * Whether this tier can be attempted at all. A pulled kill switch and a missing
 * key stay distinguishable — see the note in gemini.js.
 *
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function isEnabled({ apiKey = env.OPENROUTER_API_KEY, envSource = process.env } = {}) {
  if (tierDisabled(OPENROUTER_PROVIDER, envSource)) {
    return { ok: false, reason: AI_FAILURE.DISABLED };
  }
  if (!apiKey) {
    return { ok: false, reason: AI_FAILURE.NOT_CONFIGURED };
  }
  return { ok: true };
}

/**
 * Pulls the assistant text out of the chat-completions envelope.
 *
 * `message.content` is a string on most models but an array of typed parts on
 * some, and a tier that fails on the second shape would look like a model fault.
 */
export function extractText(body) {
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === 'string' ? part.text : ''))
      .join('')
      .trim();
  }
  return '';
}

/**
 * One OpenRouter attempt. Never throws — see gemini.js.
 *
 * @param {object} params
 * @param {string} params.prompt       built by aiVision.buildPrompt with the
 *   schema embedded (this transport cannot carry one as a parameter)
 * @param {string} params.imageBase64  base64 of the sanitised JPEG
 * @returns {Promise<{ok: true, text: string, provider: string} | {ok: false, reason: string}>}
 */
export async function analyze({
  prompt,
  imageBase64,
  timeoutMs = AI_HOP_TIMEOUT_MS,
  retries = AI_RETRIES,
  retryDelayMs,
  apiKey = env.OPENROUTER_API_KEY,
  envSource = process.env,
  model = OPENROUTER_MODEL,
  fetchImpl,
} = {}) {
  const gate = isEnabled({ apiKey, envSource });
  if (!gate.ok) return gate;

  const url = buildUrl();

  const body = {
    model,
    temperature: TEMPERATURE,
    max_tokens: MAX_OUTPUT_TOKENS,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          // A data: URL, not a hosted link: the sanitised JPEG never leaves our
          // process as a fetchable URL, so nothing else can retrieve the photo.
          {
            type: 'image_url',
            image_url: { url: `data:${IMAGE_MIME_TYPE};base64,${imageBase64}` },
          },
        ],
      },
    ],
  };

  let payload;
  try {
    payload = await postJsonToProvider(url, {
      provider: OPENROUTER_PROVIDER,
      body,
      headers: { Authorization: `Bearer ${apiKey}` },
      timeoutMs,
      retries,
      retryDelayMs,
      fetchImpl,
    });
  } catch (err) {
    return providerFailure(err, { provider: OPENROUTER_PROVIDER, url });
  }

  // OpenRouter reports upstream refusals in a 200 body rather than a status.
  if (payload?.error) {
    return { ok: false, reason: AI_FAILURE.BLOCKED, provider: OPENROUTER_PROVIDER };
  }

  const text = extractText(payload);
  if (!text) {
    return { ok: false, reason: AI_FAILURE.EMPTY_RESPONSE, provider: OPENROUTER_PROVIDER };
  }

  return { ok: true, text, provider: OPENROUTER_PROVIDER };
}

/** The provider descriptor consumed by `aiVision.analyzeWithFallback`. */
export function provider(options = {}) {
  return {
    id: OPENROUTER_PROVIDER,
    // No structured-output parameter on this transport — the schema goes in the
    // prompt, and the server-side validator is unchanged either way.
    embedSchema: true,
    enabled: () => isEnabled(options),
    call: (input) => analyze({ ...options, ...input }),
  };
}
