import { toAcres } from '../../utils/locationKey.js';

/**
 * How much of a field is free to plant into — PURE.
 *
 * The same land-ledger rule the crop form and `cropService` already enforce,
 * read rather than enforced: a crop that is `planned` or `active` occupies its
 * ground, and a `harvested` one gives it back. Recomputing it here rather than
 * importing `cropService`'s copy would be a second conversion table to keep in
 * step with the server's, which is exactly how a form starts promising an area
 * the API rejects — so the shared `toAcres` is used, as it is everywhere else.
 *
 * A crop with an area but no unit is read as acres, matching the identity
 * fallback `cropService.assertAreaFits` applies. A crop with no area at all
 * occupies no *countable* ground: it is excluded from the arithmetic rather
 * than counted as zero, and `unmeasuredCrops` reports how many were skipped so
 * a caller can say the figure is a floor rather than a certainty.
 *
 * @param {{sizeValue: number, sizeUnit: string}} farm
 * @param {Array<{status: string, areaValue?: number, areaUnit?: string}>} crops
 */
export function resolveLandAvailability(farm, crops = []) {
  const totalAcres = round(toAcres(farm.sizeValue ?? 0, farm.sizeUnit ?? 'acre'));

  const occupying = crops.filter((crop) => crop.status !== 'harvested');
  const measured = occupying.filter((crop) => typeof crop.areaValue === 'number');

  const allocatedAcres = round(
    measured.reduce((sum, crop) => sum + toAcres(crop.areaValue, crop.areaUnit ?? 'acre'), 0),
  );

  return {
    totalAcres,
    allocatedAcres,
    availableAcres: round(Math.max(0, totalAcres - allocatedAcres)),
    /** Crops holding ground whose area nobody recorded — the figure's error bar. */
    unmeasuredCrops: occupying.length - measured.length,
    occupiedBy: measured.map((crop) => ({
      cropCode: crop.cropCode,
      status: crop.status,
      acres: round(toAcres(crop.areaValue, crop.areaUnit ?? 'acre')),
    })),
  };
}

const round = (value) => Math.round(value * 100) / 100;
