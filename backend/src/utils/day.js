/**
 * Day boundaries in the application's civil time zone.
 *
 * Every "day" this system reasons about is an **IST** day: a rainfall total, an
 * irrigation ledger entry, a mandi arrival date, a feed dedup key. India
 * observes a single zone and no daylight saving, so the offset is a constant
 * and the arithmetic needs no zone database.
 *
 * This module exists because `date.setHours(0, 0, 0, 0)` — the obvious way to
 * write "start of day" — uses the *host's* zone. Render runs UTC, so on the
 * deployed instance that call would place the boundary at 05:30 IST: between
 * 18:30 and midnight IST, "today" would silently become tomorrow, shifting a
 * ledger entry into the wrong day and splitting an evening's rain across two
 * rows. Local tests would pass on an IST laptop and the fault would appear only
 * in production, which is the worst possible place to discover it.
 *
 * Open-Meteo is queried with `timezone=Asia/Kolkata` for the same reason: the
 * provider's day boundary and ours have to be the same boundary.
 */
import { APP_TIMEZONE } from '../config/constants.js';

/** UTC+05:30, fixed — India has no DST. */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const toMs = (value) => {
  // `new Date(null)` is epoch 0, not an Invalid Date, so a missing value would
  // silently become 1 January 1970 and bucket alongside real data. Nullish and
  // empty inputs are rejected before construction rather than after.
  if (value === null || value === undefined || value === '') return null;

  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
};

/**
 * The IST calendar date containing `value`, as `YYYY-MM-DD`.
 * This is the canonical day key — dedup keys and ledger rows use it.
 */
export function dayKey(value) {
  const ms = toMs(value);
  return ms === null ? null : new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant 00:00 IST of the day containing `value`, as a Date (UTC-based). */
export function startOfDay(value) {
  const ms = toMs(value);
  if (ms === null) return null;
  const shifted = ms + IST_OFFSET_MS;
  return new Date(Math.floor(shifted / MS_PER_DAY) * MS_PER_DAY - IST_OFFSET_MS);
}

/** The instant 23:59:59.999 IST of the day containing `value`. */
export function endOfDay(value) {
  const start = startOfDay(value);
  return start === null ? null : new Date(start.getTime() + MS_PER_DAY - 1);
}

/**
 * Whole IST days from `from` to `date`. Negative for past days, 0 for the same
 * day. Used everywhere an engine needs "how many days ahead is this forecast
 * row" without tripping over partial days or host zones.
 */
export function daysBetween(date, from) {
  const a = startOfDay(date);
  const b = startOfDay(from);
  return a && b ? Math.round((a.getTime() - b.getTime()) / MS_PER_DAY) : null;
}

export { APP_TIMEZONE, MS_PER_DAY };
