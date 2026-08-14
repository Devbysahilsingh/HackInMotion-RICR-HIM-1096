import type { FeedItem } from '@/api/types';

/**
 * Where a feed item's "view" action goes, by type. Null when the item has no
 * natural detail page.
 *
 * Lives here rather than beside either component that uses it, because both
 * `FeedItemCard` and `DecisionBanner` render feed items — the card for the
 * ordinary ones, the banner for the highest-priority one — and they have to
 * send a farmer to the same place. Two copies of this mapping would drift the
 * first time a feed type was added.
 *
 * (A module of its own, not an export from the card: a component file that also
 * exports a plain function breaks Fast Refresh, which `react-refresh` warns
 * about and which is genuinely annoying to work under.)
 */
export function feedTarget(item: FeedItem): string | null {
  if (item.type === 'irrigation' && item.cropId) return `/crops/${item.cropId}?tab=irrigation`;
  if (item.type === 'weather-risk' && item.farmId) return `/farms/${item.farmId}/weather`;
  if (item.type === 'market') return '/market';
  if (item.type === 'fertilizer' && item.cropId) return `/crops/${item.cropId}?tab=fertilizer`;
  if (item.type === 'health' && item.cropId) return `/crops/${item.cropId}?tab=health`;
  if (item.type === 'community') return '/community';
  if (item.type === 'crop-suggestion') return '/crop-recommendation';
  return null;
}
