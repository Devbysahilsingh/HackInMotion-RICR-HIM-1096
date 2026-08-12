import { Schema, model } from 'mongoose';

import { baseOptions } from './shared.js';

/**
 * Rotating refresh tokens with family-based reuse detection.
 *
 * Only the sha256 of the token is stored: a database dump yields nothing that
 * can be replayed. Revoked rows are deliberately KEPT until their TTL expires
 * — deleting them on rotation would destroy the very evidence reuse detection
 * depends on (docs/database/data-lifecycle.md).
 */
const refreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    /** Uniqueness declared once, as a named index below. */
    tokenHash: { type: String, required: true },

    /** All descendants of one login share a familyId; reuse revokes the lot. */
    familyId: { type: String, required: true },

    jti: { type: String, required: true },

    expiresAt: { type: Date, required: true },

    revokedAt: { type: Date },

    /** Points at the successor issued when this token was rotated. */
    replacedByJti: { type: String },

    userAgent: { type: String },
    ip: { type: String },
  },
  baseOptions('refreshTokens'),
);

refreshTokenSchema.index({ tokenHash: 1 }, { unique: true, name: 'tokenHash_unique' });
/** TTL(0): Mongo removes the row once expiresAt passes. */
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'expiresAt_ttl' });
refreshTokenSchema.index({ familyId: 1 }, { name: 'familyId' });
/**
 * Not in the documented index list, but account deletion and "log out
 * everywhere" both revoke by user; without this they are collection scans.
 * Named query, per the "no index without a named query" rule.
 */
refreshTokenSchema.index({ userId: 1 }, { name: 'userId' });

export const RefreshToken = model('RefreshToken', refreshTokenSchema);
