import { Schema, model } from 'mongoose';

import { baseOptions } from './shared.js';

/**
 * Weather cache AND short history, keyed by 0.1° grid cell rather than by
 * farm. Not user-owned: it carries no userId and is shared across every farm
 * in the same cell.
 *
 * Hard invariant: a failed fetch never overwrites `daily`. It may only move
 * `status` to 'stale'. Serving yesterday's real numbers labelled ● Cached is
 * always better than serving nothing or serving a guess.
 */
const dailySchema = new Schema(
  {
    date: { type: Date, required: true },
    tMinC: { type: Number, required: true, min: -30, max: 55 },
    tMaxC: { type: Number, required: true, min: -30, max: 55 },
    humidityPct: { type: Number, min: 0, max: 100 },
    windKmh: { type: Number, min: 0 },
    rainMm: { type: Number, min: 0, max: 500 },
    rainProbPct: { type: Number, min: 0, max: 100 },
    /** FAO reference evapotranspiration — the irrigation engine's fuel. */
    et0Mm: { type: Number, min: 0, max: 15 },
  },
  { _id: false },
);

const weatherSnapshotSchema = new Schema(
  {
    /** "lat,lon" rounded to 0.1°. */
    locationKey: { type: String, required: true },
    source: { type: String, enum: ['open-meteo', 'openweathermap'], required: true },

    fetchedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },

    status: { type: String, enum: ['ok', 'stale'], required: true, default: 'ok' },
    lastSuccessAt: { type: Date },

    /** 7 past + 7 forecast days. */
    daily: { type: [dailySchema], default: [] },

    /** Trimmed provider payload, capped, for debugging only. Never served. */
    raw: { type: Schema.Types.Mixed, select: false },
  },
  baseOptions('weatherSnapshots'),
);

weatherSnapshotSchema.index(
  { locationKey: 1, source: 1 },
  { unique: true, name: 'locationKey_source_unique' },
);
/**
 * Deliberately a plain index, NOT a TTL: expired snapshots must survive so a
 * provider outage can still be answered from last-known-good.
 */
weatherSnapshotSchema.index({ expiresAt: 1 }, { name: 'expiresAt' });

export const WeatherSnapshot = model('WeatherSnapshot', weatherSnapshotSchema);
