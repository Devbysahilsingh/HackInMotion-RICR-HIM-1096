import type { FeedItem } from '@/api/types';

/**
 * Which of the account-wide feed items belong to one farm.
 *
 * `/dashboard` is contracted to be one aggregation across the whole account
 * (rule 3: no per-farm request), so every farm-scoped surface narrows the same
 * payload in memory. That narrowing has to be identical everywhere — the
 * dashboard, the farm's own screen and a crop's screen must not disagree about
 * whether an item belongs to the farm being looked at — so it lives here rather
 * than being written out again at each call site.
 *
 * The rules, in the order the payload allows them:
 *
 *   1. `farmId` when the item carries one — the composer's own attribution.
 *   2. `cropId` otherwise, matched against the farm's crops.
 *   3. `data.cropCode` otherwise: a market item belongs to no single farm (a
 *      mandi price is not a property of anyone's field, and `marketCandidate`
 *      never sets `farmId`), so it is shown to a farm that actually grows the
 *      commodity.
 *   4. Anything with none of the three — a community alert — is farm-agnostic
 *      by nature and stays visible regardless of which farm is selected.
 */
export function feedForFarm(
  feed: readonly FeedItem[],
  scope: { farmId: string; cropIds: ReadonlySet<string>; cropCodes: ReadonlySet<string> },
): FeedItem[] {
  return feed.filter((item) => {
    if (item.farmId) return item.farmId === scope.farmId;
    if (item.cropId) return scope.cropIds.has(item.cropId);
    const cropCode = item.data.cropCode;
    if (typeof cropCode === 'string') return scope.cropCodes.has(cropCode);
    return true;
  });
}

/**
 * The items that name one specific crop.
 *
 * Stricter than `feedForFarm` on purpose: a crop's own screen must never show
 * the farm's rain warning for a different planting, so an item only qualifies
 * when it carries this crop's id, or when it carries no id but names this
 * crop's commodity (the market case above).
 */
export function feedForCrop(
  feed: readonly FeedItem[],
  scope: { cropId: string; cropCode: string },
): FeedItem[] {
  return feed.filter((item) => {
    if (item.cropId) return item.cropId === scope.cropId;
    if (item.farmId) return false;
    return item.data.cropCode === scope.cropCode;
  });
}
