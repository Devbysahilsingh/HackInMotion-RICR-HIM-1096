import { Schema, model } from 'mongoose';

import {
  INDIA_BOUNDS,
  IRRIGATION_METHODS,
  LAND_UNITS,
  LOCATION_SOURCES,
  SOIL_TYPES,
} from '../config/constants.js';
import { baseOptions } from './shared.js';

/**
 * One farm models one field. Multi-field holdings are multiple farm documents
 * — a deliberate simplification recorded in docs/database/schema.md.
 */
const locationSchema = new Schema(
  {
    lat: { type: Number, min: INDIA_BOUNDS.minLat, max: INDIA_BOUNDS.maxLat },
    lon: { type: Number, min: INDIA_BOUNDS.minLon, max: INDIA_BOUNDS.maxLon },
    state: { type: String, required: true, trim: true },
    district: { type: String, required: true, trim: true },
    source: { type: String, enum: LOCATION_SOURCES, required: true },
  },
  { _id: false },
);

const farmSchema = new Schema(
  {
    /** Ownership is denormalized onto every owned document (invariant AU-1). */
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    name: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },

    location: { type: locationSchema, required: true },

    sizeValue: { type: Number, required: true, min: 0.01 },
    sizeUnit: { type: String, enum: LAND_UNITS, required: true },

    soilType: { type: String, enum: SOIL_TYPES, required: true },
    irrigationMethod: { type: String, enum: IRRIGATION_METHODS, required: true },

    /**
     * Weather is fetched per 0.1° grid cell, not per farm, so nearby farms
     * share one provider call. Derived on write by the location hook; the
     * refresh job treats the distinct set of these as its work list.
     */
    locationKey: { type: String },

    notes: { type: String, trim: true, maxlength: 500 },
  },
  baseOptions('farms'),
);

farmSchema.index({ userId: 1 }, { name: 'userId' });

export const Farm = model('Farm', farmSchema);
