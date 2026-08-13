/**
 * Land-unit arithmetic, mirroring `backend/src/utils/locationKey.js` exactly.
 *
 * The land ledger — total crop area may not exceed the farm — is enforced by
 * the server; these helpers exist so the form can refuse the same planting
 * *before* the round trip and say how much ground is actually left. The two
 * sides must agree on the conversion table or the form would promise an area
 * the server then rejects.
 */
import type { CropWithStage, Farm, LandUnit } from '../types/api';

export const ACRES_PER_UNIT: Record<LandUnit, number> = {
  acre: 1,
  hectare: 2.47105,
  bigha: 0.625,
};

export function toAcres(value: number, unit: LandUnit): number {
  return value * ACRES_PER_UNIT[unit];
}

/**
 * Acres already committed to crops that occupy ground (`planned` + `active`;
 * a harvested crop frees its area). A crop that recorded a value without a
 * unit is read as acres — the same identity fallback the server applies.
 */
export function allocatedCropAcres(
  crops: readonly CropWithStage[],
  excludeCropId?: string,
): number {
  return crops
    .filter((crop) => crop.status !== 'harvested' && crop.id !== excludeCropId)
    .reduce(
      (sum, crop) => sum + (crop.areaValue ? toAcres(crop.areaValue, crop.areaUnit ?? 'acre') : 0),
      0,
    );
}

/** Ground still open for crops, floored at zero for display. */
export function availableFarmAcres(farm: Farm, crops: readonly CropWithStage[]): number {
  return Math.max(0, toAcres(farm.sizeValue, farm.sizeUnit) - allocatedCropAcres(crops));
}
