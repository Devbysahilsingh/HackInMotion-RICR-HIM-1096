import { Schema, model } from 'mongoose';

import { baseOptions } from './shared.js';

/** Farmer-reported irrigation events — the ledger input the engine trusts. */
const irrigationLogSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    cropId: { type: Schema.Types.ObjectId, ref: 'Crop', required: true },

    date: { type: Date, required: true },

    /**
     * Absent means "refilled to field capacity" rather than zero — the engine
     * treats a log without an amount as a full refill marked 'assumed'.
     */
    amountMm: { type: Number, min: 0.01, max: 200 },

    source: { type: String, enum: ['farmer', 'assumed'], required: true, default: 'farmer' },
  },
  baseOptions('irrigationLogs'),
);

/** Water-balance ledger reads by crop, newest first. */
irrigationLogSchema.index({ cropId: 1, date: -1 }, { name: 'cropId_date' });
/**
 * Beyond the documented list: cascade-on-account-delete and any user-scoped
 * history read filter by userId, which the cropId-prefixed index cannot serve.
 */
irrigationLogSchema.index({ userId: 1, date: -1 }, { name: 'userId_date' });

export const IrrigationLog = model('IrrigationLog', irrigationLogSchema);
