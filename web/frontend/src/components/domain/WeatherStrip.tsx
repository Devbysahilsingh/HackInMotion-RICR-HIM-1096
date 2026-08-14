import { useTranslation } from 'react-i18next';

import type { WeatherDay, WeatherRisk } from '@/api/types';
import { useLanguage } from '@/i18n/LanguageContext';
import { translateMessageKey } from '@/i18n/messageKey';
import { formatDayMonth, formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { IconCloud, IconDroplet } from '@/components/ui/icons';
import { WhyTrace } from './WhyTrace';

/**
 * The seven-day strip.
 *
 * Only forecast days are shown — the snapshot also carries the past week,
 * which the irrigation ledger needs but a farmer looking at "what is coming"
 * does not. Missing values render as an em dash rather than a zero: a provider
 * that did not report humidity has not reported 0% humidity.
 */
export function ForecastStrip({ daily }: { daily: WeatherDay[] }) {
  const { t } = useTranslation(['weather', 'common']);
  const { language } = useLanguage();

  const today = startOfDay(new Date());
  const forecast = daily.filter((day) => startOfDay(new Date(day.date)) >= today).slice(0, 7);

  if (forecast.length === 0) return null;

  return (
    /*
     * The design's `.fc7`: seven equal columns that fill the width, collapsing
     * to a horizontal scroll of narrow columns on a phone rather than shrinking
     * each day until the temperature wraps. The week is meant to be read as one
     * shape — which day the rain lands on — and a row of equal columns is what
     * makes that shape legible.
     */
    <ul
      className="grid auto-cols-[minmax(4.25rem,1fr)] grid-flow-col gap-2 overflow-x-auto pb-1 md:grid-flow-row md:grid-cols-7 md:gap-3 md:overflow-visible"
      data-testid="forecast-strip"
    >
      {forecast.map((day, index) => {
        // "Rain likely" is the one thing this strip has to make obvious. The
        // threshold only tints a label — the percentage is always printed, so
        // the colour is a second signal and never the only one.
        const rainLikely = day.rainProbPct != null && day.rainProbPct >= 60;

        return (
          <li key={day.date}>
            <Card
              className={cn('h-full px-2.5 py-3 text-center', rainLikely && 'border-info-500/40')}
            >
              <p className={cn('kicker', rainLikely && 'text-info-500')}>
                {index === 0 ? t('weather:today') : formatDayMonth(day.date, language)}
              </p>
              <p className="mt-1.5 text-sm font-semibold">
                {day.tMaxC != null && day.tMinC != null
                  ? t('weather:tempRange', {
                      min: formatNumber(day.tMinC, language, { maximumFractionDigits: 0 }),
                      max: formatNumber(day.tMaxC, language, { maximumFractionDigits: 0 }),
                    })
                  : '—'}
              </p>
              <p className="mt-1.5 flex items-center justify-center gap-1 text-xs text-ink-500">
                <IconDroplet size={13} aria-hidden="true" />
                {day.rainMm != null
                  ? `${formatNumber(day.rainMm, language, { maximumFractionDigits: 1 })} ${t('common:unit.mm')}`
                  : '—'}
              </p>
              <p
                className={cn(
                  'text-xs',
                  rainLikely ? 'font-semibold text-info-500' : 'text-ink-500',
                )}
              >
                {day.rainProbPct != null
                  ? `${formatNumber(day.rainProbPct, language, { maximumFractionDigits: 0 })}%`
                  : '—'}
              </p>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

const RISK_TONE = {
  CRITICAL: 'border-priority-critical/40 bg-priority-critical-soft',
  HIGH: 'border-priority-high/40 bg-priority-high-soft',
  MEDIUM: 'border-priority-medium/40 bg-priority-medium-soft',
  LOW: 'border-line bg-surface',
} as const;

/**
 * A crop-scoped weather risk.
 *
 * Title and body come from `weather.title{TYPE}` / `weather.body{TYPE}` with
 * the risk's own `data` as parameters, so the numbers in the sentence are the
 * numbers the engine actually compared against a threshold. `thresholdSource`
 * is surfaced when the threshold was a generic default rather than a
 * crop-specific published value — the difference matters, and hiding it would
 * imply a precision the registry does not have.
 */
export function RiskCard({ risk }: { risk: WeatherRisk }) {
  const { t } = useTranslation(['weather', 'agri', 'common']);

  const title = translateMessageKey(t, `weather.title${risk.type}`, risk.data);
  const body = translateMessageKey(t, `weather.body${risk.type}`, risk.data);

  return (
    <Card
      data-testid="risk-card"
      data-risk-type={risk.type}
      data-risk-level={risk.level}
      className={cn('border', RISK_TONE[risk.level])}
    >
      <div className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <IconCloud size={18} aria-hidden="true" />
          <h3 className="text-sm font-semibold">{title}</h3>
          <Badge tone={risk.level === 'LOW' ? 'neutral' : 'warning'}>
            {t(`agri:risk.${risk.level}`)}
          </Badge>
          <span className="text-xs text-ink-500">
            {risk.daysAhead === 0
              ? t('weather:today')
              : t('weather:daysAhead', { days: risk.daysAhead })}
          </span>
        </div>

        <p className="text-sm text-ink-700">{body}</p>

        {risk.thresholdSource === 'default' && (
          <p className="text-xs text-ink-500">{t('weather:thresholdDefault')}</p>
        )}

        <p className="text-xs text-ink-500">{risk.cropCode}</p>
      </div>
    </Card>
  );
}

/** Groups the flat risk list by crop so a farm with four crops reads clearly. */
export function RiskList({ risks }: { risks: WeatherRisk[] }) {
  if (risks.length === 0) return null;

  return (
    <div className="space-y-3" data-testid="risk-list">
      {risks.map((risk, index) => (
        <RiskCard key={`${risk.cropId}-${risk.type}-${index}`} risk={risk} />
      ))}
    </div>
  );
}

export function WeatherTrace({ risks }: { risks: WeatherRisk[] }) {
  // The risk objects carry their numbers in `data`; the engine's full trace is
  // not part of the farm-weather response, so what is shown is what exists.
  const steps = risks.map((risk) => ({ step: risk.type, level: risk.level, ...risk.data }));
  return <WhyTrace trace={steps} />;
}

const startOfDay = (date: Date): Date => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};
