import { Schema, model } from 'mongoose';

import { baseOptions } from './shared.js';

/**
 * Idempotency record for seed scripts (registry, demo farm, market seed).
 *
 * Seeds are run as ops scripts from a developer machine — there is
 * deliberately no admin HTTP surface (ADR-009). A seed compares its version
 * against the row here and does nothing when they match, so re-running is
 * always safe.
 */
const seedMetaSchema = new Schema(
  {
    /** Uniqueness declared once, as a named index below. */
    seedName: { type: String, required: true, trim: true },
    version: { type: String, required: true, trim: true },
    appliedAt: { type: Date, required: true },
    /** What the run actually did, for the deploy checklist's evidence trail. */
    summary: { type: Schema.Types.Mixed, default: {} },
  },
  baseOptions('seedMeta'),
);

/** Uniqueness is what makes "apply once" enforceable rather than conventional. */
seedMetaSchema.index({ seedName: 1 }, { unique: true, name: 'seedName_unique' });

export const SeedMeta = model('SeedMeta', seedMetaSchema);
