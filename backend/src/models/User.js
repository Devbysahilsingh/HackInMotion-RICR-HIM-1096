import { Schema, model } from 'mongoose';

import { LANGUAGES, LAND_UNITS } from '../config/constants.js';
import { baseOptions } from './shared.js';

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },

    // Uniqueness is declared once, as a named index below. Adding `unique`
    // here too would have Mongoose build a second, differently named index for
    // the same key.
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    /** Reserved: stored shape allows it, but no endpoint reads or writes it. */
    phone: { type: String, trim: true },

    /**
     * bcrypt cost 12. `select: false` means it is absent from every query
     * result unless explicitly asked for, so no serializer can leak it by
     * accident — only the login path opts in.
     */
    passwordHash: { type: String, required: true, select: false },

    language: { type: String, enum: LANGUAGES, required: true, default: 'en' },

    units: {
      land: { type: String, enum: LAND_UNITS, required: true, default: 'acre' },
    },

    voiceEnabled: { type: Boolean, required: true, default: false },

    /** Explicit opt-in — community sharing is off until the farmer turns it on. */
    communityConsent: { type: Boolean, required: true, default: false },

    lastLoginAt: { type: Date },
  },
  baseOptions('users'),
);

/** Login lookup and duplicate prevention (docs/database/indexes.md). */
userSchema.index({ email: 1 }, { unique: true, name: 'email_unique' });

/**
 * The canonical client projection. Every endpoint that returns a user goes
 * through here, so a field added to the schema cannot silently start being
 * served — `passwordHash` and `phone` are excluded by construction.
 */
userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id.toString(),
    name: this.name,
    email: this.email,
    language: this.language,
    units: { land: this.units.land },
    voiceEnabled: this.voiceEnabled,
    communityConsent: this.communityConsent,
    createdAt: this.createdAt,
  };
};

export const User = model('User', userSchema);
