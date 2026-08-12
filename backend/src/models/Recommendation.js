import { Schema, model } from 'mongoose';

import { baseOptions } from './shared.js';

/**
 * Dashboard feed items. This collection also serves as the in-app
 * notification store — there is deliberately no separate notifications
 * collection (docs/database/schema.md).
 */
const recommendationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    farmId: { type: Schema.Types.ObjectId, ref: 'Farm' },
    cropId: { type: Schema.Types.ObjectId, ref: 'Crop' },

    type: {
      type: String,
      enum: [
        'irrigation',
        'weather-risk',
        'health',
        'market',
        'fertilizer',
        'community',
        'crop-suggestion',
      ],
      required: true,
    },

    priority: { type: String, enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'INFO'], required: true },

    source: {
      type: String,
      enum: ['WEATHER', 'ML', 'RULE_ENGINE', 'MARKET', 'COMMUNITY', 'HYBRID'],
      required: true,
    },

    /** Keys + params only — the API never returns display prose. */
    titleKey: { type: String, required: true },
    bodyKey: { type: String, required: true },
    /** i18n params plus the why-trace numbers behind the verdict (R12). */
    data: { type: Schema.Types.Mixed, required: true, default: {} },

    confidence: { type: Number, min: 0, max: 1 },

    validUntil: { type: Date, required: true },
    acknowledgedAt: { type: Date },
  },
  baseOptions('recommendations'),
);

/** The feed query: unacknowledged items for a user, most urgent and newest first. */
recommendationSchema.index(
  { userId: 1, acknowledgedAt: 1, priority: 1, createdAt: -1 },
  { name: 'feed' },
);
/**
 * Plain index, NOT a TTL: expiry is a job so that items linger a further 7
 * days after validUntil rather than vanishing the instant they lapse.
 */
recommendationSchema.index({ validUntil: 1 }, { name: 'validUntil' });

export const Recommendation = model('Recommendation', recommendationSchema);
