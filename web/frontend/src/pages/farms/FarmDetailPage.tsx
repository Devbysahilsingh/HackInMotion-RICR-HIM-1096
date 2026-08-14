import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';

import { dashboardApi, farmsApi, marketApi, recommendationsApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import {
  MAX_ACTIVE_CROPS_PER_FARM,
  MAX_FARMS_PER_USER,
  type CropWithStage,
  type DashboardResponse,
  type Farm,
  type FeedItem,
} from '@/api/types';
import { useActiveFarm } from '@/farm/ActiveFarmContext';
import { QueryBoundary } from '@/components/QueryBoundary';
import { DecisionBanner } from '@/components/domain/DecisionBanner';
import { FarmCropTile } from '@/components/domain/FarmCropTile';
import { ForecastStrip, RiskList } from '@/components/domain/WeatherStrip';
import { usePageHeading } from '@/hooks/usePageHeading';
import { HeroBand } from '@/components/ui/HeroBand';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, Section } from '@/components/ui/Card';
import { FreshnessDot } from '@/components/ui/FreshnessDot';
import { ConfirmDialog } from '@/components/ui/Modal';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { EmptyState, Notice } from '@/components/ui/states';
import { IconCloud, IconLeaf, IconLocation, IconPlus, IconTrash } from '@/components/ui/icons';
import { useApiErrorMessage } from '@/hooks/useApiError';
import { useLanguage } from '@/i18n/LanguageContext';
import { cn } from '@/lib/cn';
import { feedForFarm } from '@/lib/feedScope';
import { formatNumber, localizedName } from '@/lib/format';
import { allocatedCropAcres, availableFarmAcres, toAcres } from '@/lib/units';

/**
 * One field, end to end.
 *
 * The design's farm screen answers three questions in order, and the page is
 * built in that order rather than as a list of resources: *what is this field*
 * (the hero and its four constants), *what should I do about it today* (the
 * decision band), *how is it laid out and what is on it* (the land ledger, the
 * weather, the crops).
 *
 * Every number on it comes from an endpoint that already existed:
 * `GET /farms/:id` for the record and its crops, `GET /farms/:id/weather` for
 * the forecast, `GET /market/nearby` for the mandi, and `/dashboard` for the
 * engines' ranked decisions — narrowed to this farm in memory, because
 * `/dashboard` is contracted to be one account-wide aggregation.
 */
export default function FarmDetailPage() {
  const { t } = useTranslation(['farm', 'crop', 'common', 'agri', 'weather']);
  const { farmId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const toMessage = useApiErrorMessage();
  const { activeFarmId, setActiveFarmId } = useActiveFarm();

  const [confirmOpen, setConfirmOpen] = useState(false);

  const farmQuery = useQuery({
    queryKey: queryKeys.farms.detail(farmId),
    queryFn: () => farmsApi.get(farmId),
    enabled: Boolean(farmId),
  });

  const weatherQuery = useQuery({
    queryKey: queryKeys.farms.weather(farmId),
    queryFn: () => farmsApi.weather(farmId),
    enabled: Boolean(farmId),
    staleTime: STALE_TIME.slowMoving,
  });

  /*
   * Opening a field makes it the selected one. Without this the sidebar could
   * go on naming a different farm while this page shows another — the exact
   * "farm A's weather beside farm B's crop" confusion the product must not
   * create. It is a UI preference only; every request below is still
   * ownership-checked server-side against the token, never against this id.
   */
  const loadedFarmId = farmQuery.data?.farm.id;
  useEffect(() => {
    if (loadedFarmId && loadedFarmId !== activeFarmId) setActiveFarmId(loadedFarmId);
  }, [loadedFarmId, activeFarmId, setActiveFarmId]);

  const remove = useMutation({
    mutationFn: () => farmsApi.remove(farmId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.farms.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      toast.push(t('common:action.done'));
      navigate('/farms', { replace: true });
    },
    onError: (error) => {
      setConfirmOpen(false);
      toast.push(toMessage(error), 'error');
    },
  });

  return (
    <>
      <QueryBoundary query={farmQuery} loading={<SkeletonCard />}>
        {({ farm, crops }) => {
          const activeCrops = crops.filter((crop) => crop.status === 'active').length;

          return (
            <>
              <FarmHero farm={farm} crops={crops} onDelete={() => setConfirmOpen(true)} />

              <div className="mt-6 space-y-8">
                <FarmDecision farm={farm} crops={crops} />

                <LandLedger farm={farm} crops={crops} />

                <Section
                  title={t('farm:weatherHeading')}
                  action={
                    <ButtonLink
                      to={`/farms/${farm.id}/weather`}
                      variant="ghost"
                      size="md"
                      leadingIcon={<IconCloud size={18} />}
                    >
                      {t('common:action.viewAll')}
                    </ButtonLink>
                  }
                >
                  <QueryBoundary query={weatherQuery} loading={<SkeletonCard />}>
                    {(weather) =>
                      weather.freshness.status === 'pending' ? (
                        <Notice tone="warning" data-testid="weather-pending">
                          {weather.freshness.reason === 'no_coordinates'
                            ? t('weather:pendingNoCoordinates')
                            : t('weather:pendingBody')}
                        </Notice>
                      ) : (
                        <Card className="space-y-3 p-4 sm:p-5">
                          <FreshnessDot freshness={weather.freshness} />
                          <ForecastStrip daily={weather.daily} />
                          <RiskList risks={weather.risks.slice(0, 3)} />
                        </Card>
                      )
                    }
                  </QueryBoundary>
                </Section>

                <Section
                  title={t('farm:cropsHeading')}
                  action={
                    activeCrops < MAX_ACTIVE_CROPS_PER_FARM && (
                      <ButtonLink
                        to={`/farms/${farm.id}/crops/new`}
                        size="md"
                        leadingIcon={<IconPlus size={18} />}
                      >
                        {t('farm:addCropCta')}
                      </ButtonLink>
                    )
                  }
                >
                  <FarmCrops farmId={farm.id} crops={crops} />
                </Section>
              </div>
            </>
          );
        }}
      </QueryBoundary>

      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => remove.mutate()}
        title={t('farm:deleteConfirmTitle')}
        body={t('farm:deleteConfirmBody')}
        confirmLabel={t('farm:deleteCta')}
        isPending={remove.isPending}
      />
    </>
  );
}

/**
 * The farm hero: the field across the top, and underneath it the four constants
 * a farmer checks every decision against — soil, water, today's weather, the
 * mandi they would sell into.
 *
 * The picture is the one the farmer uploaded for *this* field (`Farm.photoUrl`,
 * stored through the same magic-byte-checked, EXIF-stripped pipeline as a
 * crop-health scan). No photo falls back to the design's `.ph` gradient rather
 * than to a stock aerial of somebody else's land.
 *
 * The mandi cell carries the market's *name and how near it is in
 * administrative terms*, never a distance in kilometres: Agmarknet publishes no
 * mandi coordinates, so a "12 km" would be a number this system invented.
 */
function FarmHero({
  farm,
  crops,
  onDelete,
}: {
  farm: Farm;
  crops: readonly CropWithStage[];
  onDelete: () => void;
}) {
  const { t } = useTranslation(['farm', 'common', 'agri', 'weather', 'market']);
  const { language } = useLanguage();
  const headingRef = usePageHeading(farm.name);
  const { farms } = useActiveFarm();

  const weatherQuery = useQuery({
    queryKey: queryKeys.farms.weather(farm.id),
    queryFn: () => farmsApi.weather(farm.id),
    staleTime: STALE_TIME.slowMoving,
  });

  const mandiQuery = useQuery({
    queryKey: queryKeys.market.nearby(farm.id, undefined, 7),
    queryFn: () => marketApi.nearby({ farmId: farm.id, days: 7 }),
    staleTime: STALE_TIME.slowMoving,
  });

  const unavailable = t('farm:dataUnavailable');

  /*
   * "Weather now" is today's row of the stored forecast — the first day at or
   * after midnight local. When nothing has been ingested for this field yet the
   * cell says so instead of rendering an em dash that reads like a zero.
   */
  const daily = weatherQuery.data?.daily ?? [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayRow = daily.find((day) => new Date(day.date) >= today) ?? daily[daily.length - 1];

  const weatherNow = todayRow
    ? [
        todayRow.tMinC != null && todayRow.tMaxC != null
          ? t('weather:tempRange', {
              min: formatNumber(todayRow.tMinC, language, { maximumFractionDigits: 0 }),
              max: formatNumber(todayRow.tMaxC, language, { maximumFractionDigits: 0 }),
            })
          : null,
        todayRow.rainProbPct != null
          ? `${t('weather:rain')} ${formatNumber(todayRow.rainProbPct, language, {
              maximumFractionDigits: 0,
            })}%`
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : unavailable;

  const nearestMandi = mandiQuery.data?.mandis[0];
  const mandiValue = nearestMandi
    ? `${nearestMandi.market} · ${
        nearestMandi.proximity === 'SAME_DISTRICT'
          ? t('market:inYourDistrict')
          : t('market:inYourState')
      }`
    : unavailable;

  const location = [farm.location.village, farm.location.district, farm.location.state]
    .filter(Boolean)
    .join(', ');
  const size = `${formatNumber(farm.sizeValue, language)} ${t(`common:unit.${farm.sizeUnit}`)}`;

  return (
    <HeroBand
      titleRef={headingRef}
      title={farm.name}
      imageUrl={farm.photoUrl}
      imageAlt={t('farm:photoAlt')}
      eyebrow={<CropHealthEyebrow crops={crops} />}
      subtitle={
        <span className="inline-flex items-center gap-1.5">
          <IconLocation size={15} aria-hidden="true" />
          {location} · {size}
        </span>
      }
      stats={[
        { label: t('agri:soilLabel'), value: t(`agri:soil.${farm.soilType}`) },
        {
          label: t('farm:irrigationLabel'),
          value: t(`agri:irrigationMethod.${farm.irrigationMethod}`),
        },
        {
          label: t('farm:weatherNowLabel'),
          value: weatherQuery.isPending ? unavailable : weatherNow,
        },
        {
          label: t('farm:nearestMandiLabel'),
          value: mandiQuery.isPending ? unavailable : mandiValue,
        },
      ]}
      actions={
        <>
          {/*
            "My farm" in the sidebar lands here rather than on the farms list,
            so this page has to carry the route to a second field or a farmer
            with one farm can never add another. Hidden at the per-account
            ceiling the API enforces, so the button never offers a 409.
          */}
          {farms.length < MAX_FARMS_PER_USER && (
            <ButtonLink
              to="/farms/new"
              variant="onDarkOutline"
              leadingIcon={<IconPlus size={18} />}
              data-testid="farm-add"
            >
              {t('farm:addFarmCta')}
            </ButtonLink>
          )}
          <ButtonLink to={`/farms/${farm.id}/edit`} variant="onDark">
            {t('common:action.edit')}
          </ButtonLink>
          <Button
            variant="onDarkOutline"
            onClick={onDelete}
            leadingIcon={<IconTrash size={18} />}
            data-testid="farm-delete"
          >
            {t('common:action.delete')}
          </Button>
        </>
      }
    />
  );
}

/**
 * The hero's status pill.
 *
 * "No health issues reported" is deliberately the wording rather than "all
 * crops healthy": a crop nobody has photographed has no health verdict, and
 * claiming it is healthy would be an assessment this system never made. What is
 * true is that nothing has been reported — and when something has, the count of
 * flagged crops replaces it.
 */
function CropHealthEyebrow({ crops }: { crops: readonly CropWithStage[] }) {
  const { t } = useTranslation('farm');

  const query = useQuery({
    queryKey: queryKeys.dashboard(),
    queryFn: dashboardApi.get,
    staleTime: STALE_TIME.dashboard,
  });

  const cropIds = new Set(crops.map((crop) => crop.id));
  const flagged = (query.data?.cropCards ?? []).filter(
    (card) => cropIds.has(card.cropId) && card.healthFlag,
  ).length;

  return <>{flagged > 0 ? t('healthFlagged', { count: flagged }) : t('healthNoFlags')}</>;
}

/**
 * Today's decision for this field.
 *
 * The item is not chosen here: `/dashboard` returns the feed already ranked by
 * the composer (`feedComposer.js`), so this takes the highest-ranked item that
 * belongs to this farm and hands it to the same band the dashboard uses. The
 * page ranks nothing and writes no agronomic sentence — both would be the UI
 * making a decision that belongs to the engines (rule 5).
 */
function FarmDecision({ farm, crops }: { farm: Farm; crops: readonly CropWithStage[] }) {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const toast = useToast();
  const toMessage = useApiErrorMessage();

  const query = useQuery({
    queryKey: queryKeys.dashboard(),
    queryFn: dashboardApi.get,
    staleTime: STALE_TIME.dashboard,
  });

  /**
   * Acknowledge, optimistic — the same contract the dashboard uses: the
   * endpoint is idempotent (a second ack is another 204), so a replay after a
   * lost response is harmless, and the row vanishing on tap is the point. On
   * failure the previous payload is restored and the farmer is told.
   */
  const acknowledge = useMutation({
    mutationFn: (item: FeedItem) => recommendationsApi.acknowledge(item.id),
    onMutate: async (item) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.dashboard() });
      const previous = queryClient.getQueryData<DashboardResponse>(queryKeys.dashboard());
      queryClient.setQueryData<DashboardResponse>(queryKeys.dashboard(), (current) =>
        current
          ? { ...current, feed: current.feed.filter((entry) => entry.id !== item.id) }
          : current,
      );
      return { previous };
    },
    onError: (error, _item, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.dashboard(), context.previous);
      toast.push(toMessage(error), 'error');
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.recommendations.all() });
    },
  });

  if (query.isPending) return <SkeletonCard />;
  if (query.isError || !query.data) return null;

  const scoped = feedForFarm(query.data.feed, {
    farmId: farm.id,
    cropIds: new Set(crops.map((crop) => crop.id)),
    cropCodes: new Set(crops.map((crop) => crop.cropCode)),
  });

  const [lead] = scoped;

  if (!lead) {
    return (
      <section
        data-testid="farm-decision-neutral"
        className="rounded-[18px] border border-leaf-500/25 bg-leaf-tint/50 px-5 py-6 sm:px-[30px] sm:py-7"
      >
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/70 text-leaf-700"
        >
          <IconLeaf size={22} />
        </span>
        <h2 className="mt-3.5 max-w-3xl text-[1.5rem] leading-[1.1] sm:text-[1.875rem]">
          {t('dashboard.todayNeutralTitle')}
        </h2>
        <p className="mt-2 max-w-[52ch] text-sm text-ink-700 sm:text-base">
          {t('dashboard.todayNeutralBody')}
        </p>
      </section>
    );
  }

  return (
    <DecisionBanner
      item={lead}
      onAcknowledge={(entry) => acknowledge.mutate(entry)}
      isAcknowledging={acknowledge.isPending && acknowledge.variables?.id === lead.id}
    />
  );
}

/**
 * The crops on this field, and only this field.
 *
 * `crops` comes from `GET /farms/:id`, which is ownership-scoped server-side,
 * so a crop from another farm cannot reach this grid. The health flags are
 * matched by `cropId` against the dashboard payload — never by crop code, which
 * two farms can share.
 */
function FarmCrops({ farmId, crops }: { farmId: string; crops: readonly CropWithStage[] }) {
  const { t } = useTranslation(['farm', 'common']);

  const dashboardQuery = useQuery({
    queryKey: queryKeys.dashboard(),
    queryFn: dashboardApi.get,
    staleTime: STALE_TIME.dashboard,
  });

  const healthByCropId = new Map(
    (dashboardQuery.data?.cropCards ?? [])
      .filter((card) => card.farmId === farmId)
      .map((card) => [card.cropId, card.healthFlag]),
  );

  if (crops.length === 0) {
    return (
      <EmptyState
        title={t('farm:cropsEmpty')}
        action={<ButtonLink to={`/farms/${farmId}/crops/new`}>{t('farm:addCropCta')}</ButtonLink>}
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="farm-crops">
      {crops.map((crop) => (
        <FarmCropTile key={crop.id} crop={crop} healthFlag={healthByCropId.get(crop.id) ?? null} />
      ))}
    </div>
  );
}

/**
 * The land ledger — how much of the farm is spoken for, as one bar.
 *
 * The design's strongest farm-screen idea, and it maps onto a rule this system
 * already enforces: a crop's area is checked against the farm's in
 * acre-equivalents on both sides. The bar is that invariant made visible, so a
 * farmer sees the remaining land *before* the crop form refuses an area.
 *
 * Arithmetic is delegated to `allocatedCropAcres` / `availableFarmAcres` rather
 * than redone here. Those helpers hold the conversion table that has to agree
 * with the server's, and a second copy in a component is precisely how the
 * client starts promising an area the API rejects.
 */
function LandLedger({ farm, crops }: { farm: Farm; crops: readonly CropWithStage[] }) {
  const { t } = useTranslation(['farm', 'common', 'agri']);
  const { language } = useLanguage();

  const totalAcres = toAcres(farm.sizeValue, farm.sizeUnit);
  const usedAcres = allocatedCropAcres(crops);
  const freeAcres = availableFarmAcres(farm, crops);

  if (totalAcres <= 0) return null;

  // A fixed palette walked in order. Crop identity does not pick a colour —
  // that would be a per-crop conditional (rule 4) — the position in the list does.
  const BANDS = ['bg-brand-600', 'bg-leaf-500', 'bg-harvest-500', 'bg-earth-600'];

  /*
   * `areaValue` is optional on a crop — a farmer may record what is growing
   * without measuring it. Such a crop cannot occupy a band, so it is left out
   * of the bar rather than drawn as a zero-width sliver or counted as 0 acres.
   * `allocatedCropAcres` already ignores it on the arithmetic side, so the bar
   * and the total agree.
   */
  const active = crops
    .filter((crop) => crop.status !== 'harvested' && typeof crop.areaValue === 'number')
    .map((crop) => ({
      crop,
      // Both fields travel together: an area is meaningless without its unit,
      // so they are resolved once here instead of at each use site.
      acres: toAcres(crop.areaValue as number, crop.areaUnit ?? farm.sizeUnit),
    }));

  const allocatedLabel = t('farm:landAllocated', {
    used: formatNumber(usedAcres, language, { maximumFractionDigits: 1 }),
    total: formatNumber(totalAcres, language, { maximumFractionDigits: 1 }),
    unit: t('common:unit.acre'),
  });

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="kicker">{t('farm:landLedgerTitle')}</span>
        <b className="text-sm font-semibold">{allocatedLabel}</b>
      </div>

      <div
        className="mt-3 flex h-[22px] overflow-hidden rounded-lg border border-line"
        role="img"
        aria-label={allocatedLabel}
      >
        {active.map(({ crop, acres }, index) => (
          <span
            key={crop.id}
            className={BANDS[index % BANDS.length]}
            style={{ width: `${(acres / totalAcres) * 100}%` }}
          />
        ))}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.813rem] font-medium">
        {active.map(({ crop, acres }, index) => (
          <span key={crop.id} className="inline-flex items-center gap-1.5">
            <i
              aria-hidden="true"
              className={cn('size-2.5 rounded-[3px]', BANDS[index % BANDS.length])}
            />
            {localizedName(crop.registry.names, language)?.text ?? crop.cropCode}{' '}
            {formatNumber(acres, language, { maximumFractionDigits: 1 })}
            {crop.status === 'planned' && (
              <span className="text-ink-500">({t('agri:cropStatus.planned')})</span>
            )}
          </span>
        ))}
        <span className="ml-auto text-ink-500">
          {t('farm:landFree', {
            value: formatNumber(freeAcres, language, { maximumFractionDigits: 1 }),
            unit: t('common:unit.acre'),
          })}
        </span>
      </div>
    </Card>
  );
}
