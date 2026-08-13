import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';

import type { MarketPricePoint } from '@/api/types';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatDayMonth, formatNumber } from '@/lib/format';
import { ChartFrame, ChartTooltip } from './ChartFrame';
import { AXIS_PROPS, CHART } from './theme';

/**
 * Mandi modal price over time.
 *
 * **One series, one axis.** Min and max are not plotted as extra lines: on a
 * day with several mandis reporting they would cross the modal line in ways
 * that read as three commodities rather than one commodity's spread. They are
 * in the table view and the mandi table instead, which is where a farmer
 * comparing two mandis actually looks.
 *
 * Days with several reports are averaged into one point, so the x-axis is one
 * value per day rather than a sawtooth of mandi-by-mandi noise. The averaging
 * is stated in the caption, not hidden.
 */
export function PriceTrendChart({ series, days }: { series: MarketPricePoint[]; days: number }) {
  const { t } = useTranslation(['market', 'common']);
  const { language } = useLanguage();

  const points = useMemo(() => byDay(series), [series]);

  const table = useMemo(
    () => ({
      columns: [t('market:dateColumn'), t('market:modalColumn')],
      rows: points.map((point) => [
        formatDayMonth(point.date, language),
        formatNumber(point.modalPrice, language, { maximumFractionDigits: 0 }),
      ]) as (string | number)[][],
    }),
    [points, language, t],
  );

  return (
    <ChartFrame
      title={t('market:chartTitle', { days })}
      subtitle={t('market:priceAxis')}
      table={table}
      isEmpty={points.length === 0}
      emptyMessage={t('market:emptySeries')}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          {/* Hairline, solid, recessive — horizontal only; vertical rules add ink without adding read. */}
          <CartesianGrid stroke={CHART.grid} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="date"
            {...AXIS_PROPS}
            tickFormatter={(value: string) => formatDayMonth(value, language)}
            minTickGap={24}
          />
          <YAxis
            {...AXIS_PROPS}
            width={56}
            tickFormatter={(value: number) =>
              formatNumber(value, language, { maximumFractionDigits: 0 })
            }
          />
          <Tooltip
            cursor={{ stroke: CHART.grid, strokeWidth: 1 }}
            content={(props: TooltipContentProps) => (
              <ChartTooltip
                active={props.active}
                label={props.label ? formatDayMonth(String(props.label), language) : undefined}
                rows={(props.payload ?? []).map((entry) => ({
                  name: t('market:modalColumn'),
                  value: t('common:unit.rupeesPerQuintal', {
                    value: formatNumber(Number(entry.value), language, {
                      maximumFractionDigits: 0,
                    }),
                  }),
                  color: CHART.series1,
                }))}
              />
            )}
          />
          <Line
            type="monotone"
            dataKey="modalPrice"
            stroke={CHART.series1}
            strokeWidth={CHART.lineWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            // No dot per point: a 90-day series would be a bead necklace. The
            // active dot carries a 2px surface ring so it stays legible where
            // it crosses the line.
            dot={false}
            activeDot={{
              r: CHART.markerRadius + 1,
              fill: CHART.series1,
              stroke: CHART.surface,
              strokeWidth: 2,
            }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

interface DayPoint {
  date: string;
  modalPrice: number;
}

/** Collapses several mandi reports on one day into that day's mean modal price. */
function byDay(series: MarketPricePoint[]): DayPoint[] {
  const buckets = new Map<string, { total: number; count: number }>();

  for (const point of series) {
    const day = String(point.date).slice(0, 10);
    const bucket = buckets.get(day) ?? { total: 0, count: 0 };
    bucket.total += point.modalPrice;
    bucket.count += 1;
    buckets.set(day, bucket);
  }

  return [...buckets.entries()]
    .map(([date, bucket]) => ({ date, modalPrice: Math.round(bucket.total / bucket.count) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
