import { Schema, model } from 'mongoose';

import { CROP_STATUSES, LAND_UNITS } from '../config/constants.js';
import { baseOptions } from './shared.js';

/**
 * A crop INSTANCE planted on a farm. All crop *knowledge* lives in
 * cropRegistry; this document holds only what is specific to this planting.
 */
const cropSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    farmId: { type: Schema.Types.ObjectId, ref: 'Farm', required: true },

    /**
     * Referenced by immutable code string, not ObjectId, so reseeding the
     * registry never orphans a farmer's crops (docs/database/relationships.md).
     */
    cropCode: { type: String, required: true, uppercase: true, trim: true },

    /**
     * Only populated for cropCode 'OTHER': the farmer's own words for a crop
     * the registry does not know. Never rendered as agronomic knowledge.
     */
    freeTextLabel: { type: String, trim: true, maxlength: 60 },

    variety: { type: String, trim: true, maxlength: 60 },

    sowingDate: { type: Date, required: true },

    areaValue: { type: Number, min: 0.01 },
    areaUnit: { type: String, enum: LAND_UNITS },

    status: { type: String, enum: CROP_STATUSES, required: true, default: 'active' },

    /** Water-balance ledger state, advanced by the irrigation engine (Phase 2). */
    waterBalance: {
      depletionMm: { type: Number, required: true, default: 0, min: 0 },
      lastComputedAt: { type: Date },
      /** False until a farmer log or a rain run anchors the ledger to reality. */
      initialized: { type: Boolean, required: true, default: false },
    },
  },
  baseOptions('crops'),
);

/** Ownership checks and farm views (docs/database/indexes.md). */
cropSchema.index({ userId: 1, farmId: 1 }, { name: 'userId_farmId' });
/** Community fan-out targets by crop. */
cropSchema.index({ cropCode: 1 }, { name: 'cropCode' });

export const Crop = model('Crop', cropSchema);
