import { Schema, model } from 'mongoose';

import { baseOptions } from './shared.js';

/**
 * An observation and its 0..1 analysis, merged into one document.
 * Separate collections would force a join on every history read
 * (docs/database/schema.md). Append-only: never updated after write.
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

    description: { type: String, trim: true, maxlength: 500 },

    analysis: {
      source: { type: String, enum: ['ml', 'gemini', 'rules'] },
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
