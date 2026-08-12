import { Schema, model } from 'mongoose';

import { baseOptions } from './shared.js';

/**
 * Security event log. Written by middleware, never updated, purged at 30 days.
 *
 * `userId` is a String, not an ObjectId ref: account deletion replaces it with
 * a tombstone hash so the security record survives without identifying anyone
 * (docs/database/data-lifecycle.md). An ObjectId path could not hold that.
 */
const auditLogSchema = new Schema(
  {
    /** Hex ObjectId, a deletion tombstone hash, or absent for anonymous events. */
    userId: { type: String, index: false },

    /**
     * Open vocabulary by design — new subsystems add events without a schema
     * migration, so this is not a closed Mongoose enum. Known values live in
     * AUDIT_EVENTS (src/config/constants.js).
     */
    event: { type: String, required: true },

    ip: { type: String },

    /**
     * Contextual detail: user agent, route, outcome. Must never contain
     * passwords, tokens or token hashes — the logger redaction list covers the
     * same field names for the log stream.
     */
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  baseOptions('auditLogs'),
);

/** TTL 30 days — retention, not performance. */
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60, name: 'ttl_30d' });

export const AuditLog = model('AuditLog', auditLogSchema);
