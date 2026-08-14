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

    /**
     * Client-generated id for one *submission attempt*, used only to make an
     * offline replay safe (docs/offline/offline-strategy.md).
     *
     * Deliberately NOT a natural key. A farmer can genuinely irrigate twice on
     * the same day, so `(cropId, date)` must stay non-unique — see the note on
     * `recordIrrigation`. This identifies "the same tap on the same button",
     * which is the only thing a sync queue may collapse. Absent on writes made
     * online, which is why the index below is partial rather than plain unique:
     * a plain unique index would treat every legacy `null` as a collision.
     */
    clientRequestId: { type: String },
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
/**
 * What actually makes an offline replay idempotent.
 *
 * Scoped to `userId` so one farmer's queued id can never collide with — or be
 * used to probe for — another's. Partial, so the many rows written online with
 * no `clientRequestId` are simply not indexed; a plain `unique` would reject
 * the second such row outright.
 */
irrigationLogSchema.index(
  { userId: 1, clientRequestId: 1 },
  {
    name: 'userId_clientRequestId_unique',
    unique: true,
    partialFilterExpression: { clientRequestId: { $type: 'string' } },
  },
);

export const IrrigationLog = model('IrrigationLog', irrigationLogSchema);
