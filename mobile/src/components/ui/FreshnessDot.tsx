/**
 * The honesty label (CLAUDE.md rule 9).
 *
 * Every data-bearing surface in this app carries one of these, and it means
 * exactly the same thing on every screen: `live` is inside its TTL, `cached`
 * is the last good value, `historical` is archived rather than current, and
 * `pending` is "we have never managed to fetch this". The status comes from the
 * API's own `freshness` block — the client never decides it, because the
 * server's cache is what actually governs it.
 *
 * Colour is a second signal only: the dot is always followed by a translated
 * word (accessibility.md — never colour-alone).
 *
 * The prop shape is permissive on purpose. `Freshness` is one interface with
 * four populated variants — weather stamps `fetchedAt`/`ageHours`/
 * `staleWarning`, weather's pending branch stamps almost nothing, market stamps
 * `latestDate`/`ageDays` — and a component that demanded a full object would
 * make every caller construct fields the endpoint never sends.
 */
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { FreshnessStatus } from '@shared/types/api';

import { colors, spacing } from '../../theme';
import { Text } from './Text';

const DOT_COLOR: Record<FreshnessStatus, string> = {
  live: colors.freshLive,
  cached: colors.freshCached,
  historical: colors.freshHistorical,
  pending: colors.freshPending,
};

/** Beyond this a cached snapshot gets an explicit warning (WEATHER_STALE_WARNING_MS). */
const STALE_WARNING_HOURS = 48;

export interface FreshnessDotProps {
  status: FreshnessStatus;
  /** Weather. */
  fetchedAt?: string | null;
  ageHours?: number | null;
  staleWarning?: boolean | null;
  /** Market — the newest price held, which answers the same "how old is this?". */
  latestDate?: string | null;
  /** Hides the word, leaving the dot. Only for dense rows that repeat a label. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

interface RelativeAge {
  key: string;
  count: number;
}

/**
 * Local rather than shared with the web's `lib/format`: this is the only place
 * in the mobile app that needs it, and the alternative is a lib module that
 * another surface would have to keep in step for one function.
 */
function relativeAge(value: string | null | undefined, now = Date.now()): RelativeAge | null {
  if (!value) return null;

  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;

  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return { key: 'time.justNow', count: 0 };
  if (minutes < 60) return { key: 'time.minutesAgo', count: minutes };

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: 'time.hoursAgo', count: hours };

  return { key: 'time.daysAgo', count: Math.floor(hours / 24) };
}

export function FreshnessDot({
  status,
  fetchedAt,
  ageHours,
  staleWarning,
  latestDate,
  compact = false,
  style,
  testID,
}: FreshnessDotProps) {
  const { t } = useTranslation('common');

  const tint = DOT_COLOR[status];
  if (!tint) return null;

  const age = relativeAge(fetchedAt ?? latestDate);
  const ageText = age ? t(age.key, { count: age.count }) : null;

  const label =
    status === 'cached' && ageText
      ? t('freshness.cachedAge', { age: ageText })
      : t(`freshness.${status}`);

  /*
   * The server's own verdict wins where it gives one: `staleWarning` is
   * computed against `WEATHER_STALE_WARNING_MS`, and a client that decided
   * staleness independently would eventually disagree with it. The local
   * calculation is the fallback for responses that carry no such flag.
   */
  const hoursOld =
    ageHours ?? (fetchedAt ? (Date.now() - new Date(fetchedAt).getTime()) / 3_600_000 : null);

  const isStale =
    staleWarning ?? (status === 'cached' && hoursOld !== null && hoursOld > STALE_WARNING_HOURS);

  /*
   * The dot carries no meaning of its own, so the whole control is announced as
   * one string instead of "bullet, cached, two hours ago" in three stops.
   */
  const spoken = isStale ? `${label}. ${t('freshness.staleWarning')}` : label;

  return (
    <View style={[styles.row, style]} accessible accessibilityLabel={spoken} testID={testID}>
      <View style={[styles.dot, { backgroundColor: tint }]} />
      {compact ? null : (
        <Text variant="caption" style={{ color: tint }}>
          {label}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
