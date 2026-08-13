import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';

import type { WeatherDay } from '@/api/types';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatDayMonth, formatNumber } from '@/lib/format';
import { ChartFrame, ChartTooltip } from './ChartFrame';
import { AXIS_PROPS, CHART } from './theme';

/**
 * Temperature and rainfall are **two charts, not one**.
 *
 * °C and mm have unrelated scales, and putting them on one plot would need a
 * second y-axis — the single most misleading thing a chart can do, because the
 * crossing point of the two series is then an artefact of where the axes were
 * placed rather than a fact about the weather. Two stacked charts sharing an
 * x-axis read the same and lie about nothing.
 */
export function TemperatureChart({ daily }: { daily: WeatherDay[] }) {
  const { t } = useTranslation(['weather', 'market', 'common']);
  const { language } = useLanguage();

  const points = useMemo(
    () => daily.filter((day) => day.tMinC != null || day.tMaxC != null),
    [daily],
  );

  const table = useMemo(
    () => ({
      columns: [t('market:dateColumn'), t('weather:tempMin'), t('weather:tempMax')],
      rows: points.map((day) => [
        formatDayMonth(day.date, language),
        formatNumber(day.tMinC, language, { maximumFractionDigits: 0 }),
        formatNumber(day.tMaxC, language, { maximumFractionDigits: 0 }),
      ]) as (string | number)[][],
    }),
    [points, language, t],
  );

  return (
    <ChartFrame
      title={t('weather:temperature')}
      subtitle={t('common:unit.celsius')}
      legend={[
        { label: t('weather:tempMax'), color: CHART.series2 },
        { label: t('weather:tempMin'), color: CHART.series1 },
      ]}
      table={table}
      isEmpty={points.length === 0}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={CHART.grid} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="date"
            {...AXIS_PROPS}
            tickFormatter={(value: string) => formatDayMonth(value, language)}
            minTickGap={16}
          />
          <YAxis {...AXIS_PROPS} width={40} />
          <Tooltip
            cursor={{ stroke: CHART.grid, strokeWidth: 1 }}
            content={(props: TooltipContentProps) => (
              <ChartTooltip
                active={props.active}
                label={props.label ? formatDayMonth(String(props.label), language) : undefined}
                rows={(props.payload ?? []).map((entry) => ({
                  name:
                    String(entry.dataKey) === 'tMaxC' ? t('weather:tempMax') : t('weather:tempMin'),
                  value: `${formatNumber(Number(entry.value), language, { maximumFractionDigits: 0 })} ${t('common:unit.celsius')}`,
                  color: String(entry.dataKey) === 'tMaxC' ? CHART.series2 : CHART.series1,
                }))}
              />
            )}
          />
          <Line
            type="monotone"
            dataKey="tMaxC"
            stroke={CHART.series2}
            strokeWidth={CHART.lineWidth}
            strokeLinecap="round"
            dot={false}
            activeDot={{ r: CHART.markerRadius + 1, stroke: CHART.surface, strokeWidth: 2 }}
            isAnimationActive={false}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="tMinC"
            stroke={CHART.series1}
            strokeWidth={CHART.lineWidth}
            strokeLinecap="round"
            dot={false}
            activeDot={{ r: CHART.markerRadius + 1, stroke: CHART.surface, strokeWidth: 2 }}
            isAnimationActive={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function RainfallChart({ daily }: { daily: WeatherDay[] }) {
  const { t } = useTranslation(['weather', 'market', 'common']);
  const { language } = useLanguage();

  const points = useMemo(() => daily.filter((day) => day.rainMm != null), [daily]);

  const table = useMemo(
    () => ({
      columns: [t('market:dateColumn'), `${t('weather:rain')} (${t('common:unit.mm')})`],
      rows: points.map((day) => [
        formatDayMonth(day.date, language),
        formatNumber(day.rainMm, language, { maximumFractionDigits: 1 }),
      ]) as (string | number)[][],
    }),
    [points, language, t],
  );

  return (
    <ChartFrame
      title={t('weather:rain')}
      subtitle={t('common:unit.mm')}
      table={table}
      isEmpty={points.length === 0}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={CHART.grid} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="date"
            {...AXIS_PROPS}
            tickFormatter={(value: string) => formatDayMonth(value, language)}
            minTickGap={16}
          />
          <YAxis {...AXIS_PROPS} width={40} />
          <Tooltip
            cursor={{ fill: CHART.grid, fillOpacity: 0.3 }}
            content={(props: TooltipContentProps) => (
              <ChartTooltip
                active={props.active}
                label={props.label ? formatDayMonth(String(props.label), language) : undefined}
                rows={(props.payload ?? []).map((entry) => ({
                  name: t('weather:rain'),
                  value: `${formatNumber(Number(entry.value), language, { maximumFractionDigits: 1 })} ${t('common:unit.mm')}`,
                  color: CHART.series1,
                }))}
              />
            )}
          />
          {/* Capped rather than filling the band; 4px rounded top, square at the baseline. */}
          <Bar
            dataKey="rainMm"
            fill={CHART.series1}
            maxBarSize={CHART.maxBarSize}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
