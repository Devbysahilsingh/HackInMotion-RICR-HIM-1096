import { Schema, model } from 'mongoose';

import { baseOptions } from './shared.js';

/**
 * An observation and its 0..1 analysis, merged into one document.
 * Separate collections would force a join on every history read
 * (docs/database/schema.md).
 *
 * **Append-only, with one named exception.** The observation and the tier
 * analysis are immutable once written: nothing re-runs a diagnosis over an
 * existing row, and a re-upload creates a new row rather than editing one. The
 * exception is the severity follow-up (`POST /crop-health/logs/:id/severity`),
 * which the API contract defines as amending this document — the farmer answers
 * "how much is affected?" after the fact and the engine re-derives
 * `analysis.severityAssessment` from it.
 *
 * That is a genuine narrowing of the original rule rather than an oversight, so
 * it is bounded rather than left implicit: only `severityFollowUp` and
 * `analysis.severityAssessment` may ever change, only through that one
 * endpoint, and only for the owning user. `diseaseCode`, `source`, `confidence`
 * and the image are never rewritten, so the record of what was observed and
 * what each tier said stays intact. Recorded in ADR-024.
 */
const cropHealthLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    cropId: { type: Schema.Types.ObjectId, ref: 'Crop', required: true },
    /** Denormalized so community aggregation never joins back through crops. */
    farmId: { type: Schema.Types.ObjectId, ref: 'Farm', required: true },

    imageUrl: { type: String, required: true },
    /** Needed to destroy the Cloudinary asset on cascade delete. Never served. */
    imagePublicId: { type: String, required: true, select: false },

    /**
     * SHA-256 of the *re-encoded* image, which keys the analysis cache
     * (docs/ai/ai-architecture.md: "identical photo re-analysis served from
     * cache"). Hashing the re-encoded bytes rather than the upload is what
     * makes a genuine re-upload recognisable — two shots of one leaf differ in
     * EXIF timestamp, so raw hashes would never collide.
     *
     * Not indexed. The cache lookup filters on `{userId, cropId, imageHash}`,
     * and `userId_cropId_createdAt` already covers the first two — over a
     * 10-analyses-per-day quota and a 7-day window that leaves a handful of
     * documents to compare, which is not worth an index on an M0 cluster.
     */
    imageHash: { type: String, select: false },

    description: { type: String, trim: true, maxlength: 500 },

    analysis: {
      source: { type: String, enum: ['ml', 'gemini', 'rules'] },
      /**
       * The specific provider behind the tier. `source` is the *tier* the
       * farmer is told about ("AI-assisted"), and Gemini and OpenRouter are one
       * tier — but which of them actually answered matters for debugging a bad
       * result and for the free-tier budget, so it is recorded separately
       * rather than collapsed into the honesty label.
       */
      provider: { type: String },
      modelVersion: { type: String },
      /** A registry disease code, or the honest sentinel 'UNKNOWN'. */
      diseaseCode: { type: String, uppercase: true, trim: true },
      confidence: { type: Number, min: 0, max: 1 },
      top3: {
        type: [
          new Schema(
            {
              diseaseCode: { type: String, uppercase: true },
              confidence: { type: Number, min: 0, max: 1 },
            },
            { _id: false },
          ),
        ],
        default: [],
      },
      /** Engine-assessed, never model-fabricated (CLAUDE.md rule 9). */
      severityAssessment: { type: String },
      escalated: { type: Boolean, default: false },

      /**
       * Which tiers were tried and why each one did not answer
       * (docs/ai/ai-architecture.md: "Source + escalation path stored on the
       * log and shown in UI"). Reason codes only — never a provider's own
       * message, which can quote the request.
       */
      escalationPath: {
        type: [
          new Schema({ provider: { type: String }, reason: { type: String } }, { _id: false }),
        ],
        default: [],
      },
    },

    /**
     * The follow-up answers behind `analysis.severityAssessment`.
     *
     * Stored because the assessment is engine-derived: keeping the inputs makes
     * the output reproducible and auditable, which is the whole difference
     * between an engine verdict and a number someone typed. This is also the
     * one field that relaxes the append-only rule above — see the schema note.
     */
    severityFollowUp: {
      affectedAreaPct: { type: Number, min: 0, max: 100 },
      spreadRate: { type: String },
      answeredAt: { type: Date },
    },

    /** i18n key + params, so history renders in the farmer's language later. */
    recommendationSnapshot: {
      titleKey: { type: String },
      data: { type: Schema.Types.Mixed },
    },

    /** Only settable while the owning user's communityConsent is true. */
    sharedToCommunity: { type: Boolean, required: true, default: false },

    status: {
      type: String,
      enum: ['analyzed', 'failed', 'pending'],
      required: true,
      default: 'pending',
    },
  },
  baseOptions('cropHealthLogs'),
);

/** History timeline; userId prefix also serves ownership-scoped lists. */
cropHealthLogSchema.index(
  { userId: 1, cropId: 1, createdAt: -1 },
  { name: 'userId_cropId_createdAt' },
);
/** Community aggregation scans only shared logs — partial keeps it tiny. */
cropHealthLogSchema.index(
  { sharedToCommunity: 1, createdAt: 1 },
  { name: 'shared_createdAt', partialFilterExpression: { sharedToCommunity: true } },
);

export const CropHealthLog = model('CropHealthLog', cropHealthLogSchema);
