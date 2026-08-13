/**
 * Mandi modal price over time, drawn with `react-native-svg`.
 *
 * A sparkline rather than a full chart, deliberately. This is the *evidence*
 * under a sentence that has already given the answer ("prices are up 4% this
 * week"), on a screen the width of a hand — a gridded, axis-labelled chart
 * would take the whole viewport to say what a shape says at a glance. The
 * numbers a farmer would read off an axis are printed underneath instead, where
 * they are legible in sunlight.
 *
 * **One series.** Min and max are not plotted as extra lines: on a day with
 * several mandis reporting they cross the modal line in ways that read as three
 * commodities rather than one commodity's spread. The mandi table below carries
 * the per-mandi spread, which is where a farmer comparing two mandis looks.
 *
 * Days with several reports are **averaged** into one point so the line is one
 * value per day rather than a sawtooth of mandi-by-mandi noise. That averaging
 * is stated in the caption, not hidden.
 *
 * The whole figure is one accessibility node carrying a spoken summary: a
 * screen reader cannot trace a path, and reading out ninety coordinates would
 * be worse than silence.
 */
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Svg, { Circle, Path } from 'react-native-svg';

import { formatDayMonth, formatNumber } from '@shared/client/format';
import type { MarketPricePoint } from '@shared/types/api';

import { useLanguage } from '../../store/LanguageContext';
import { colors, radius, spacing } from '../../theme';
import { EmptyState } from '../ui/states';
import { Text } from '../ui/Text';

const CHART_HEIGHT = 96;
/** Keeps the stroke and the end marker inside the viewport. */
const PADDING = 6;

export interface PriceSparklineProps {
  series: MarketPricePoint[];
  /** The window the series was requested for — used only for the caption. */
  days: number;
  testID?: string;
}

interface DayPoint {
  date: string;
  modalPrice: number;
}

export function PriceSparkline({ series, days, testID }: PriceSparklineProps) {
  const { t } = useTranslation(['market', 'common', 'mobile']);
  const { language } = useLanguage();

  const [width, setWidth] = useState(0);
  const points = useMemo(() => byDay(series), [series]);

  if (points.length === 0) {
    return <EmptyState title={t('market:emptySeries')} />;
  }

  const values = points.map((point) => point.modalPrice);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const first = points[0]!;
  const last = points[points.length - 1]!;

  const asPrice = (value: number) =>
    t('common:unit.rupeesPerQuintal', {
      value: formatNumber(value, language, { maximumFractionDigits: 0 }),
    });

  /*
   * A single observation has no shape to draw. Saying so beats drawing a flat
   * line, which would look like a measured trend.
   */
  const drawable = points.length > 1 && width > 0;

  const summary = [
    t('market:chartTitle', { days }),
    t('market:latestPrice'),
    asPrice(last.modalPrice),
    t('market:minColumn'),
    asPrice(min),
    t('market:maxColumn'),
    asPrice(max),
  ].join('. ');

  return (
    <View style={styles.frame} testID={testID ?? 'price-sparkline'}>
      <Text variant="bodyStrong" accessibilityRole="header">
        {t('market:chartTitle', { days })}
      </Text>
      <Text variant="caption" color="ink500">
        {t('market:priceAxis')}
      </Text>

      <View
        style={styles.plot}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        accessible
        accessibilityLabel={summary}
      >
        {drawable ? (
          <Svg width={width} height={CHART_HEIGHT}>
            <Path d={areaPath(points, width, min, max)} fill={colors.brand50} stroke="none" />
            <Path
              d={linePath(points, width, min, max)}
              stroke={colors.brand600}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            <Circle
              cx={x(points.length - 1, points.length, width)}
              cy={y(last.modalPrice, min, max)}
              r={4}
              fill={colors.brand600}
              stroke={colors.surface}
              strokeWidth={2}
            />
          </Svg>
        ) : null}
      </View>

      <View style={styles.axis}>
        <Text variant="caption" color="ink500">
          {formatDayMonth(first.date, language)}
        </Text>
        <Text variant="caption" color="ink500">
          {formatDayMonth(last.date, language)}
        </Text>
      </View>

      <View style={styles.readout}>
        <Readout label={t('market:latestPrice')} value={asPrice(last.modalPrice)} />
        <Readout label={t('market:minColumn')} value={asPrice(min)} />
        <Readout label={t('market:maxColumn')} value={asPrice(max)} />
      </View>

      <Text variant="caption" color="ink500">
        {t('mobile:market.dailyAverageNote')}
      </Text>
    </View>
  );
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.readoutCell}>
      <Text variant="caption" color="ink500">
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}

/** Averages the day's reports into one point and orders them oldest first. */
function byDay(series: MarketPricePoint[]): DayPoint[] {
  const buckets = new Map<string, { total: number; count: number }>();

  for (const row of series) {
    const bucket = buckets.get(row.date) ?? { total: 0, count: 0 };
    bucket.total += row.modalPrice;
    bucket.count += 1;
    buckets.set(row.date, bucket);
  }

  return [...buckets.entries()]
    .map(([date, bucket]) => ({ date, modalPrice: bucket.total / bucket.count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

const x = (index: number, count: number, width: number): number =>
  PADDING + (index / (count - 1)) * Math.max(width - PADDING * 2, 1);

/**
 * A flat series would divide by zero on the range, so it is pinned to the
 * middle of the band — a straight line through the centre, which is what a
 * price that did not move actually looks like.
 */
const y = (value: number, min: number, max: number): number => {
  const span = max - min;
  const usable = CHART_HEIGHT - PADDING * 2;
  if (span === 0) return PADDING + usable / 2;
  return PADDING + (1 - (value - min) / span) * usable;
};

function linePath(points: DayPoint[], width: number, min: number, max: number): string {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'}${x(index, points.length, width).toFixed(2)} ${y(point.modalPrice, min, max).toFixed(2)}`,
    )
    .join(' ');
}

function areaPath(points: DayPoint[], width: number, min: number, max: number): string {
  const base = CHART_HEIGHT - PADDING;
  const start = x(0, points.length, width).toFixed(2);
  const end = x(points.length - 1, points.length, width).toFixed(2);
  return `${linePath(points, width, min, max)} L${end} ${base} L${start} ${base} Z`;
}

const styles = StyleSheet.create({
  frame: {
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.lg,
  },
  plot: { height: CHART_HEIGHT, marginTop: spacing.sm },
  axis: { flexDirection: 'row', justifyContent: 'space-between' },
  readout: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  readoutCell: { gap: 2, minWidth: 96 },
});
