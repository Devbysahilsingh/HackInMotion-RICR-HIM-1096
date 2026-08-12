import { Schema, model } from 'mongoose';

import { baseOptions } from './shared.js';

/**
 * District-level disease aggregates (P2).
 *
 * Structurally PII-free: there is no userId, no reporter list, no farm
 * reference — only counts. Privacy here is a property of the schema, not of
 * the query that reads it, so it cannot be undone by a careless endpoint.
 *
 * Schema only in Phase 1; the aggregation job that writes it lands in Phase 3.
 */
const communityAlertSchema = new Schema(
  {
    district: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    cropCode: { type: String, required: true, uppercase: true, trim: true },
    diseaseCode: { type: String, required: true, uppercase: true, trim: true },

    windowStart: { type: Date, required: true },
    windowEnd: { type: Date, required: true },

    reportCount: { type: Number, required: true, min: 0 },
    /** A count, never identities — a single farmer can never trigger an alert. */
    distinctFarmers: { type: Number, required: true, min: 0 },

    level: { type: String, enum: ['INFO', 'HIGH'], required: true },
    active: { type: Boolean, required: true, default: true },
  },
  baseOptions('communityAlerts'),
);

communityAlertSchema.index(
  { district: 1, cropCode: 1, active: 1 },
  { name: 'district_cropCode_active' },
);

export const CommunityAlert = model('CommunityAlert', communityAlertSchema);
