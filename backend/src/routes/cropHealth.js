/**
 * Crop-health endpoints (docs/api/crop-health.md).
 *
 *   POST /crop-health/analyze              Auth · 10/day + 3/min · multipart
 *   GET  /crop-health/logs?cropId=&page=   Auth · scoped
 *   GET  /crop-health/logs/:id             Auth · ownership
 *   POST /crop-health/logs/:id/severity    Auth · ownership
 *   POST /crop-health/symptom-check        Auth · 30/day
 *
 * The router is thin on purpose: it authenticates, validates, resolves
 * ownership and renders. Every decision about which tier answers lives in
 * services/cropHealthService.js (ADR-006: one conductor), and every agronomic
 * judgement lives in an engine.
 *
 * ## Why `analyze` does not use `validate({body})`
 *
 * Zod runs before the handler on JSON routes because `express.json` has already
 * parsed the body. Multipart is different: the fields do not exist until multer
 * has consumed the stream, so ordering is `requireAuth → limiters → uploadImage
 * → validate`. Putting the limiters ahead of the parser is deliberate — a
 * rate-limited caller should be refused before we buffer 8MB from them.
 */
import { Router } from 'express';
import { z } from 'zod';

import {
  AUDIT_EVENTS,
  MAX_HEALTH_DESCRIPTION,
  PAGE_MAX,
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  SPREAD_RATES,
  UPLOAD_REJECTION,
} from '../config/constants.js';
import {
  healthAnalyzeBurstLimiter,
  healthAnalyzeDailyLimiter,
  symptomCheckLimiter,
} from '../middleware/rateLimits.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { uploadImage, uploadRejection } from '../middleware/uploadImage.js';
import { validate } from '../middleware/validate.js';
import { loadOwned, ownedBy } from '../middleware/loadOwned.js';
import { Crop, CropHealthLog, CropRegistry, Farm, WeatherSnapshot } from '../models/index.js';
import { assessSeverity } from '../engines/severity/severityEngine.js';
import { matchSymptoms } from '../engines/symptom/symptomEngine.js';
import {
  ANALYZE_OUTCOME,
  analyzeCropHealth,
  isHealthyCode,
} from '../services/cropHealthService.js';
import { notFound } from '../utils/errors.js';
import { pageMeta, sendData } from '../utils/respond.js';
import { auditService } from '../services/auditService.js';
import { storedUserAgent } from '../utils/clientContext.js';
import { logger } from '../utils/logger.js';
import {
  HEALTH_SOURCE_LABEL_KEYS,
  HEALTH_TITLE_KEYS,
  coverageNoticeKey,
} from './cropHealthKeys.js';

/**
 * @param {{ analyze?: Function }} [composition]
 *   A composition seam, in the same spirit as `createApp({extraRouters})`:
 *   `analyze` replaces the conductor so the HTTP layer can be exercised
 *   end-to-end without a Cloudinary account or a provider key. It is an
 *   in-process argument with no environment variable, header or request able to
 *   reach it, and the mounted production router below passes nothing — so the
 *   deployed API always runs the real chain.
 */
export function createCropHealthRouter({ analyze = analyzeCropHealth } = {}) {
  const cropHealthRouter = Router();

  cropHealthRouter.use(requireAuth);

  const loadHealthLog = loadOwned({ model: CropHealthLog, param: 'id', as: 'healthLog' });

  // ── POST /analyze ────────────────────────────────────────────────────────────

  /**
   * Multipart text fields arrive as strings, so `cropId` is a string here and the
   * ObjectId shape is checked before any query — a CastError would otherwise
   * surface as a 500 and confirm that an id was merely malformed rather than
   * unowned (invariant AU-2).
   */
  const analyzeFieldsSchema = z
    .object({
      cropId: z
        .string()
        .trim()
        .regex(/^[a-f\d]{24}$/i),
      description: z.string().trim().max(MAX_HEALTH_DESCRIPTION).optional(),
      // Checkbox semantics over the wire. A per-request opt-in that still cannot
      // override the account-level consent flag — the service checks both.
      shareToCommunity: z
        .enum(['true', 'false'])
        .optional()
        .transform((value) => value === 'true'),
    })
    .strict();

  cropHealthRouter.post(
    '/analyze',
    healthAnalyzeBurstLimiter,
    healthAnalyzeDailyLimiter,
    uploadImage,
    validate({ body: analyzeFieldsSchema }),
    async (req, res, next) => {
      try {
        const { cropId, description, shareToCommunity } = req.body;

        // Ownership in the query filter, exactly as `loadOwned` would do it — the
        // id arrives in the body rather than the path, so the middleware cannot
        // be used directly. The farm chain is verified too (AU-3): a crop whose
        // farm is not owned is unreachable even if the crop row carries a
        // matching userId.
        const crop = await Crop.findOne({ _id: cropId, userId: req.auth.userId });
        if (!crop) return next(notFound());

        const farm = await Farm.findOne({ _id: crop.farmId, userId: req.auth.userId });
        if (!farm) return next(notFound());

        const registryCrop = await CropRegistry.findOne({ cropCode: crop.cropCode }).lean();

        // The fungal prior for the terminal rules tier. A DB read, never a
        // provider call on a request path (CLAUDE.md rule 3).
        const weatherContext = await latestWeatherContext(farm);

        const result = await analyze({
          user: req.user,
          crop,
          farm,
          registryCrop,
          buffer: req.file.buffer,
          description,
          shareToCommunity,
          weatherContext,
          requestId: req.id,
        });

        if (result.outcome === ANALYZE_OUTCOME.UPLOAD_REJECTED) {
          // Repeated rejects are the abuse signal the threat model relies on.
          auditService
            .record({
              event: AUDIT_EVENTS.UPLOAD_REJECTED,
              userId: req.auth.userId,
              ip: req.ip,
              meta: { reason: result.reason, userAgent: storedUserAgent(req) },
            })
            .catch((err) => logger.warn({ err }, 'upload-reject audit failed'));

          return next(uploadRejection(result.reason));
        }

        if (result.outcome === ANALYZE_OUTCOME.STORAGE_UNAVAILABLE) {
          // `rule` is the reason *class*, exactly as every other upload
          // rejection reports it — one vocabulary on the wire. The coarser
          // storage kind behind it (`not_configured` / `timeout` / `rejected`)
          // is a provider detail: it is logged server-side and is of no use to
          // a farmer, who can only retry either way.
          logger.warn(
            { requestId: req.id, reason: result.reason },
            'image storage unavailable — analysis not attempted',
          );

          return next(uploadRejection(UPLOAD_REJECTION.STORAGE_UNAVAILABLE));
        }

        const cached = result.outcome === ANALYZE_OUTCOME.CACHED;

        // 200 rather than the documented 201 on a cache hit, because nothing was
        // created: the identical photograph for the identical crop is the same
        // observation, and writing a second row would duplicate the timeline and
        // inflate community counts. The body says so explicitly via
        // `freshness.status`, so a client never has to infer it from the status
        // code. Recorded in ADR-024 and in docs/api/crop-health.md.
        sendData(
          res,
          { log: presentLog(result.log, { registryCrop, cached }) },
          { status: cached ? 200 : 201 },
        );
      } catch (err) {
        next(err);
      }
    },
  );

  // ── GET /logs ────────────────────────────────────────────────────────────────

  const logsQuerySchema = z
    .object({
      cropId: z
        .string()
        .trim()
        .regex(/^[a-f\d]{24}$/i)
        .optional(),
      /**
       * Scans belonging to one field.
       *
       * `CropHealthLog` has carried `farmId` since it was written, but nothing
       * could filter on it — so a farmer with onion on one field and soybean on
       * another saw both fields' scan history on whichever field they had
       * selected. The crop-health screen is farm-scoped like every other
       * farm-dependent surface, and this is what lets it be.
       *
       * Ownership is unaffected: `ownedBy` still scopes the query by `userId`,
       * so a farmId belonging to someone else simply matches nothing (AU-2 —
       * an empty list, never a 403).
       */
      farmId: z
        .string()
        .trim()
        .regex(/^[a-f\d]{24}$/i)
        .optional(),
      page: z.coerce.number().int().min(1).max(PAGE_MAX).default(1),
      limit: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(PAGE_SIZE_DEFAULT),
    })
    .strict();

  cropHealthRouter.get('/logs', validate({ query: logsQuerySchema }), async (req, res, next) => {
    try {
      const { cropId, farmId, page, limit } = req.query;

      // `ownedBy` scopes the query itself. Never post-filter (AU-4).
      const filter = {
        ...ownedBy(req),
        ...(cropId ? { cropId } : {}),
        ...(farmId ? { farmId } : {}),
      };

      const [logs, total] = await Promise.all([
        CropHealthLog.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        CropHealthLog.countDocuments(filter),
      ]);

      sendData(
        res,
        { logs: logs.map((log) => presentLog(log, { summary: true })) },
        { meta: pageMeta({ page, limit, total }) },
      );
    } catch (err) {
      next(err);
    }
  });

  // ── GET /logs/:id ────────────────────────────────────────────────────────────

  cropHealthRouter.get('/logs/:id', loadHealthLog, async (req, res, next) => {
    try {
      const registryCrop = await registryForLog(req.healthLog);
      sendData(res, { log: presentLog(req.healthLog, { registryCrop }) });
    } catch (err) {
      next(err);
    }
  });

  // ── POST /logs/:id/severity ──────────────────────────────────────────────────

  const severitySchema = z
    .object({
      affectedAreaPct: z.number().min(0).max(100).optional(),
      spreadRate: z.enum(SPREAD_RATES).optional(),
    })
    .strict()
    .refine(
      (value) => value.affectedAreaPct !== undefined || value.spreadRate !== undefined,
      'at least one follow-up answer is required',
    );

  cropHealthRouter.post(
    '/logs/:id/severity',
    loadHealthLog,
    validate({ body: severitySchema }),
    async (req, res, next) => {
      try {
        const log = req.healthLog;
        const { affectedAreaPct, spreadRate } = req.body;

        // The engine is re-run over the stored analysis plus the new answers.
        // There is no second severity implementation anywhere — the endpoint
        // supplies inputs and stores an output, and could not fabricate a level
        // if it wanted to.
        const severity = assessSeverity({
          diseaseCode: log.analysis?.diseaseCode ?? null,
          isHealthy: isHealthyCode(log.analysis?.diseaseCode),
          severityVisual: log.recommendationSnapshot?.data?.severityVisual ?? null,
          affectedAreaPct: affectedAreaPct ?? log.severityFollowUp?.affectedAreaPct ?? null,
          spreadRate: spreadRate ?? log.severityFollowUp?.spreadRate ?? null,
        });

        log.severityFollowUp = {
          affectedAreaPct: affectedAreaPct ?? log.severityFollowUp?.affectedAreaPct,
          spreadRate: spreadRate ?? log.severityFollowUp?.spreadRate,
          answeredAt: new Date(),
        };
        log.analysis.severityAssessment = severity.severity;
        // The snapshot the history renders from has to agree with the analysis,
        // or the timeline would show the old level beside the new one.
        if (log.recommendationSnapshot?.data) {
          log.recommendationSnapshot.data.severity = severity.severity;
          log.recommendationSnapshot.data.severityTrace = severity.trace;
          log.markModified('recommendationSnapshot');
        }

        await log.save();

        sendData(res, {
          severity: {
            level: severity.severity,
            escalate: severity.escalate,
            // Provenance: engine policy, not a measurement and not a model output.
            policy: severity.policy,
            reasonCode: severity.reasonCode,
            trace: severity.trace,
            answers: {
              affectedAreaPct: log.severityFollowUp.affectedAreaPct ?? null,
              spreadRate: log.severityFollowUp.spreadRate ?? null,
            },
          },
        });
      } catch (err) {
        next(err);
      }
    },
  );

  // ── POST /symptom-check ──────────────────────────────────────────────────────

  const symptomCheckSchema = z
    .object({
      cropId: z
        .string()
        .trim()
        .regex(/^[a-f\d]{24}$/i),
      answers: z
        .object({
          part: z.string().trim().max(40).optional(),
          pattern: z.string().trim().max(40).optional(),
          color: z.string().trim().max(40).optional(),
          distribution: z.string().trim().max(40).optional(),
          spread: z.enum(SPREAD_RATES).optional(),
        })
        .strict(),
    })
    .strict();

  cropHealthRouter.post(
    '/symptom-check',
    symptomCheckLimiter,
    validate({ body: symptomCheckSchema }),
    async (req, res, next) => {
      try {
        const { cropId, answers } = req.body;

        const crop = await Crop.findOne({ _id: cropId, userId: req.auth.userId });
        if (!crop) return next(notFound());

        const farm = await Farm.findOne({ _id: crop.farmId, userId: req.auth.userId });
        if (!farm) return next(notFound());

        const registryCrop = await CropRegistry.findOne({ cropCode: crop.cropCode }).lean();
        const weatherContext = await latestWeatherContext(farm);

        const result = matchSymptoms({
          registryCrop,
          answers,
          weatherContext,
          asOf: new Date(),
        });

        sendData(res, {
          candidates: result.candidates,
          guidance: {
            hasVerdict: result.hasVerdict,
            reasonCode: result.reasonCode,
            expertReferral: result.expertReferral,
            expertReferralReasons: result.expertReferralReasons,
            // "Guided assessment (no AI)" — the engine emits no prose, so the
            // label is mapped here from the tier it came from.
            sourceLabelKey: HEALTH_SOURCE_LABEL_KEYS[result.source],
            coverageNoticeKey: coverageNoticeKey(registryCrop?.supportLevel),
            answeredAxes: result.answeredAxes,
            weatherTags: result.weatherTags,
          },
          trace: result.trace,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  return cropHealthRouter;
}

/** The mounted router. Production composition: no injected dependencies. */
export const cropHealthRouter = createCropHealthRouter();

// ── Presentation ─────────────────────────────────────────────────────────────

/**
 * Log → wire shape.
 *
 * Two things are never present, by construction rather than by omission:
 * `imagePublicId` is `select: false` on the model (AU-5 — the id that can
 * manipulate the asset must not be enumerable), and no farmer-facing prose
 * appears anywhere; everything renderable is an i18n key or structured data.
 */
function presentLog(log, { registryCrop, cached = false, summary = false } = {}) {
  const analysis = log.analysis ?? {};
  const snapshot = log.recommendationSnapshot ?? {};

  const base = {
    id: String(log._id),
    cropId: String(log.cropId),
    imageUrl: log.imageUrl,
    description: log.description ?? null,
    status: log.status,
    sharedToCommunity: log.sharedToCommunity,
    createdAt: log.createdAt,
    analysis: {
      source: analysis.source ?? null,
      sourceLabelKey: HEALTH_SOURCE_LABEL_KEYS[analysis.source] ?? null,
      diseaseCode: analysis.diseaseCode ?? null,
      confidence: analysis.confidence ?? null,
      severityAssessment: analysis.severityAssessment ?? null,
      escalated: analysis.escalated === true,
    },
  };

  if (summary) return base;

  return {
    ...base,
    analysis: {
      ...base.analysis,
      modelVersion: analysis.modelVersion ?? null,
      top3: analysis.top3 ?? [],
      // The escalation path is the honesty record: which tiers were tried, and
      // why each declined. Reason codes only.
      escalationPath: analysis.escalationPath ?? [],
    },
    recommendation: {
      titleKey: snapshot.titleKey ?? HEALTH_TITLE_KEYS.UNKNOWN,
      data: snapshot.data ?? {},
    },
    severityFollowUp: log.severityFollowUp?.answeredAt
      ? {
          affectedAreaPct: log.severityFollowUp.affectedAreaPct ?? null,
          spreadRate: log.severityFollowUp.spreadRate ?? null,
          answeredAt: log.severityFollowUp.answeredAt,
        }
      : null,
    coverageNoticeKey: coverageNoticeKey(registryCrop?.supportLevel),
    freshness: {
      source: analysis.source ?? null,
      fetchedAt: log.createdAt,
      // A cache hit is labelled, never silent (● system, CLAUDE.md rule 9).
      status: cached ? 'cached' : 'live',
    },
  };
}

async function registryForLog(log) {
  const crop = await Crop.findById(log.cropId).select('cropCode').lean();
  if (!crop) return null;
  return CropRegistry.findOne({ cropCode: crop.cropCode }).lean();
}

/**
 * The weather half of the fungal prior.
 *
 * Best-effort by design: a farm with no cached snapshot yet still gets a
 * symptom result, just without the weather axis contributing — the engine
 * treats an unavailable axis as neither evidence for nor against.
 */
async function latestWeatherContext(farm) {
  if (!farm?.locationKey) return null;

  // Read straight from the cached snapshot. Deliberately not through
  // farmWeatherService.farmWeather(), which is a richer read that can queue a
  // priority refresh — a symptom check should not be able to trigger provider
  // work, and CLAUDE.md rule 3 keeps request paths off providers entirely.
  const snapshot = await WeatherSnapshot.findOne({ locationKey: farm.locationKey })
    .sort({ fetchedAt: -1 })
    .lean();

  const today = snapshot?.daily?.find((day) => day?.humidityPct != null) ?? snapshot?.daily?.[0];
  if (!today) return null;

  return {
    humidityPct: today.humidityPct ?? null,
    rainMm: today.rainMm ?? null,
    tMaxC: today.tMaxC ?? null,
  };
}
