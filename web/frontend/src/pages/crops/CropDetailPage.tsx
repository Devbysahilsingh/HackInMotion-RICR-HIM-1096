import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import {
  cropsApi,
  dashboardApi,
  farmsApi,
  healthApi,
  marketApi,
  recommendationsApi,
} from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import {
  CROP_STATUSES,
  type CropWithStage,
  type DashboardResponse,
  type FeedItem,
  type RegistryCrop,
} from '@/api/types';
import { useActiveFarm } from '@/farm/ActiveFarmContext';
import { QueryBoundary } from '@/components/QueryBoundary';
import { CropMarketCard } from '@/components/domain/CropMarketCard';
import { CropStageTimeline } from '@/components/domain/CropStageTimeline';
import { DecisionBanner } from '@/components/domain/DecisionBanner';
import { DiseaseName } from '@/components/domain/DiseaseName';
import { FertilizerGuidanceView } from '@/components/domain/FertilizerGuidanceView';
import { IrrigationVerdictCard } from '@/components/domain/IrrigationVerdictCard';
import { MarketSignalCard } from '@/components/domain/MarketSignalCard';
import { IrrigationLogForm, IrrigationLedger } from '@/components/domain/IrrigationLog';
import { HealthLogList } from '@/components/domain/HealthLogList';
import { UploadDropzone } from '@/components/domain/UploadDropzone';
import { usePageHeading } from '@/hooks/usePageHeading';
import { Badge } from '@/components/ui/Badge';
import { HeroBand } from '@/components/ui/HeroBand';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Card, Section } from '@/components/ui/Card';
import { KeyValueList, KeyValueRow } from '@/components/ui/KeyValueRow';
import { SelectField, TextField } from '@/components/ui/Field';
import { ConfirmDialog, Modal } from '@/components/ui/Modal';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { Tabs, TabPanel } from '@/components/ui/Tabs';
import { useToast } from '@/components/ui/Toast';
import { EmptyState, Notice } from '@/components/ui/states';
import { IconCamera, IconLeaf, IconTrash } from '@/components/ui/icons';
import { useApiErrorMessage } from '@/hooks/useApiError';
import { useLanguage } from '@/i18n/LanguageContext';
import { translateMessageKey } from '@/i18n/messageKey';
import { cn } from '@/lib/cn';
import { feedForCrop } from '@/lib/feedScope';
import { formatDate, formatDayMonth, formatNumber, localizedName } from '@/lib/format';

const TAB_VALUES = ['irrigation', 'health', 'fertilizer', 'market'] as const;
type TabValue = (typeof TAB_VALUES)[number];

const isTab = (value: string | null): value is TabValue =>
  value !== null && (TAB_VALUES as readonly string[]).includes(value);

/**
 * One crop, decision first.
 *
 * The screen used to be five tabs with the record on the first one, which meant
 * a farmer had to know which tab held the answer before they could read it. The
 * design inverts that: the top of the page says what the crop is, where it is
 * in its season, and what to do about it today; the four small cards underneath
 * are one line each of "and here is the current state of water, health, feed and
 * price"; and the full working — the irrigation ledger, the health history, the
 * complete fertiliser schedule, the market trace — stays available underneath,
 * unchanged, in the tabs it always lived in.
 *
 * Nothing on the summary is authored here. Every verdict is the engine's own
 * i18n key rendered with the engine's own numbers; every date, area and variety
 * is a stored field. Where a value does not exist the card says so rather than
 * filling the slot.
 */
export default function CropDetailPage() {
  const { cropId = '' } = useParams();

  const query = useQuery({
    queryKey: queryKeys.crops.detail(cropId),
    queryFn: () => cropsApi.get(cropId),
    enabled: Boolean(cropId),
  });

  return (
    <QueryBoundary query={query} loading={<SkeletonCard />}>
      {({ crop, registry }) => <CropDetail crop={crop} registry={registry} />}
    </QueryBoundary>
  );
}

function CropDetail({ crop, registry }: { crop: CropWithStage; registry: RegistryCrop | null }) {
  const { t } = useTranslation(['crop', 'common', 'agri', 'irrigation', 'health']);
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeFarmId, setActiveFarmId } = useActiveFarm();
  const detailsRef = useRef<HTMLDivElement>(null);

  // The tab lives in the URL so a feed item can deep-link to "irrigation" and
  // a browser back button returns to the tab the farmer was on.
  const requested = searchParams.get('tab');
  const tab: TabValue = isTab(requested) ? requested : 'irrigation';

  /*
   * A crop belongs to exactly one farm, so opening one selects that farm.
   * Without it the sidebar could keep naming a different field while this page
   * shows this crop's — the mismatch that makes a farmer distrust the numbers.
   * Selection is a UI preference; ownership is still proved server-side on
   * every request below.
   */
  useEffect(() => {
    if (crop.farmId !== activeFarmId) setActiveFarmId(crop.farmId);
  }, [crop.farmId, activeFarmId, setActiveFarmId]);

  const openDetails = (next: TabValue) => {
    setSearchParams({ tab: next }, { replace: true });
    detailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const items = [
    { value: 'irrigation' as const, label: t('crop:tabIrrigation') },
    { value: 'health' as const, label: t('crop:tabHealth') },
    { value: 'fertilizer' as const, label: t('crop:tabFertilizer') },
    { value: 'market' as const, label: t('crop:tabMarket') },
  ];

  return (
    <>
      <CropHero crop={crop} />

      {/*
        Said up front rather than discovered card by card: an unsupported crop
        gets a farm record and nothing else, and pretending otherwise would
        waste a farmer's time.
      */}
      {crop.registry.supportLevel === 'UNSUPPORTED' && (
        <Notice tone="warning" className="mt-5" data-testid="crop-unsupported">
          {t('crop:unsupportedNotice')}
        </Notice>
      )}
      {registry?.dataGaps && registry.dataGaps.length > 0 && (
        <Notice tone="info" className="mt-3">
          {t('crop:dataGapsNotice')}
        </Notice>
      )}

      {/*
        The design's split: the decision and the day's state on the wide side,
        the crop's own record and the stage note on the narrow one. It collapses
        to a single column below 1240px, where two columns leave the four state
        cards too narrow to carry a verdict word.
      */}
      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-5">
          <CropDecision crop={crop} onOpenDetails={openDetails} />

          <div className="grid gap-4 sm:grid-cols-2">
            <CropWeatherCard farmId={crop.farmId} />
            <CropIrrigationCard cropId={crop.id} onOpenDetails={() => openDetails('irrigation')} />
            <CropHealthCard crop={crop} onOpenDetails={() => openDetails('health')} />
            <CropFertiliserCard cropId={crop.id} onOpenDetails={() => openDetails('fertilizer')} />
          </div>

          <CropMarketCard
            farmId={crop.farmId}
            cropCode={crop.cropCode}
            onOpenDetails={() => openDetails('market')}
          />
        </div>

        <div className="flex flex-col gap-5">
          <CropRecord crop={crop} />
          <StageNote crop={crop} registry={registry} />
        </div>
      </div>

      {/*
        The working, kept whole. Everything the tabbed page carried is still
        here — the irrigation ledger and its log form, the health history, the
        full fertiliser schedule with its sources and disclaimer, the market
        signal and its trace — just below the summary rather than in front of it.
      */}
      <div ref={detailsRef} className="mt-8 scroll-mt-6">
        <Section title={t('crop:detailsHeading')} as="h2">
          <Tabs
            items={items}
            value={tab}
            onChange={(next) => setSearchParams({ tab: next }, { replace: true })}
            label={t('crop:detailsHeading')}
            idBase="crop"
          />

          <TabPanel id={`crop-${tab}-panel`}>
            {tab === 'irrigation' && <IrrigationTab cropId={crop.id} />}
            {tab === 'health' && <HealthTab cropId={crop.id} />}
            {tab === 'fertilizer' && <FertilizerTab cropId={crop.id} />}
            {tab === 'market' && <MarketTab cropCode={crop.cropCode} />}
          </TabPanel>
        </Section>
      </div>
    </>
  );
}

// ── Hero ────────────────────────────────────────────────────────────────────

/**
 * The crop's own photograph, its name in both of the registry's languages, and
 * where it is in the season.
 *
 * The image is `Crop.photoUrl` — the picture the farmer took of *this* planting,
 * uploaded through the same checked pipeline as a health scan, and distinct from
 * a diagnostic scan photo. Without one the design's `.ph` gradient stands in;
 * a stock photo of another field would read as evidence about this one.
 */
function CropHero({ crop }: { crop: CropWithStage }) {
  const { t } = useTranslation(['crop', 'common', 'agri', 'farm']);
  const { language } = useLanguage();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const toMessage = useApiErrorMessage();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [photoModalOpen, setPhotoModalOpen] = useState(false);

  const names = crop.registry.names;
  const title = localizedName(names, language)?.text ?? crop.freeTextLabel ?? crop.cropCode;
  const secondary = language === 'hi' ? names?.en : names?.hi;
  const headingRef = usePageHeading(title);

  /**
   * The farm-context line (ux-flows: the farmer must never wonder "which field
   * am I looking at?"). Served from the farms-list cache on the common path.
   */
  const farmsQuery = useQuery({
    queryKey: queryKeys.farms.list(),
    queryFn: farmsApi.list,
    staleTime: STALE_TIME.slowMoving,
  });
  const farm = farmsQuery.data?.farms.find((entry) => entry.id === crop.farmId) ?? null;

  const remove = useMutation({
    mutationFn: () => cropsApi.remove(crop.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.farms.detail(crop.farmId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      toast.push(t('common:action.done'));
      navigate(`/farms/${crop.farmId}`, { replace: true });
    },
    onError: (error) => {
      setConfirmOpen(false);
      toast.push(toMessage(error), 'error');
    },
  });

  const harvest = useMutation({
    mutationFn: () => cropsApi.update(crop.id, { status: 'harvested' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.crops.detail(crop.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.farms.detail(crop.farmId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      toast.push(t('common:action.done'));
    },
    onError: (error) => toast.push(toMessage(error), 'error'),
  });

  /*
   * The design's meta line: stage · day N · area · sown date. Each part is
   * dropped rather than filled when the record has no value for it — an
   * unmeasured area is a blank in the record, not "0 acre".
   */
  const meta = [
    crop.stage.stage ? t(`agri:stage.${crop.stage.stage}`) : null,
    crop.stage.daysSinceSowing != null
      ? t('crop:stageDayLabel', { days: crop.stage.daysSinceSowing })
      : null,
    crop.areaValue != null
      ? `${formatNumber(crop.areaValue, language)} ${t(`common:unit.${crop.areaUnit ?? 'acre'}`)}`
      : null,
    t('farm:wizardCropSown', { date: formatDayMonth(crop.sowingDate, language) }),
  ].filter(Boolean);

  return (
    <>
      <HeroBand
        titleRef={headingRef}
        title={
          <>
            {title}
            {secondary && (
              <span className="ml-3 font-sans text-[1.125rem] font-normal text-brand-100">
                {secondary}
              </span>
            )}
          </>
        }
        imageUrl={crop.photoUrl}
        imageAlt={t('crop:photoAlt')}
        eyebrow={t(`agri:cropStatus.${crop.status}`)}
        subtitle={
          <>
            {farm && (
              <>
                <Link to={`/farms/${farm.id}`} className="text-white underline underline-offset-2">
                  {farm.name}
                </Link>
                {' · '}
              </>
            )}
            {meta.join(' · ')}
          </>
        }
        /*
            The stage strip sits inside the hero card, directly under the band —
            the design's own arrangement, and the one that makes "which stage"
            read as a property of the crop rather than as a separate widget.
          */
        footer={
          crop.stage.hasVerdict && crop.stage.stage ? (
            <CropStageTimeline stage={crop.stage} />
          ) : (
            <p className="text-sm text-ink-500">{t('crop:noStage')}</p>
          )
        }
        actions={
          <>
            {crop.status === 'active' && (
              <Button
                variant="onDark"
                onClick={() => harvest.mutate()}
                isLoading={harvest.isPending}
              >
                {t('crop:markHarvested')}
              </Button>
            )}
            <Button
              variant="onDarkOutline"
              onClick={() => setPhotoModalOpen(true)}
              leadingIcon={<IconCamera size={18} />}
              data-testid="crop-photo-manage"
            >
              {crop.photoUrl ? t('crop:photoChangeCta') : t('crop:photoAddCta')}
            </Button>
            <Button
              variant="onDarkOutline"
              onClick={() => setConfirmOpen(true)}
              leadingIcon={<IconTrash size={18} />}
              data-testid="crop-delete"
            >
              {t('common:action.delete')}
            </Button>
          </>
        }
      />

      <CropPhotoModal crop={crop} open={photoModalOpen} onClose={() => setPhotoModalOpen(false)} />

      <ConfirmDialog
        open={confirmOpen}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => remove.mutate()}
        title={t('crop:deleteConfirmTitle')}
        body={t('crop:deleteConfirmBody')}
        isPending={remove.isPending}
      />
    </>
  );
}

// ── Today's decision ────────────────────────────────────────────────────────

/**
 * What to do about this crop today.
 *
 * The sentence is the feed composer's, not this page's: `/dashboard` returns the
 * account's decisions already ranked, and this takes the highest-ranked one that
 * names this crop. When the engines have nothing to say about it, the band says
 * that plainly instead of manufacturing advice — which is the rule that keeps
 * agronomy out of React (rules 5 and 6).
 */
function CropDecision({
  crop,
  onOpenDetails,
}: {
  crop: CropWithStage;
  onOpenDetails: (tab: TabValue) => void;
}) {
  const { t } = useTranslation(['common', 'crop', 'irrigation']);
  const queryClient = useQueryClient();
  const toast = useToast();
  const toMessage = useApiErrorMessage();

  const query = useQuery({
    queryKey: queryKeys.dashboard(),
    queryFn: dashboardApi.get,
    staleTime: STALE_TIME.dashboard,
  });

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

  /* The design's two actions on this band, and the only two it offers. */
  const actions = (
    <>
      <ButtonLink to={`/scan?cropId=${crop.id}`} variant="onDark">
        {t('crop:scanCta')}
      </ButtonLink>
      <Button variant="onDarkOutline" onClick={() => onOpenDetails('irrigation')}>
        {t('irrigation:planTitle')}
      </Button>
    </>
  );

  if (query.isPending) return <SkeletonCard />;

  const [lead] = feedForCrop(query.data?.feed ?? [], {
    cropId: crop.id,
    cropCode: crop.cropCode,
  });

  if (!lead) {
    return (
      <section
        data-testid="crop-decision-neutral"
        className="rounded-[18px] border border-leaf-500/25 bg-leaf-tint/50 px-5 py-6 sm:px-[30px] sm:py-7"
      >
        <span
          aria-hidden="true"
          className="grid size-10 place-items-center rounded-xl bg-white/70 text-leaf-700"
        >
          <IconLeaf size={22} />
        </span>
        <p className="kicker mt-3">{t('common:decision.forThisCrop')}</p>
        <h2 className="mt-2 max-w-3xl text-[1.5rem] leading-[1.1] sm:text-[1.75rem]">
          {t('common:dashboard.todayNeutralTitle')}
        </h2>
        <p className="mt-2 max-w-[52ch] text-sm text-ink-700">
          {t('common:dashboard.todayNeutralBody')}
        </p>
        <div className="mt-4 flex flex-wrap gap-2.5">
          <ButtonLink to={`/scan?cropId=${crop.id}`} variant="secondary">
            {t('crop:scanCta')}
          </ButtonLink>
          <Button variant="ghost" onClick={() => onOpenDetails('irrigation')}>
            {t('irrigation:planTitle')}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <DecisionBanner
      item={lead}
      kicker={t('common:decision.forThisCrop')}
      actions={actions}
      onAcknowledge={(entry) => acknowledge.mutate(entry)}
      isAcknowledging={acknowledge.isPending && acknowledge.variables?.id === lead.id}
    />
  );
}

// ── The four state cards ────────────────────────────────────────────────────

/** The shared shell: a kicker, one large answer, one quiet line, one action. */
function StateCard({
  kicker,
  headline,
  detail,
  action,
  tone = 'default',
  testId,
}: {
  kicker: string;
  headline: React.ReactNode;
  detail?: React.ReactNode;
  action?: React.ReactNode;
  tone?: 'default' | 'quiet';
  testId?: string;
}) {
  return (
    <Card className="flex h-full flex-col p-5" data-testid={testId}>
      <span className="kicker">{kicker}</span>
      <p
        className={cn(
          'mt-2.5 font-display text-[1.5rem] font-extrabold leading-tight tracking-[-0.03em]',
          tone === 'quiet' && 'text-ink-500',
        )}
      >
        {headline}
      </p>
      {detail && <div className="mt-1.5 text-sm text-ink-500">{detail}</div>}
      {action && <div className="mt-auto pt-3">{action}</div>}
    </Card>
  );
}

function CropWeatherCard({ farmId }: { farmId: string }) {
  const { t } = useTranslation(['weather', 'common', 'crop']);
  const { language } = useLanguage();

  const query = useQuery({
    queryKey: queryKeys.farms.weather(farmId),
    queryFn: () => farmsApi.weather(farmId),
    staleTime: STALE_TIME.slowMoving,
  });

  if (query.isPending) return <SkeletonCard />;

  const daily = query.data?.daily ?? [];
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const today = daily.find((day) => new Date(day.date) >= midnight) ?? daily[daily.length - 1];

  if (!today) {
    return (
      <StateCard
        kicker={t('weather:pageTitle')}
        headline={t('weather:unavailableTitle')}
        tone="quiet"
        detail={
          query.data?.freshness.reason === 'no_coordinates'
            ? t('weather:pendingNoCoordinates')
            : t('weather:pendingBody')
        }
        testId="crop-weather"
      />
    );
  }

  const detail = [
    today.rainProbPct != null
      ? `${t('weather:rain')} ${formatNumber(today.rainProbPct, language, {
          maximumFractionDigits: 0,
        })}%`
      : null,
    today.humidityPct != null
      ? `${t('weather:humidity')} ${formatNumber(today.humidityPct, language, {
          maximumFractionDigits: 0,
        })}%`
      : null,
  ].filter(Boolean);

  return (
    <StateCard
      kicker={t('weather:pageTitle')}
      headline={
        today.tMinC != null && today.tMaxC != null
          ? t('weather:tempRange', {
              min: formatNumber(today.tMinC, language, { maximumFractionDigits: 0 }),
              max: formatNumber(today.tMaxC, language, { maximumFractionDigits: 0 }),
            })
          : t('weather:unavailableTitle')
      }
      detail={detail.join(' · ')}
      action={
        <ButtonLink to={`/farms/${farmId}/weather`} variant="ghost" size="md">
          {t('common:action.viewAll')}
        </ButtonLink>
      }
      testId="crop-weather"
    />
  );
}

function CropIrrigationCard({
  cropId,
  onOpenDetails,
}: {
  cropId: string;
  onOpenDetails: () => void;
}) {
  const { t } = useTranslation(['irrigation', 'common', 'crop']);
  const { language } = useLanguage();

  const query = useQuery({
    queryKey: queryKeys.crops.irrigation(cropId),
    queryFn: () => cropsApi.irrigation(cropId),
    staleTime: STALE_TIME.slowMoving,
  });

  if (query.isPending) return <SkeletonCard />;

  const advice = query.data;
  const verdict = advice?.verdict ?? 'UNAVAILABLE';

  /*
   * "Deficit 22 mm · trigger 52 mm" — the two numbers the FAO-56 engine
   * actually returns: how far the soil has dried down (`depletionMm`) and the
   * readily-available water it may dry to before the crop is stressed
   * (`rawMm`). Neither is derived here; both are omitted when the engine
   * reached no verdict and therefore computed neither.
   */
  const detail = advice
    ? [
        advice.depletionMm != null
          ? t('irrigation:deficitLabel', {
              value: formatNumber(advice.depletionMm, language, { maximumFractionDigits: 0 }),
            })
          : null,
        advice.rawMm != null
          ? t('irrigation:triggerLabel', {
              value: formatNumber(advice.rawMm, language, { maximumFractionDigits: 0 }),
            })
          : null,
      ].filter(Boolean)
    : [];

  return (
    <StateCard
      kicker={t('crop:tabIrrigation')}
      headline={translateMessageKey(t, `irrigation.title${verdict}`, {
        days: advice?.days ?? 0,
        amountMm: advice?.amountMm ?? 0,
        amountLitersPerAcre: advice?.amountLitersPerAcre ?? 0,
        rainMm: advice?.rain?.mm ?? 0,
        date: advice?.rain?.date ? formatDayMonth(advice.rain.date, language) : '',
      })}
      detail={detail.join(' · ')}
      action={
        <Button variant="ghost" size="md" onClick={onOpenDetails}>
          {t('irrigation:howWorkedOut')}
        </Button>
      }
      testId="crop-irrigation-summary"
    />
  );
}

/**
 * Healthy classes are named by convention on the model side
 * (`<CROP>_HEALTHY`, plus rice's `RICE_NORMAL` — see `isHealthyCode` in
 * `backend/src/services/cropHealthService.js`). The same convention is read
 * here so a clean result reads as "no issue found" rather than as a disease
 * name the farmer would have to decode.
 */
const isHealthyCode = (code: string | null | undefined): boolean =>
  Boolean(code) && (code!.endsWith('_HEALTHY') || code === 'RICE_NORMAL');

function CropHealthCard({
  crop,
  onOpenDetails,
}: {
  crop: CropWithStage;
  onOpenDetails: () => void;
}) {
  const { t } = useTranslation(['crop', 'health', 'common']);
  const { language } = useLanguage();

  const query = useQuery({
    queryKey: queryKeys.health.logs(crop.id, 1),
    queryFn: () => healthApi.logs({ cropId: crop.id, page: 1, limit: 20 }),
  });

  if (query.isPending) return <SkeletonCard />;

  const latest = query.data?.data.logs[0] ?? null;

  if (!latest) {
    return (
      <StateCard
        kicker={t('crop:tabHealth')}
        headline={t('crop:healthNoScanTitle')}
        detail={t('crop:healthNoScanBody')}
        action={
          <ButtonLink
            to={`/scan?cropId=${crop.id}`}
            variant="secondary"
            size="md"
            leadingIcon={<IconCamera size={16} />}
          >
            {t('crop:scanCta')}
          </ButtonLink>
        }
        testId="crop-health-summary"
      />
    );
  }

  const clean = !latest.analysis.diseaseCode || isHealthyCode(latest.analysis.diseaseCode);

  return (
    <StateCard
      kicker={t('crop:tabHealth')}
      headline={
        clean ? (
          t('crop:healthNoIssue')
        ) : (
          <DiseaseName code={latest.analysis.diseaseCode} cropCode={crop.cropCode} />
        )
      }
      detail={
        <span className="flex flex-wrap items-center gap-2">
          {t('crop:healthLastChecked', { date: formatDayMonth(latest.createdAt, language) })}
          {!clean && latest.analysis.severityAssessment && (
            <Badge tone={latest.analysis.severityAssessment === 'SEVERE' ? 'danger' : 'warning'}>
              {t(`health:severity${titleCase(latest.analysis.severityAssessment)}`, {
                defaultValue: latest.analysis.severityAssessment,
              })}
            </Badge>
          )}
        </span>
      }
      action={
        <Button variant="ghost" size="md" onClick={onOpenDetails}>
          {t('health:historyHeading')}
        </Button>
      }
      testId="crop-health-summary"
    />
  );
}

/** `MILD` → `Mild`, so `health:severityMild` composes without a lookup table. */
const titleCase = (value: string): string => value.charAt(0) + value.slice(1).toLowerCase();

function CropFertiliserCard({
  cropId,
  onOpenDetails,
}: {
  cropId: string;
  onOpenDetails: () => void;
}) {
  const { t } = useTranslation(['crop', 'fertilizer', 'common']);

  const query = useQuery({
    queryKey: queryKeys.crops.fertilizer(cropId),
    queryFn: () => cropsApi.fertilizer(cropId),
    staleTime: STALE_TIME.registry,
  });

  if (query.isPending) return <SkeletonCard />;

  const guidance = query.data;

  if (!guidance?.covered) {
    return (
      <StateCard
        kicker={t('crop:tabFertilizer')}
        headline={t('fertilizer:notCovered')}
        tone="quiet"
        testId="crop-fertilizer-summary"
      />
    );
  }

  /*
   * The step the engine itself marked current (`isCurrent`), never a step this
   * page picked by comparing dates: the window arithmetic lives in
   * `fertilizerService.js` and a second copy here would drift from it.
   */
  const current = guidance.recommendations
    .flatMap((recommendation) => recommendation.schedule)
    .find((step) => step.isCurrent);

  return (
    <StateCard
      kicker={t('crop:tabFertilizer')}
      headline={current ? t('crop:fertiliserNextDose') : t('crop:fertiliserNoDose')}
      detail={
        current ? (
          <>
            {translateMessageKey(t, current.fractionKey)}
            {current.timing && (
              <span lang="en">
                {' · '}
                {current.timing}
              </span>
            )}
            {current.timingUnknown && ` · ${t('fertilizer:timingNotPublished')}`}
          </>
        ) : undefined
      }
      action={
        <Button variant="ghost" size="md" onClick={onOpenDetails}>
          {t('fertilizer:scheduleHeading')}
        </Button>
      }
      testId="crop-fertilizer-summary"
    />
  );
}

// ── The record, and the stage note ──────────────────────────────────────────

/**
 * The crop's own record: what was planted, where, when, and what has been done
 * to it since.
 *
 * "Expected harvest" is the sowing date plus the total length of the published
 * crop calendar (`stage.totalStageDays`) — the same figure the engine's own
 * `harvestApproaching` flag turns on — and it is labelled with that basis
 * rather than presented as a measurement. When no calendar is published for the
 * crop the row is absent rather than estimated.
 */
function CropRecord({ crop }: { crop: CropWithStage }) {
  const { t } = useTranslation(['crop', 'common', 'agri', 'irrigation']);
  const { language } = useLanguage();
  const [editOpen, setEditOpen] = useState(false);

  const ledgerQuery = useQuery({
    queryKey: queryKeys.crops.irrigationLedger(crop.id, 1),
    queryFn: () => cropsApi.irrigationLedger(crop.id, { page: 1, limit: 50 }),
    staleTime: STALE_TIME.interactive,
  });

  const logs = ledgerQuery.data?.data.logs ?? [];
  const appliedMm = logs.reduce((sum, log) => sum + (log.amountMm ?? 0), 0);

  const expectedHarvest =
    crop.stage.totalStageDays != null
      ? new Date(
          new Date(crop.sowingDate).getTime() + crop.stage.totalStageDays * 24 * 60 * 60 * 1000,
        )
      : null;

  return (
    <>
      <Card className="p-5" data-testid="crop-record">
        <span className="kicker">{t('crop:recordHeading')}</span>

        <KeyValueList className="mt-2">
          {crop.variety && <KeyValueRow label={t('crop:varietyRowLabel')} value={crop.variety} />}
          <KeyValueRow
            label={t('crop:areaRowLabel')}
            value={
              crop.areaValue != null
                ? `${formatNumber(crop.areaValue, language)} ${t(
                    `common:unit.${crop.areaUnit ?? 'acre'}`,
                  )}`
                : t('farm:dataUnavailable')
            }
          />
          <KeyValueRow
            label={t('crop:sownRowLabel')}
            value={formatDate(crop.sowingDate, language)}
          />
          {expectedHarvest && (
            <KeyValueRow
              label={t('crop:expectedHarvestLabel')}
              value={
                <span className="inline-flex flex-col items-end">
                  {formatDate(expectedHarvest, language, { month: 'long', year: 'numeric' })}
                  <span className="text-xs font-normal text-ink-500">
                    {t('crop:expectedHarvestBasis')}
                  </span>
                </span>
              }
            />
          )}
          <KeyValueRow
            label={t('crop:waterAppliedLabel')}
            value={
              logs.length === 0
                ? t('crop:waterAppliedNone')
                : t('crop:waterAppliedValue', {
                    count: logs.length,
                    mm: formatNumber(appliedMm, language, { maximumFractionDigits: 0 }),
                  })
            }
          />
          <KeyValueRow label={t('crop:statusLabel')} value={t(`agri:cropStatus.${crop.status}`)} />
        </KeyValueList>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" size="md" onClick={() => setEditOpen(true)}>
            {t('crop:editTitle')}
          </Button>
          <ButtonLink to="/history" variant="secondary" size="md">
            {t('common:nav.history')}
          </ButtonLink>
        </div>
      </Card>

      <CropEditModal crop={crop} open={editOpen} onClose={() => setEditOpen(false)} />
    </>
  );
}

/**
 * Edit what `PATCH /crops/:id` accepts, and nothing else.
 *
 * The API deliberately allows only `variety`, `areaValue` and `status` to
 * change after a crop exists — a sowing date or crop code change would
 * invalidate every stage, irrigation and fertiliser figure already computed
 * against it. So this modal offers exactly those three rather than a fuller
 * form the server would reject, and the land-ledger rule on area is enforced
 * server-side as always.
 */
function CropEditModal({
  crop,
  open,
  onClose,
}: {
  crop: CropWithStage;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation(['crop', 'common', 'agri']);
  const queryClient = useQueryClient();
  const toast = useToast();
  const toMessage = useApiErrorMessage();

  const [variety, setVariety] = useState(crop.variety ?? '');
  const [areaValue, setAreaValue] = useState(crop.areaValue != null ? String(crop.areaValue) : '');
  const [status, setStatus] = useState(crop.status);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      cropsApi.update(crop.id, {
        status,
        ...(variety.trim() ? { variety: variety.trim() } : {}),
        ...(areaValue.trim() && Number.isFinite(Number(areaValue))
          ? { areaValue: Number(areaValue) }
          : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.crops.detail(crop.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.farms.detail(crop.farmId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      toast.push(t('common:action.done'));
      onClose();
    },
    onError: (mutationError) => setError(toMessage(mutationError)),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('crop:editTitle')}
      footer={
        <Button
          onClick={() => {
            setError(null);
            save.mutate();
          }}
          isLoading={save.isPending}
          data-testid="crop-edit-save"
        >
          {t('common:action.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        {error && <Notice tone="danger">{error}</Notice>}

        <TextField
          label={t('crop:varietyLabel')}
          placeholder={t('crop:varietyPlaceholder')}
          value={variety}
          onChange={(event) => setVariety(event.target.value)}
          data-testid="crop-edit-variety"
        />

        <TextField
          label={t('crop:areaLabel')}
          type="number"
          step="0.01"
          min="0.01"
          inputMode="decimal"
          value={areaValue}
          onChange={(event) => setAreaValue(event.target.value)}
          data-testid="crop-edit-area"
        />

        <SelectField
          label={t('crop:statusLabel')}
          value={status}
          onChange={(event) => setStatus(event.target.value as CropWithStage['status'])}
          data-testid="crop-edit-status"
        >
          {CROP_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`agri:cropStatus.${value}`)}
            </option>
          ))}
        </SelectField>
      </div>
    </Modal>
  );
}

/**
 * What the published calendar says about the stage the crop is in.
 *
 * The design's "stage note" is a sentence of agronomic advice. Nothing in this
 * system publishes such a sentence — the registry carries stage *lengths* and
 * Kc values, not prose — and writing one here would be the UI inventing
 * agronomy (rule 7). So the card carries the facts the registry does hold: the
 * stage's window in days after sowing, its crop coefficient, and the seasons
 * the crop is grown in. A farmer can act on those; an invented sentence they
 * could not check is worse than none.
 */
function StageNote({ crop, registry }: { crop: CropWithStage; registry: RegistryCrop | null }) {
  const { t } = useTranslation(['crop', 'agri', 'common']);
  const { language } = useLanguage();
  const { stage } = crop;

  const hasWindow = stage.stage != null && stage.stageStartDay != null && stage.stageEndDay != null;
  const seasons = registry?.seasons ?? [];

  if (!hasWindow && stage.kc == null && seasons.length === 0) return null;

  return (
    <Card className="border-sky-700/20 bg-sky-tint p-5" data-testid="crop-stage-note">
      <span className="kicker text-sky-700">{t('crop:stageNoteHeading')}</span>

      {hasWindow && (
        <p className="mt-2 text-sm leading-relaxed text-sky-700">
          {t('crop:stageNoteWindow', {
            stage: t(`agri:stage.${stage.stage}`),
            from: stage.stageStartDay,
            to: stage.stageEndDay,
          })}
        </p>
      )}

      {stage.kc != null && (
        <p className="mt-2 text-sm text-sky-700">
          {t('crop:kcLabel')} {formatNumber(stage.kc, language, { maximumFractionDigits: 2 })}
        </p>
      )}

      {seasons.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {seasons.map((season) => (
            <Badge key={season} tone="info">
              {t(`agri:season.${season}`)}
            </Badge>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Photo ───────────────────────────────────────────────────────────────────

/**
 * Add/replace/remove the crop's own profile photo — distinct from a
 * crop-health diagnostic scan ("check a leaf"), which never touches this field.
 * Reuses `UploadDropzone` — the same interaction the health-scan and farm-photo
 * flows already use — rather than inventing a new upload surface.
 */
function CropPhotoModal({
  crop,
  open,
  onClose,
}: {
  crop: CropWithStage;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation(['crop', 'common']);
  const queryClient = useQueryClient();
  const toast = useToast();
  const toMessage = useApiErrorMessage();
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.crops.detail(crop.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.farms.detail(crop.farmId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
  };

  const upload = useMutation({
    mutationFn: (photo: File) => cropsApi.uploadPhoto(crop.id, photo),
    onSuccess: () => {
      invalidate();
      toast.push(t('common:action.done'));
      setPhotoFile(null);
      onClose();
    },
    onError: (error) => toast.push(toMessage(error), 'error'),
  });

  const remove = useMutation({
    mutationFn: () => cropsApi.removePhoto(crop.id),
    onSuccess: () => {
      invalidate();
      toast.push(t('common:action.done'));
      onClose();
    },
    onError: (error) => toast.push(toMessage(error), 'error'),
  });

  return (
    <Modal
      open={open}
      onClose={() => {
        setPhotoFile(null);
        onClose();
      }}
      title={t('crop:photoLabel')}
      footer={
        <>
          {crop.photoUrl && (
            <Button
              variant="danger"
              onClick={() => remove.mutate()}
              isLoading={remove.isPending}
              data-testid="crop-photo-remove"
            >
              {t('crop:photoRemoveCta')}
            </Button>
          )}
          <Button
            disabled={!photoFile}
            isLoading={upload.isPending}
            onClick={() => photoFile && upload.mutate(photoFile)}
            data-testid="crop-photo-save"
          >
            {t('common:action.save')}
          </Button>
        </>
      }
    >
      <UploadDropzone
        file={photoFile}
        onSelect={setPhotoFile}
        title={t('crop:photoTitle')}
        hint={t('crop:photoHint')}
        cta={t('crop:photoCta')}
        alt={t('crop:photoAlt')}
      />
    </Modal>
  );
}

// ── The full working, unchanged ─────────────────────────────────────────────

function IrrigationTab({ cropId }: { cropId: string }) {
  const { t } = useTranslation(['irrigation', 'common']);

  const query = useQuery({
    queryKey: queryKeys.crops.irrigation(cropId),
    queryFn: () => cropsApi.irrigation(cropId),
    staleTime: STALE_TIME.slowMoving,
  });

  return (
    <div className="space-y-6">
      <QueryBoundary query={query} loading={<SkeletonCard />}>
        {(advice) => <IrrigationVerdictCard advice={advice} />}
      </QueryBoundary>

      <Section title={t('irrigation:logTitle')} as="h3">
        <IrrigationLogForm cropId={cropId} />
      </Section>

      <Section title={t('irrigation:ledgerHeading')} as="h3">
        <IrrigationLedger cropId={cropId} />
      </Section>
    </div>
  );
}

function HealthTab({ cropId }: { cropId: string }) {
  const { t } = useTranslation(['health', 'common']);

  const query = useQuery({
    queryKey: queryKeys.health.logs(cropId, 1),
    queryFn: () => healthApi.logs({ cropId, page: 1, limit: 20 }),
  });

  return (
    <div className="space-y-4">
      <ButtonLink to={`/scan?cropId=${cropId}`} leadingIcon={<IconCamera size={18} />}>
        {t('health:scanTitle')}
      </ButtonLink>

      <QueryBoundary
        query={query}
        isEmpty={(data) => data.data.logs.length === 0}
        empty={<EmptyState title={t('health:historyEmpty')} />}
      >
        {(data) => <HealthLogList logs={data.data.logs} />}
      </QueryBoundary>
    </div>
  );
}

function FertilizerTab({ cropId }: { cropId: string }) {
  const query = useQuery({
    queryKey: queryKeys.crops.fertilizer(cropId),
    queryFn: () => cropsApi.fertilizer(cropId),
    staleTime: STALE_TIME.registry,
  });

  return (
    <QueryBoundary query={query} loading={<SkeletonCard />}>
      {(guidance) => <FertilizerGuidanceView guidance={guidance} />}
    </QueryBoundary>
  );
}

function MarketTab({ cropCode }: { cropCode: string }) {
  const { t } = useTranslation(['market', 'common']);

  const query = useQuery({
    queryKey: queryKeys.market.myCrops(30),
    queryFn: () => marketApi.myCrops({ days: 30 }),
    staleTime: STALE_TIME.slowMoving,
  });

  return (
    <div className="space-y-4">
      <QueryBoundary
        query={query}
        isEmpty={(data) => !data.data.crops.some((entry) => entry.cropCode === cropCode)}
        empty={<EmptyState title={t('market:noSignal')} />}
      >
        {(data) => (
          <div className="space-y-4">
            {data.data.crops
              .filter((entry) => entry.cropCode === cropCode)
              .map((entry) => (
                <MarketSignalCard key={entry.commodityCode} signal={entry} />
              ))}
            <Link
              to="/market"
              className="inline-block text-sm font-semibold text-brand-700 underline underline-offset-2"
            >
              {t('common:action.viewAll')}
            </Link>
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}
