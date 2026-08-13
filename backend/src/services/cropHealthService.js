/**
 * The crop-health conductor.
 *
 * ADR-006: "chain complexity concentrated in **one conductor service** (heavily
 * tested)". This is that one place. Nothing else in the codebase decides which
 * tier answers, and no tier decides anything about another.
 *
 * ## The chain (docs/ai/ai-architecture.md)
 *
 *   SPECIALIZED → ml-service ─ conf ≥ τ ─→ result (Local AI)
 *                    └ uncertain ─→ Gemini ─ valid ─→ result (AI-assisted)
 *   GENERAL ─────────────────────→ Gemini ─ invalid/down → OpenRouter (same contract)
 *   LIMITED / UNSUPPORTED ──────────────────────── └────→ rule engine (Guided assessment)
 *
 * ## Five invariants this file exists to hold
 *
 * 1. **A low-confidence answer never becomes a confident diagnosis.** The gate
 *    is `isServable()` in integrations/mlService.js and `coerced`/`UNKNOWN` for
 *    the AI tiers. An uncertain tier escalates; it is never re-read as certain
 *    because its number looked high enough here.
 * 2. **The chain cannot fail.** The rule engine is local and needs no network,
 *    no key and no quota, so there is always a tier left. `ML_ERROR`/`AI_ERROR`
 *    are reachable only if every tier including the local one is unavailable,
 *    which the routing makes impossible — they exist for honesty, not for use.
 * 3. **The farmer is told which tier answered.** `source` is stored and every
 *    hop that declined is recorded in `escalationPath` with a reason code. A
 *    missing API key and a model that said UNKNOWN are never the same string.
 * 4. **Nothing the model writes reaches the farmer as advice.** Guidance is
 *    rendered from registry KB i18n keys, keyed by `diseaseCode`. The AI's
 *    `visualFindings` are carried as separately-attributed observations.
 * 5. **The budget is real.** Each hop gets `min(10s, time left)` against a 15s
 *    E2E deadline, so a slow first tier cannot starve the second and a slow
 *    second cannot push the request past its contract.
 *
 * ## What is deliberately NOT here
 *
 * Ownership. The crop and farm arrive already authorized by `loadOwned`, and
 * this service never queries by a bare id.
 */
import {
  AI_HOP_TIMEOUT_MS,
  AI_PROVIDERS,
  HEALTH_E2E_BUDGET_MS,
  HEALTH_SOURCES,
  IMAGE_CACHE_WINDOW_MS,
  UNKNOWN_DISEASE_CODE,
  UPLOAD_REJECTION,
} from '../config/constants.js';
import { tierConfig } from '../config/env.js';
import { assessSeverity } from '../engines/severity/severityEngine.js';
import { matchSymptoms } from '../engines/symptom/symptomEngine.js';
import { destroyImage, storeImage } from '../integrations/cloudinary.js';
import * as gemini from '../integrations/gemini.js';
import * as openRouter from '../integrations/openRouter.js';
import { isServable, predict } from '../integrations/mlService.js';
import { CropHealthLog } from '../models/index.js';
import { analyzeWithFallback } from './aiVision.js';
import { HEALTH_TITLE_KEYS } from '../routes/cropHealthKeys.js';
import { sanitizeImage } from './imagePipeline.js';
import { logger } from '../utils/logger.js';

/**
 * Which tier a crop's *primary* analysis comes from.
 *
 * Registry-driven (CLAUDE.md rule 4): the decision reads `supportLevel` off the
 * document, and adding a crop or promoting one is a registry change with no
 * code change — which is exactly what docs/ml/model-versioning.md promises
 * ("No code changes outside registry+artifact").
 *
 * LIMITED routes to rules. docs/api/crop-health.md says
 * "LIMITED/UNSUPPORTED → rules + honest notice"; docs/product/
 * crop-support-matrix.md says LIMITED gets "Gemini best-effort". The wire
 * contract wins, for the same reason it won for the weather risk-type spellings
 * in config/constants.js: clients are written against the API document. The
 * honest notice is what makes it acceptable — a LIMITED crop is told its
 * coverage is thin rather than being given a confident-looking AI answer over a
 * KB that cannot support it.
 */
export const PRIMARY_TIER = Object.freeze({
  SPECIALIZED: HEALTH_SOURCES.ML,
  GENERAL: HEALTH_SOURCES.GEMINI,
  LIMITED: HEALTH_SOURCES.RULES,
  UNSUPPORTED: HEALTH_SOURCES.RULES,
});

/** Outcomes the route turns into responses. Identifiers, never prose. */
export const ANALYZE_OUTCOME = Object.freeze({
  ANALYZED: 'ANALYZED',
  CACHED: 'CACHED',
  UPLOAD_REJECTED: 'UPLOAD_REJECTED',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
});

/**
 * Runs one analysis.
 *
 * @param {object} input
 * @param {object} input.user          the authenticated user document
 * @param {object} input.crop          an already-authorized crop
 * @param {object} input.farm          its already-authorized farm
 * @param {object|null} input.registryCrop the cropRegistry document, or null
 * @param {Buffer} input.buffer        raw upload bytes
 * @param {string} [input.description] the farmer's note
 * @param {boolean} [input.shareToCommunity]
 * @param {object|null} [input.weatherContext] latest snapshot row, for the fungal prior
 * @param {string} [input.requestId]
 * @param {Date} [input.asOf]
 * @param {object} [input.deps]        injection seams; production passes none
 */
export async function analyzeCropHealth({
  user,
  crop,
  farm,
  registryCrop,
  buffer,
  description,
  shareToCommunity = false,
  weatherContext = null,
  requestId,
  asOf = new Date(),
  deps = {},
}) {
  const {
    sanitize = sanitizeImage,
    store = storeImage,
    destroy = destroyImage,
    mlPredict = predict,
    aiWalk = analyzeWithFallback,
    aiProviders,
    now = () => Date.now(),
    budgetMs = HEALTH_E2E_BUDGET_MS,
  } = deps;

  const deadlineAt = now() + budgetMs;

  // ── 1. Validate and sanitize ───────────────────────────────────────────────
  const image = await sanitize(buffer);
  if (!image.ok) {
    return { outcome: ANALYZE_OUTCOME.UPLOAD_REJECTED, reason: image.reason };
  }

  // ── 2. Cache lookup, before a single unit of quota is spent ────────────────
  //
  // Scoped to (userId, cropId, imageHash) — never global. A global cache would
  // let one farmer's analysis answer another farmer's request and would leak
  // the fact that someone else uploaded the same photograph, which AU-1 forbids.
  // Keyed on cropId too because the analysis depends on the declared crop: the
  // same leaf submitted as tomato and as potato is two different questions.
  const cached = await findCachedAnalysis({
    userId: user._id,
    cropId: crop._id,
    imageHash: image.hash,
    asOf,
  });
  if (cached) {
    return { outcome: ANALYZE_OUTCOME.CACHED, log: cached };
  }

  // ── 3. Store the sanitized image ───────────────────────────────────────────
  const stored = await store(image.jpeg);
  if (!stored.ok) {
    // Storage is not a tier — there is nothing to degrade to, because every
    // downstream step and the history record need a persisted asset.
    return { outcome: ANALYZE_OUTCOME.STORAGE_UNAVAILABLE, reason: stored.reason };
  }

  // Past this point an asset exists remotely. Any failure has to clean it up,
  // or a farmer's photograph is left in the account with no record pointing at
  // it and no way to reach it.
  try {
    const analysis = await runChain({
      crop,
      farm,
      registryCrop,
      image,
      description,
      weatherContext,
      requestId,
      deadlineAt,
      now,
      mlPredict,
      aiWalk,
      aiProviders,
    });

    const log = await persist({
      user,
      crop,
      farm,
      image,
      stored,
      description,
      analysis,
      shareToCommunity,
      asOf,
    });

    return { outcome: ANALYZE_OUTCOME.ANALYZED, log, analysis };
  } catch (err) {
    // The orphan is destroyed best-effort: a cleanup failure must not replace
    // the real error with a storage one, and must not turn a logged fault into
    // an unhandled rejection.
    const cleanup = await destroy(stored.publicId).catch(() => ({ ok: false }));
    if (!cleanup.ok) {
      logger.warn(
        { requestId, provider: AI_PROVIDERS.ML },
        'orphaned image could not be removed after a failed analysis',
      );
    }
    throw err;
  }
}

/**
 * The tier walk.
 *
 * Returns a normalized analysis regardless of what happened, because there is
 * always a terminal local tier. `escalationPath` accumulates one entry per hop
 * that declined, in order, so the stored record explains itself.
 */
async function runChain({
  crop,
  farm,
  registryCrop,
  image,
  description,
  weatherContext,
  requestId,
  deadlineAt,
  now,
  mlPredict,
  aiWalk,
  aiProviders,
}) {
  const supportLevel = registryCrop?.supportLevel ?? 'UNSUPPORTED';
  const primary = PRIMARY_TIER[supportLevel] ?? HEALTH_SOURCES.RULES;
  const escalationPath = [];

  const allowedCodes = registryCrop?.diseases?.map((disease) => disease.code) ?? [];

  // ── Tier 1: the custom model, for SPECIALIZED crops only ───────────────────
  let mlTop3;
  if (primary === HEALTH_SOURCES.ML) {
    const hopMs = Math.min(AI_HOP_TIMEOUT_MS, deadlineAt - now());
    if (hopMs <= 0) {
      escalationPath.push({ provider: AI_PROVIDERS.ML, reason: 'deadline_exhausted' });
    } else {
      const prediction = await mlPredict({
        jpeg: image.jpeg,
        cropCode: crop.cropCode,
        requestId,
        timeoutMs: hopMs,
      });

      if (isServable(prediction)) {
        return {
          source: HEALTH_SOURCES.ML,
          provider: AI_PROVIDERS.ML,
          diseaseCode: prediction.diseaseCode,
          // A calibrated probability, unlike the AI tiers' band.
          confidence: prediction.confidence,
          confidenceKind: 'CALIBRATED',
          top3: prediction.top3,
          modelVersion: prediction.modelVersion,
          escalated: false,
          escalationPath,
          visualFindings: [],
          severityVisual: null,
          registryCrop,
        };
      }

      // Recorded whether the model was down, disabled, or simply not confident.
      // "uncertain" is a real answer and must not read as a failure.
      escalationPath.push({
        provider: AI_PROVIDERS.ML,
        reason: prediction.ok ? 'uncertain' : prediction.reason,
      });

      // The anti-anchor hint (ai-safety rule 7): candidates the next tier is
      // told are unverified. Only carried when the model actually ranked
      // something — passing an empty list would be noise in the prompt.
      if (prediction.ok && prediction.top3?.length) mlTop3 = prediction.top3;
    }
  }

  // ── Tier 2/3: Gemini, then OpenRouter — one tier, two providers ────────────
  if (primary === HEALTH_SOURCES.ML || primary === HEALTH_SOURCES.GEMINI) {
    const providers = aiProviders ?? [gemini.provider(), openRouter.provider()];

    const walked = await aiWalk({
      providers,
      imageBase64: image.jpeg.toString('base64'),
      deadlineAt,
      now,
      context: {
        cropName: registryCrop?.names?.en ?? crop.cropCode,
        cropCode: crop.cropCode,
        // State only. ai-safety rule 5: no PII, "state-level location max" —
        // district and coordinates are deliberately not passed.
        state: farm?.location?.state ?? null,
        season: crop.season ?? null,
        allowedCodes,
        description,
        mlTop3,
      },
    });

    escalationPath.push(...(walked.attempts ?? []));

    if (walked.ok) {
      const usable = walked.imageAssessment === 'OK' && walked.diseaseCode !== UNKNOWN_DISEASE_CODE;

      return {
        source: HEALTH_SOURCES.GEMINI,
        provider: walked.provider,
        diseaseCode: walked.diseaseCode,
        // The band is not a measured probability (docs/ai/response-schema.md).
        // `confidenceKind` travels with it so nothing downstream — a chart, a
        // community threshold — can read it as one by accident.
        confidence: usable ? walked.confidence : null,
        confidenceKind: 'BAND',
        confidenceBand: walked.confidenceBand,
        top3: [],
        escalated: primary !== HEALTH_SOURCES.GEMINI,
        escalationPath,
        imageAssessment: walked.imageAssessment,
        visualFindings: walked.visualFindings ?? [],
        severityVisual: walked.severityVisual ?? null,
        affectedParts: walked.affectedParts ?? [],
        coerced: walked.coerced === true,
        registryCrop,
      };
    }
  }

  // ── Terminal tier: the local rule engine. Cannot fail. ─────────────────────
  //
  // Reached with whatever the farmer typed and nothing else — there are no
  // symptom answers on the photo path, so this yields a no-verdict guided
  // result rather than a diagnosis. That is the honest outcome: the app says it
  // could not identify the problem and offers the symptom checker, which is
  // exactly the designed uncertainty outcome (UF-5), not a degraded error.
  const guided = matchSymptoms({
    registryCrop,
    answers: {},
    weatherContext,
    asOf: new Date(deadlineAt),
  });

  return {
    source: HEALTH_SOURCES.RULES,
    provider: null,
    diseaseCode: guided.candidates[0]?.diseaseCode ?? UNKNOWN_DISEASE_CODE,
    confidence: guided.topScore,
    confidenceKind: 'MATCH_SCORE',
    top3: guided.candidates.slice(0, 3).map((candidate) => ({
      diseaseCode: candidate.diseaseCode,
      confidence: candidate.matchScore,
    })),
    escalated: primary !== HEALTH_SOURCES.RULES,
    escalationPath,
    visualFindings: [],
    severityVisual: null,
    guided,
    supportLevel,
    registryCrop,
  };
}

/**
 * Writes the log.
 *
 * Severity is derived here rather than by any tier, and the KB snapshot is
 * keyed by `diseaseCode` — the two halves of "engines decide, KB speaks".
 */
async function persist({
  user,
  crop,
  farm,
  image,
  stored,
  description,
  analysis,
  shareToCommunity,
  asOf,
}) {
  const disease = findDisease(analysis.registryCrop, analysis.diseaseCode);
  const isHealthy = isHealthyCode(analysis.diseaseCode);

  const severity = assessSeverity({
    diseaseCode: analysis.diseaseCode,
    isHealthy,
    severityVisual: analysis.severityVisual,
  });

  // Community sharing requires BOTH a per-request opt-in and standing consent.
  // Checked here rather than at the route because this is the only place that
  // writes the flag, so there is exactly one gate to review.
  const sharedToCommunity = Boolean(shareToCommunity) && user.communityConsent === true;

  const log = await CropHealthLog.create({
    userId: user._id,
    cropId: crop._id,
    farmId: farm._id,
    imageUrl: stored.url,
    imagePublicId: stored.publicId,
    imageHash: image.hash,
    description,
    analysis: {
      source: analysis.source,
      provider: analysis.provider,
      modelVersion: analysis.modelVersion,
      diseaseCode: analysis.diseaseCode ?? UNKNOWN_DISEASE_CODE,
      confidence: analysis.confidence ?? undefined,
      top3: analysis.top3 ?? [],
      severityAssessment: severity.severity,
      escalated: analysis.escalated === true,
      escalationPath: analysis.escalationPath ?? [],
    },
    recommendationSnapshot: buildSnapshot({ analysis, disease, severity, asOf }),
    sharedToCommunity,
    status: 'analyzed',
  });

  return log;
}

/**
 * The farmer-facing payload — entirely i18n keys and structured data.
 *
 * ai-safety rule 1: "response-schema has no advice field; any model-emitted
 * advice text is discarded; test asserts KB-key-only rendering". Everything
 * here is either a key from the registry or a number the engines produced. The
 * AI's `visualFindings` are the one piece of model text that survives, and it
 * is carried under its own attributed field so the UI can label it as an AI
 * observation rather than as guidance.
 */
function buildSnapshot({ analysis, disease, severity, asOf }) {
  return {
    // Selected from the registry map rather than composed, so the i18n scanner
    // can actually verify these keys exist in both languages.
    titleKey: disease ? HEALTH_TITLE_KEYS[analysis.source] : HEALTH_TITLE_KEYS.UNKNOWN,
    data: {
      diseaseCode: analysis.diseaseCode ?? UNKNOWN_DISEASE_CODE,
      source: analysis.source,
      confidenceKind: analysis.confidenceKind,
      confidenceBand: analysis.confidenceBand ?? null,
      severity: severity.severity,
      severityPolicy: severity.policy,
      escalated: analysis.escalated === true,
      // Straight from the registry — the API never returns display prose.
      symptomKeys: disease?.symptoms ?? [],
      inspectKeys: disease?.inspect ?? [],
      nextStepKeys: disease?.nextSteps ?? [],
      preventionKeys: disease?.prevention ?? [],
      sourceRefs: disease?.sourceRefs ?? [],
      // Clearly attributed, never blended into the guidance above.
      aiObservations: analysis.visualFindings ?? [],
      imageAssessment: analysis.imageAssessment ?? null,
      supportLevel: analysis.supportLevel ?? analysis.registryCrop?.supportLevel ?? null,
      /**
       * Kept so the severity follow-up can re-run the engine over the *same*
       * inputs it saw the first time. Without it, `POST /logs/:id/severity`
       * re-assessed with `severityVisual: null` and silently discarded the AI
       * tier's visual estimate — the farmer's answers alone decided the level,
       * which is not the documented policy (severityEngine.js: the visual
       * estimate is "one input among" several).
       */
      severityVisual: analysis.severityVisual ?? null,
      severityTrace: severity.trace,
      generatedAt: asOf.toISOString(),
    },
  };
}

/** Cache read. Bounded by both the window and the per-user quota above it. */
async function findCachedAnalysis({ userId, cropId, imageHash, asOf }) {
  if (!imageHash) return null;

  return CropHealthLog.findOne({
    userId,
    cropId,
    imageHash,
    status: 'analyzed',
    createdAt: { $gte: new Date(asOf.getTime() - IMAGE_CACHE_WINDOW_MS) },
  }).sort({ createdAt: -1 });
}

/**
 * Healthy classes are named by convention (`<CROP>_HEALTHY`, plus rice's
 * `RICE_NORMAL` — the publisher's spelling, preserved through the dataset
 * manifest rather than renamed).
 *
 * A suffix test rather than a crop conditional: rule 4 bans branching on a crop
 * code, and this branches on the *condition* half of the class code, which is
 * the same shape for every crop.
 */
export function isHealthyCode(code) {
  if (typeof code !== 'string') return false;
  return code.endsWith('_HEALTHY') || code === 'RICE_NORMAL';
}

function findDisease(registryCrop, diseaseCode) {
  if (!registryCrop?.diseases?.length || !diseaseCode) return null;
  return registryCrop.diseases.find((disease) => disease.code === diseaseCode) ?? null;
}

/** Reported by the route so a client can label a degraded chain honestly. */
export const chainAvailability = () => tierConfig();

export { UPLOAD_REJECTION };
