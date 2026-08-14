/**
 * Which season a farmer is planting into — PURE.
 *
 * ## Why this exists
 *
 * The recommendation wizard used to ask the farmer to pick a season from a
 * dropdown. That is a question the calendar already answers, and asking it put
 * the burden of knowing "is it Rabi yet?" on the person least served by being
 * asked. The engine still accepts an explicit season (the wizard's contract is
 * unchanged); this is what supplies one when nobody does.
 *
 * ## What the month boundaries are, and what they are not
 *
 * The Kharif / Rabi / Zaid split is the standard Indian cropping calendar as
 * published by the Ministry of Agriculture & Farmers Welfare and used
 * throughout DES crop statistics. It is a *convention*, not a measurement, and
 * it is national rather than district-specific: a Punjab Rabi sowing window and
 * a Karnataka one do not open on the same day.
 *
 * So the resolver reports `basis: 'CALENDAR_MONTH'` on everything it returns,
 * and the UI is expected to say so. It does not pretend to know the local
 * sowing date, and nothing downstream may present its answer as one. Where a
 * crop's own registry entry carries sowing windows, those are the authority —
 * this only decides which season's windows to look at.
 */

/** The three cropping seasons, in calendar order within an agricultural year. */
export const SEASON_MONTHS = Object.freeze({
  /** Monsoon-sown. Sowing opens with the south-west monsoon. */
  KHARIF: Object.freeze({ sowFrom: 6, sowTo: 7, growsTo: 10 }),
  /** Winter-sown, on residual moisture or irrigation. */
  RABI: Object.freeze({ sowFrom: 10, sowTo: 11, growsTo: 3 }),
  /** The short summer crop between Rabi harvest and the monsoon. */
  ZAID: Object.freeze({ sowFrom: 3, sowTo: 4, growsTo: 6 }),
});

/**
 * Month (1–12) → the season whose sowing window is open or opening next.
 *
 * Written out rather than computed from `SEASON_MONTHS` because the wrap-around
 * at the year boundary makes the arithmetic version harder to check than the
 * table it replaces, and this table is the thing a reviewer needs to audit.
 */
const UPCOMING_BY_MONTH = Object.freeze({
  1: 'ZAID', // Rabi is in the ground; Zaid is what comes next.
  2: 'ZAID',
  3: 'ZAID', // Zaid sowing opens.
  4: 'ZAID',
  5: 'KHARIF', // Zaid is sown; the monsoon crop is next.
  6: 'KHARIF', // Kharif sowing opens.
  7: 'KHARIF',
  8: 'RABI', // Kharif is sown; Rabi is what a farmer plans next.
  9: 'RABI',
  10: 'RABI', // Rabi sowing opens.
  11: 'RABI',
  12: 'ZAID',
});

/** Month → the season currently occupying the ground, if any. */
const CURRENT_BY_MONTH = Object.freeze({
  1: 'RABI',
  2: 'RABI',
  3: 'RABI',
  4: 'ZAID',
  5: 'ZAID',
  6: 'KHARIF',
  7: 'KHARIF',
  8: 'KHARIF',
  9: 'KHARIF',
  10: 'KHARIF',
  11: 'RABI',
  12: 'RABI',
});

/**
 * @param {{asOf?: Date}} [options]
 * @returns {{
 *   season: 'KHARIF'|'RABI'|'ZAID',
 *   currentSeason: 'KHARIF'|'RABI'|'ZAID',
 *   sowingWindowOpen: boolean,
 *   /** The agricultural year the recommended season belongs to. *\/
 *   year: number,
 *   basis: 'CALENDAR_MONTH',
 * }}
 */
export function resolveSeason({ asOf = new Date() } = {}) {
  const month = asOf.getMonth() + 1;
  const season = UPCOMING_BY_MONTH[month];
  const currentSeason = CURRENT_BY_MONTH[month];
  const window = SEASON_MONTHS[season];

  const sowingWindowOpen = month >= window.sowFrom && month <= window.sowTo;

  /*
   * A Rabi recommendation made in August is for *this* calendar year's Rabi; one
   * made in December is for next year's Zaid. The year is the year the sowing
   * window actually falls in, so a label never reads "Rabi 2026" in a December
   * that is planning 2027.
   */
  const year = window.sowFrom < month ? asOf.getFullYear() + 1 : asOf.getFullYear();

  return {
    season,
    currentSeason,
    sowingWindowOpen,
    year: sowingWindowOpen ? asOf.getFullYear() : year,
    basis: 'CALENDAR_MONTH',
  };
}
