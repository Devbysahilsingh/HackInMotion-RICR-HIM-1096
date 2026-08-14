import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import { cropsApi, dashboardApi, farmsApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import type { CropCard, Farm, FarmWeather, WeatherDay, WeatherRisk } from '@/api/types';
import { useActiveFarm } from '@/farm/ActiveFarmContext';
import { QueryBoundary } from '@/components/QueryBoundary';
import { DecisionBanner } from '@/components/domain/DecisionBanner';
import { ForecastBars } from '@/components/domain/ForecastBars';
import { IrrigationWorking } from '@/components/domain/IrrigationWorking';
import { PageHeader } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/Badge';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { FreshnessDot } from '@/components/ui/FreshnessDot';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { IconCloud } from '@/components/ui/icons';
import { useCropNames } from '@/hooks/useCropNames';
import { useLanguage } from '@/i18n/LanguageContext';
import { translateMessageKey } from '@/i18n/messageKey';
import { cn } from '@/lib/cn';
import { feedForFarm } from '@/lib/feedScope';
import { byUrgency } from '@/lib/irrigationUrgency';
import { formatDate, formatNumber, relativeAge } from '@/lib/format';

/**
 * Weather for one field, ending in a decision.
 *
 * The design's premise is that a farmer opens this screen to decide something,
 * not to read a forecast: the sky is the evidence, and the answer sits beside
 * it at the same weight. So the page is ordered *now → what to do → the week →
 * which crop is at risk → why*, and the reasoning is on the page rather than
 * behind a "why this?" disclosure, because a reason nobody opens is a reason
 * nobody has.
 *
 * Every figure comes from an endpoint that already existed:
 * `GET /farms/:id/weather` for the snapshot and the engine's crop risks,
 * `/dashboard` for the ranked decision, and `GET /crops/:id/irrigation` for the
 * working behind it. Nothing is fetched from a provider on this path — the
 * snapshot was ingested by the scheduler (rule 3).
 */
export default function WeatherPage() {
  const { t } = useTranslation(['weather', 'common', 'farm']);
  const { farmId = '' } = useParams();
  const { activeFarmId, setActiveFarmId } = useActiveFarm();

  const query = useQuery({
    queryKey: queryKeys.farms.weather(farmId),
    queryFn: () => farmsApi.weather(farmId),
    enabled: Boolean(farmId),
    staleTime: STALE_TIME.slowMoving,
  });

  const farmsQuery = useQuery({
    queryKey: queryKeys.farms.list(),
    queryFn: farmsApi.list,
    staleTime: STALE_TIME.slowMoving,
  });
  const farm = farmsQuery.data?.farms.find((entry) => entry.id === farmId) ?? null;

  /*
   * The URL is the authority for which field this is, and the sidebar follows
   * it. Without this, switching to farm B and then navigating here by any
   * route that carries farm A's id would leave the switcher naming B over A's
   * sky. Selection is a UI preference only — the request is ownership-checked
   * server-side from the token, never from this id.
   */
  useEffect(() => {
    if (farmId && farmId !== activeFarmId) setActiveFarmId(farmId);
  }, [farmId, activeFarmId, setActiveFarmId]);

  return (
    <>
      <PageHeader
        title={t('weather:pageTitle')}
        description={
          farm
            ? [farm.name, farm.location.district, farm.location.state].filter(Boolean).join(' · ')
            : undefined
        }
      />

      <QueryBoundary query={query} loading={<SkeletonCard />}>
        {(weather) =>
          /*
            A location with no snapshot yet is a designed 200, not an error —
            the request path never calls a provider, so "we have not fetched
            this cell yet" is a real and temporary state with its own copy. It
            gets a compact card rather than a full-width empty panel.
          */
          weather.daily.length === 0 ? (
            <WeatherUnavailable weather={weather} onRefresh={() => void query.refetch()} />
          ) : (
            <WeatherContent farmId={farmId} farm={farm} weather={weather} />
          )
        }
      </QueryBoundary>
    </>
  );
}

function WeatherContent({
  farmId,
  farm,
  weather,
}: {
  farmId: string;
  farm: Farm | null;
  weather: FarmWeather;
}) {
  const { t } = useTranslation(['weather', 'common', 'irrigation']);

  const today = todayRow(weather.daily);

  return (
    <div className="space-y-5">
      {/*
        The design's split: the sky on the wide side, the decision on the
        narrow one, both at full height so neither reads as a footnote to the
        other. It collapses to one column below 1240px.
      */}
      <div className="grid items-stretch gap-5 xl:grid-cols-[1.55fr_1fr]">
        <CurrentConditions farm={farm} weather={weather} today={today} />
        <FarmDecision farmId={farmId} />
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="kicker">{t('weather:forecastHeading')}</h2>
          {weather.freshness.source && (
            <span className="text-xs text-ink-500">
              {t('weather:sourceCaption', { source: weather.freshness.source })}
            </span>
          )}
        </div>

        <div className="mt-4">
          <ForecastBars daily={weather.daily} risks={weather.risks} />
        </div>
      </Card>

      <WeekAtAGlance daily={weather.daily} />

      {/*
        Two columns that end at the same line. `items-stretch` (the grid
        default) plus `h-full` on each card is what does it: without both, a
        farm with one risk left a short card beside a seven-row table and the
        row read as broken rather than as two panels.
      */}
      <div className="grid items-stretch gap-5 xl:grid-cols-2">
        <CropRisks risks={weather.risks} />
        <IrrigationReasoning farmId={farmId} et0Mm={today?.et0Mm ?? null} />
      </div>
    </div>
  );
}

/**
 * The week in four figures.
 *
 * Each one is arithmetic over the forecast rows the provider already sent —
 * a sum, a maximum, the day a maximum falls on. Nothing is modelled and nothing
 * is predicted: these are restatements of the same numbers the bars above draw,
 * which is what makes them safe to set large.
 *
 * The row also does real layout work. A field with one crop and one risk left
 * the lower half of this page mostly empty; four equal tiles across the full
 * width give the page a spine and put the week's totals where a farmer looks
 * first.
 */
function WeekAtAGlance({ daily }: { daily: WeatherDay[] }) {
  const { t } = useTranslation(['weather', 'common']);
  const { language } = useLanguage();

  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const week = daily.filter((day) => new Date(day.date) >= midnight).slice(0, 7);
  if (week.length === 0) return null;

  const rainDays = week.filter((day) => day.rainMm != null);
  const totalRain = rainDays.reduce((sum, day) => sum + (day.rainMm ?? 0), 0);
  const wettest = rainDays.reduce<WeatherDay | null>(
    (best, day) => (best === null || (day.rainMm ?? 0) > (best.rainMm ?? 0) ? day : best),
    null,
  );

  const et0Days = week.filter((day) => day.et0Mm != null);
  const totalEt0 = et0Days.reduce((sum, day) => sum + (day.et0Mm ?? 0), 0);

  const warmest = week
    .filter((day) => day.tMaxC != null)
    .reduce<WeatherDay | null>(
      (best, day) => (best === null || (day.tMaxC ?? 0) > (best.tMaxC ?? 0) ? day : best),
      null,
    );

  const weekday = (date: string) => formatDate(date, language, { weekday: 'long' });
  const mm = (value: number) =>
    `${formatNumber(value, language, { maximumFractionDigits: value < 10 ? 1 : 0 })} ${t('common:unit.mm')}`;

  const tiles = [
    rainDays.length > 0
      ? { key: 'rain', label: t('weather:weekRainLabel'), value: mm(totalRain), hint: null }
      : null,
    wettest && (wettest.rainMm ?? 0) > 0
      ? {
          key: 'wettest',
          label: t('weather:wettestDayLabel'),
          value: weekday(wettest.date),
          hint: mm(wettest.rainMm ?? 0),
        }
      : null,
    warmest?.tMaxC != null
      ? {
          key: 'warmest',
          label: t('weather:warmestDayLabel'),
          value: `${formatNumber(warmest.tMaxC, language, { maximumFractionDigits: 0 })}°`,
          hint: weekday(warmest.date),
        }
      : null,
    et0Days.length > 0
      ? {
          key: 'et0',
          label: t('weather:weekEt0Label'),
          value: mm(totalEt0),
          hint: t('weather:et0'),
        }
      : null,
  ].filter((tile): tile is { key: string; label: string; value: string; hint: string | null } =>
    Boolean(tile),
  );

  if (tiles.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="weather-week-glance">
      {tiles.map((tile) => (
        <Card key={tile.key} className="h-full p-5">
          <p className="kicker">{tile.label}</p>
          <p className="mt-2.5 font-display text-[1.75rem] font-extrabold leading-none tracking-[-0.03em]">
            {tile.value}
          </p>
          {tile.hint && <p className="mt-1.5 text-sm text-ink-500">{tile.hint}</p>}
        </Card>
      ))}
    </div>
  );
}

/**
 * The current-conditions hero.
 *
 * The design's card carries a condition word ("Partly cloudy") and a
 * feels-like temperature. This system stores neither — `WeatherSnapshot` is a
 * daily series of min/max, humidity, wind, rain and ET₀ — so the slot carries
 * what the snapshot genuinely holds: today's high as the headline figure, the
 * high/low beneath it, and the rain outlook derived from the forecast rows
 * themselves. Inventing a condition string would be exactly the fabrication
 * rule 7 forbids.
 */
function CurrentConditions({
  farm,
  weather,
  today,
}: {
  farm: Farm | null;
  weather: FarmWeather;
  today: WeatherDay | null;
}) {
  const { t } = useTranslation(['weather', 'common']);
  const { language } = useLanguage();

  const age = relativeAge(weather.freshness.fetchedAt);
  const outlook = rainOutlook(weather.daily, language, t);

  const metrics = [
    {
      key: 'rain',
      label: t('weather:rain'),
      value: today?.rainProbPct,
      unit: '%',
      digits: 0,
    },
    {
      key: 'humidity',
      label: t('weather:humidity'),
      value: today?.humidityPct,
      unit: '%',
      digits: 0,
    },
    {
      key: 'wind',
      label: t('weather:wind'),
      value: today?.windKmh,
      unit: t('common:unit.kmh'),
      digits: 0,
    },
    {
      key: 'et0',
      label: t('weather:et0'),
      value: today?.et0Mm,
      unit: t('weather:et0PerDay'),
      digits: 1,
    },
  ];

  return (
    <section
      className="flex flex-col overflow-hidden rounded-card bg-info-500 text-white"
      data-testid="weather-now"
    >
      <div className="flex flex-1 flex-col p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.13em] text-white/70">
            {farm ? `${farm.name} · ` : ''}
            {t('weather:nowLabel')}
          </p>
          {age && (
            <span className="rounded-full bg-white/15 px-2.5 py-1 text-[0.719rem] font-semibold">
              {t('weather:updatedAgo', { age: t(`common:${age.key}`, { count: age.count }) })}
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-2">
          <p className="font-display text-[4rem] font-extrabold leading-[0.85] tracking-[-0.05em] sm:text-[4.75rem]">
            {today?.tMaxC != null
              ? `${formatNumber(today.tMaxC, language, { maximumFractionDigits: 0 })}°`
              : '—'}
          </p>
          <div className="pb-1.5">
            {outlook && <p className="text-lg font-semibold">{outlook}</p>}
            {today?.tMinC != null && today.tMaxC != null && (
              <p className="mt-1 text-sm text-white/80">
                {t('weather:highLow', {
                  max: formatNumber(today.tMaxC, language, { maximumFractionDigits: 0 }),
                  min: formatNumber(today.tMinC, language, { maximumFractionDigits: 0 }),
                })}
              </p>
            )}
          </div>
        </div>

        {/*
          The four figures a watering decision actually rests on. A metric the
          provider did not report renders an em dash rather than a zero — a
          missing humidity is not 0% humidity.
        */}
        <dl className="mt-auto grid grid-cols-2 gap-2.5 pt-6 sm:grid-cols-4">
          {metrics.map((metric) => (
            <div key={metric.key} className="rounded-control bg-white/[0.14] px-3.5 py-3">
              <dt className="text-[0.6875rem] font-semibold uppercase tracking-[0.13em] text-white/70">
                {metric.label}
              </dt>
              <dd className="mt-1.5 font-display text-[1.5rem] font-extrabold leading-none">
                {metric.value != null
                  ? formatNumber(metric.value, language, {
                      maximumFractionDigits: metric.digits,
                    })
                  : '—'}
                {metric.value != null && metric.unit === '%' && '%'}
              </dd>
              {metric.value != null && metric.unit !== '%' && (
                <dd className="mt-0.5 text-[0.719rem] text-white/70">{metric.unit}</dd>
              )}
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/**
 * Today's decision for this field, from the ranked feed.
 *
 * Not composed here: `/dashboard` returns the account's decisions already
 * ordered by the feed composer, and this takes the highest-ranked one that
 * belongs to this farm. When the engines have nothing urgent, the panel says so
 * and still offers the route to the irrigation plan, which is what the farmer
 * came to decide.
 */
function FarmDecision({ farmId }: { farmId: string }) {
  const { t } = useTranslation(['common', 'irrigation', 'weather']);

  const dashboardQuery = useQuery({
    queryKey: queryKeys.dashboard(),
    queryFn: dashboardApi.get,
    staleTime: STALE_TIME.dashboard,
  });

  if (dashboardQuery.isPending) return <SkeletonCard />;

  const cards = (dashboardQuery.data?.cropCards ?? []).filter((card) => card.farmId === farmId);
  const [lead] = feedForFarm(dashboardQuery.data?.feed ?? [], {
    farmId,
    cropIds: new Set(cards.map((card) => card.cropId)),
    cropCodes: new Set(cards.map((card) => card.cropCode)),
  });

  if (lead) {
    return (
      <DecisionBanner
        item={lead}
        actions={
          <ButtonLink to="/irrigation" variant="onDarkOutline">
            {t('irrigation:planTitle')}
          </ButtonLink>
        }
      />
    );
  }

  return (
    <section
      data-testid="weather-decision-neutral"
      className="furrow flex flex-col justify-center rounded-[18px] bg-brand-600 px-5 py-7 text-white sm:px-8"
    >
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.13em] text-leaf-tint/80">
        {t('common:decision.kicker')}
      </p>
      <h2 className="mt-3 max-w-[18ch] text-[1.75rem] leading-[1.06] text-white sm:text-[2.25rem]">
        {t('common:dashboard.todayNeutralTitle')}
      </h2>
      <p className="mt-3 max-w-[44ch] text-[0.9375rem] leading-relaxed text-white/85">
        {t('common:dashboard.todayNeutralBody')}
      </p>
      <div className="mt-5">
        <ButtonLink to="/irrigation" variant="onDark">
          {t('irrigation:planTitle')}
        </ButtonLink>
      </div>
    </section>
  );
}

/**
 * The crop-scoped risks the weather-risk engine flagged for this farm.
 *
 * Every threshold behind these is the registry's published crop sensitivity, or
 * a stated engine default — and when it is the default, the card says so
 * (`thresholdSource`). That distinction is the difference between "onion is
 * heat-stressed above this" and "we do not have onion's heat sensitivity, so we
 * used a generic band", and collapsing the two would be a fabricated threshold.
 */
function CropRisks({ risks }: { risks: WeatherRisk[] }) {
  const { t } = useTranslation(['weather', 'agri', 'common']);
  const { language } = useLanguage();
  const cropName = useCropNames();

  /*
   * One card holding every risk, rather than one card per risk.
   *
   * The per-risk card looked right in a mockup with three of them and wrong in
   * practice: a field with a single risk produced a short card beside a
   * seven-row table, and the two columns ended at wildly different lines. As
   * one panel with an accented row per risk, the column has a single height to
   * stretch and the row stays uniform however many the engine flags.
   */
  return (
    <Card className="flex h-full flex-col p-5" data-testid="weather-risks">
      <h2 className="kicker">{t('weather:risksHeading')}</h2>

      {risks.length === 0 ? (
        <p className="mt-3 text-base font-semibold" data-testid="weather-risks-none">
          {t('weather:noRisks')}
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {risks.slice(0, 3).map((risk, index) => {
            const stage = typeof risk.data.stage === 'string' ? risk.data.stage : null;
            const severe = risk.level === 'CRITICAL' || risk.level === 'HIGH';

            return (
              <li
                key={`${risk.cropId}-${risk.type}-${index}`}
                className={cn(
                  'rounded-control border border-l-4 border-line bg-canvas px-4 py-3.5',
                  severe ? 'border-l-danger-600' : 'border-l-harvest-500',
                )}
                data-testid="weather-risk-card"
                data-risk-type={risk.type}
                data-risk-level={risk.level}
              >
                <div className="flex flex-wrap items-center gap-2.5">
                  <Badge tone={severe ? 'danger' : 'warning'}>
                    {t('weather:riskOn', {
                      day:
                        risk.daysAhead === 0
                          ? t('weather:today')
                          : risk.date
                            ? formatDate(risk.date, language, { weekday: 'long' })
                            : t('weather:daysAhead', { days: risk.daysAhead }),
                    })}
                  </Badge>
                  <span className="kicker">
                    {cropName(risk.cropCode)}
                    {stage ? ` · ${t(`agri:stage.${stage}`)}` : ''}
                  </span>
                </div>

                <h3 className="mt-2.5 text-[1.125rem] leading-snug">
                  {translateMessageKey(t, `weather.title${risk.type}`, risk.data)}
                </h3>

                <p className="mt-1.5 text-sm leading-relaxed text-ink-700">
                  {translateMessageKey(t, `weather.body${risk.type}`, risk.data)}
                </p>

                {risk.thresholdSource === 'default' && (
                  <p className="mt-2 text-xs text-ink-500" data-testid="risk-threshold-default">
                    {t('weather:thresholdDefault')}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/**
 * Why the decision above says what it says, for the crop that needs water
 * soonest — the same crop the irrigation screen leads with, so the two screens
 * cannot give a farmer two different answers.
 */
function IrrigationReasoning({ farmId, et0Mm }: { farmId: string; et0Mm: number | null }) {
  const { t } = useTranslation(['irrigation', 'common']);

  const dashboardQuery = useQuery({
    queryKey: queryKeys.dashboard(),
    queryFn: dashboardApi.get,
    staleTime: STALE_TIME.dashboard,
  });

  const lead: CropCard | undefined = byUrgency(
    (dashboardQuery.data?.cropCards ?? []).filter((card) => card.farmId === farmId),
  )[0];

  const adviceQuery = useQuery({
    queryKey: queryKeys.crops.irrigation(lead?.cropId ?? ''),
    queryFn: () => cropsApi.irrigation(lead!.cropId),
    enabled: Boolean(lead),
    staleTime: STALE_TIME.slowMoving,
  });

  if (dashboardQuery.isPending || (lead && adviceQuery.isPending)) return <SkeletonCard />;

  if (!lead || !adviceQuery.data) {
    return (
      <Card className="p-5" data-testid="weather-why-unavailable">
        <h3 className="kicker">{t('irrigation:whyHeading')}</h3>
        <p className="mt-3 text-base font-semibold">{t('irrigation:noDecisionTitle')}</p>
        <p className="mt-1.5 text-sm text-ink-500">{t('irrigation:noDecisionBody')}</p>
      </Card>
    );
  }

  return <IrrigationWorking advice={adviceQuery.data} et0Mm={et0Mm} variant="compact" />;
}

/**
 * No snapshot for this cell yet — compact and actionable, never a blank panel.
 * `reason` separates "we have not fetched this location yet" from "this farm
 * has no coordinates, so it can never be fetched", because only one of those is
 * worth waiting for.
 */
function WeatherUnavailable({
  weather,
  onRefresh,
}: {
  weather: FarmWeather;
  onRefresh: () => void;
}) {
  const { t } = useTranslation(['weather', 'common']);

  return (
    <Card className="p-5" data-testid="weather-pending">
      <div className="flex items-center justify-between gap-2">
        <h2 className="kicker">{t('weather:pageTitle')}</h2>
        <IconCloud size={18} className="text-sky-700" aria-hidden="true" />
      </div>
      <p className="mt-3 text-[1.25rem] font-semibold">{t('weather:unavailableTitle')}</p>
      <p className="mt-1.5 max-w-prose text-sm text-ink-500">
        {weather.freshness.reason === 'no_coordinates'
          ? t('weather:pendingNoCoordinates')
          : t('weather:unavailableBody')}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={onRefresh}>
          {t('common:action.refresh')}
        </Button>
        <FreshnessDot freshness={weather.freshness} />
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <p className="kicker">{t('weather:forecastUnavailableTitle')}</p>
        <p className="mt-1.5 text-sm text-ink-500">{t('weather:forecastUnavailableBody')}</p>
      </div>
    </Card>
  );
}

/** Today's row: the first day at or after local midnight, else the last held. */
function todayRow(daily: WeatherDay[]): WeatherDay | null {
  if (daily.length === 0) return null;
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return daily.find((day) => new Date(day.date) >= midnight) ?? daily[daily.length - 1] ?? null;
}

/**
 * "Rain expected Friday", from the forecast rows themselves.
 *
 * A derivation, not a forecast of our own: the first upcoming day the provider
 * reports measurable rain, named. When no day in the week carries any, that is
 * said too — silence would read as "we do not know".
 */
function rainOutlook(
  daily: WeatherDay[],
  language: Parameters<typeof formatDate>[1],
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);

  const upcoming = daily.filter((day) => new Date(day.date) >= midnight).slice(0, 7);
  if (upcoming.length === 0) return null;

  const wet = upcoming.find((day) => (day.rainMm ?? 0) > 0 || (day.rainProbPct ?? 0) >= 60);
  if (!wet) return t('weather:noRainWeek');

  const isToday = new Date(wet.date) < new Date(midnight.getTime() + 86_400_000);

  return t('weather:rainNextDay', {
    day: isToday ? t('weather:today') : formatDate(wet.date, language, { weekday: 'long' }),
  });
}
