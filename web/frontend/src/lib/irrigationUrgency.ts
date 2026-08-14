import type { CropCard, IrrigationVerdict } from '@/api/types';

/**
 * Which verdict leads a screen when several crops have one.
 *
 * Ranking is a UI concern — deciding which of several engine verdicts to set
 * largest — and it is deliberately kept apart from the verdicts themselves,
 * which the engine owns. It lives here rather than inside either page because
 * the weather screen and the irrigation screen must lead with the *same* crop:
 * a farmer who reads "skip irrigation" on one and sees a different crop's
 * working on the other has been given two answers.
 */
const URGENCY: Record<string, number> = {
  IRRIGATE_TODAY: 0,
  IRRIGATE_IN_N_DAYS: 1,
  MAINTAIN_WATER_LEVEL: 2,
  WAIT_RAIN_EXPECTED: 3,
  NO_IRRIGATION_NEEDED: 4,
  UNAVAILABLE: 5,
};

export const urgencyOf = (verdict: IrrigationVerdict | null | undefined): number =>
  URGENCY[verdict ?? 'UNAVAILABLE'] ?? 9;

/** The farm's crops, most urgent first. Does not mutate the input. */
export function byUrgency(cards: readonly CropCard[]): CropCard[] {
  return [...cards].sort((a, b) => urgencyOf(a.irrigationVerdict) - urgencyOf(b.irrigationVerdict));
}
