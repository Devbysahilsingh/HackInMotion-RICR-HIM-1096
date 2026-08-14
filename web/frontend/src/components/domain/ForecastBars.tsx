import { useTranslation } from 'react-i18next';

import type { WeatherDay, WeatherRisk } from '@/api/types';
import { useLanguage } from '@/i18n/LanguageContext';
import { formatDate, formatNumber } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * Rain likely, at the same threshold `ForecastStrip` already used. Kept as one
 * number rather than two so the strip and this chart cannot disagree about
 * which day is the wet one.
 */
const RAIN_LIKELY_PCT = 60;

/** Shortest bar drawn, as a percentage of the plot. */
const MIN_BAR_PCT = 32;

export type ForecastTone = 'rain' | 'risk' | 'mild';

/**
 * The seven-day forecast, as a row of coloured bars.
 *
 * ## What the height means
 *
 * Temperature, scaled between the week's own coolest and hottest day. It is a
 * relative shape — "which day is the hot one" — not an absolute reading, which
 * is why every bar still prints its own figure underneath: the chart is the
 * scan, the numbers are the answer.
 *
 * A week with no spread (every day the same maximum) draws every bar at the
 * same height rather than dividing by zero into a row of minimums.
 *
 * ## What the colour means, and why it is not a threshold
 *
 * Three categories, each decided by something the system genuinely knows:
 *
 *   - **risk** — the weather-risk engine flagged this day for one of the farm's
 *     crops. The thresholds behind that are the registry's published crop
 *     sensitivities (or a stated default), assessed server-side. Nothing here
 *     invents "hot": a day is red because an engine said so.
 *   - **rain** — the provider forecast rainfall, or a probability at or above
 *     the same 60% the rest of the app calls "likely".
 *   - **mild** — everything else.
 *
 * Colour is a second signal only: the temperature and the rainfall are printed
 * on every bar, and the list carries a per-day accessible label.
 */
export function ForecastBars({
  daily,
  risks = [],
}: {
  daily: WeatherDay[];
  /** Farm risks, used only to decide which days are flagged. */
  risks?: WeatherRisk[];
}) {
  const { t } = useTranslation(['weather', 'common', 'agri']);
  const { language } = useLanguage();

  const today = startOfDay(new Date());
  const forecast = daily.filter((day) => startOfDay(new Date(day.date)) >= today).slice(0, 7);

  if (forecast.length === 0) return null;

  /*
   * Risks are matched on the calendar day, not on `daysAhead`: the engine
   * computed that offset against its own `asOf`, and a page open across
   * midnight would shift every bar by one.
   */
  const flaggedDays = new Set(
    risks.filter((risk) => risk.date).map((risk) => risk.date!.slice(0, 10)),
  );

  const maxima = forecast.map((day) => day.tMaxC).filter((value): value is number => value != null);
  const coolest = maxima.length > 0 ? Math.min(...maxima) : 0;
  const hottest = maxima.length > 0 ? Math.max(...maxima) : 0;
  const spread = hottest - coolest;

  return (
    <ul
      className="grid auto-cols-[minmax(3.5rem,1fr)] grid-flow-col gap-2 overflow-x-auto pb-1 sm:gap-3 md:grid-flow-row md:grid-cols-7 md:overflow-visible"
      data-testid="forecast-bars"
    >
      {forecast.map((day, index) => {
        const tone = toneFor(day, flaggedDays);
        const height =
          day.tMaxC == null || spread <= 0
            ? MIN_BAR_PCT + (100 - MIN_BAR_PCT) / 2
            : MIN_BAR_PCT + ((day.tMaxC - coolest) / spread) * (100 - MIN_BAR_PCT);

        const dayLabel =
          index === 0 ? t('weather:today') : formatDate(day.date, language, { weekday: 'short' });

        const temperature =
          day.tMaxC != null
            ? `${formatNumber(day.tMaxC, language, { maximumFractionDigits: 0 })}°`
            : EM_DASH;
        const rainfall =
          day.rainMm != null
            ? `${formatNumber(day.rainMm, language, { maximumFractionDigits: day.rainMm < 10 ? 1 : 0 })} ${t('common:unit.mm')}`
            : EM_DASH;

        return (
          <li key={day.date} className="flex flex-col items-center gap-2">
            <p className="kicker">{dayLabel}</p>

            {/*
              A fixed-height plot with the bar bottom-anchored inside it, so the
              seven bars share one baseline and the row reads as a chart. The
              plot itself is the accessible element — it carries the day's whole
              reading, so a screen reader gets "Friday, 26 degrees, 19 mm" in
              one utterance instead of three orphaned fragments.
            */}
            <div
              className="flex h-[7.5rem] w-full items-end"
              role="img"
              aria-label={`${dayLabel}: ${temperature}, ${rainfall}`}
            >
              <div
                className={cn('w-full rounded-lg', TONE_CLASS[tone])}
                style={{ height: `${height}%` }}
              />
            </div>

            <p className="text-sm font-semibold tabular-nums">{temperature}</p>
            <p
              className={cn(
                '-mt-1.5 text-xs font-medium tabular-nums',
                tone === 'rain'
                  ? 'text-info-500'
                  : tone === 'risk'
                    ? 'text-danger-600'
                    : 'text-harvest-700',
              )}
            >
              {rainfall}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

const TONE_CLASS: Record<ForecastTone, string> = {
  rain: 'wxbar-rain',
  risk: 'wxbar-risk',
  mild: 'wxbar-mild',
};

const EM_DASH = '—';

function toneFor(day: WeatherDay, flaggedDays: ReadonlySet<string>): ForecastTone {
  if (flaggedDays.has(day.date.slice(0, 10))) return 'risk';
  if ((day.rainMm ?? 0) > 0) return 'rain';
  if ((day.rainProbPct ?? 0) >= RAIN_LIKELY_PCT) return 'rain';
  return 'mild';
}

const startOfDay = (date: Date): Date => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};
