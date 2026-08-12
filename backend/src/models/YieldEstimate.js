import { Schema, model } from 'mongoose';

import { baseOptions, sourceRefSchema } from './shared.js';

/**
 * P3 — schema reserved, no writes in the MVP.
 *
 * The endpoint answers 501 until the estimator is built; the shape is
 * committed now so the contract is honest rather than invented later
 * (docs/yield/yield-estimation.md). Deliberately NOT machine learning: a
 * transparent district-median calculation with cited adjustment factors.
 */
const yieldEstimateSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    cropId: { type: Schema.Types.ObjectId, ref: 'Crop', required: true },

    districtAvgYield: { type: Number, required: true },
    areaValue: { type: Number, required: true },

    adjustments: {
      type: [
        new Schema(
          {
            factor: { type: String, required: true },
            multiplier: { type: Number, required: true },
            reasonKey: { type: String, required: true },
            sourceRef: { type: sourceRefSchema },
          },
          { _id: false },
        ),
      ],
      default: [],
    },

    /** Always a range, never a point estimate — the honesty requirement. */
    estimateRange: {
      low: { type: Number, required: true },
      high: { type: Number, required: true },
      unit: { type: String, required: true },
    },

    inputsSnapshot: { type: Schema.Types.Mixed },
    /** Which disclaimer text the farmer was shown when this was produced. */
    disclaimerVersion: { type: String, required: true },
  },
  baseOptions('yieldEstimates'),
);

/**
 * Not in the documented index list, which predates the AU-4 scoping rule
 * being applied to this collection: every read is ownership-scoped, so the
 * query exists even though the writer does not yet.
 */
yieldEstimateSchema.index({ userId: 1, cropId: 1 }, { name: 'userId_cropId' });

export const YieldEstimate = model('YieldEstimate', yieldEstimateSchema);
