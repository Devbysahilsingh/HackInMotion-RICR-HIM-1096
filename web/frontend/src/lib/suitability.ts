/**
 * The score band a recommendation falls in.
 *
 * A presentation band over the engine's own 0–1 score, and nothing more — it
 * never changes the number, only how it is labelled. The cut points live here
 * rather than in a component because the list card and the detail header must
 * label the same crop identically; two copies would eventually disagree, and a
 * farmer seeing "Highly suitable" on a card and "Suitable" on the page it opens
 * has been given two answers.
 *
 * The thresholds are a UI convention with no agronomic source behind them, so
 * nothing downstream may present them as a published grade.
 */
export type SuitabilityBand = 'HIGH' | 'MED' | 'LOW';

export const SUITABILITY_CUTS = Object.freeze({ high: 0.8, med: 0.65 });

export function suitabilityOf(score: number | null | undefined): SuitabilityBand {
  if (typeof score !== 'number') return 'LOW';
  if (score >= SUITABILITY_CUTS.high) return 'HIGH';
  if (score >= SUITABILITY_CUTS.med) return 'MED';
  return 'LOW';
}
