import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { dashboardApi, recommendationsApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import type { CropCard, DashboardResponse, Farm, FeedItem } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { useActiveFarm } from '@/farm/ActiveFarmContext';
import { QueryBoundary } from '@/components/QueryBoundary';
import { CropCardTile } from '@/components/domain/CropCardTile';
import { DashboardMarketCard } from '@/components/domain/DashboardMarketCard';
import { DashboardYieldCard } from '@/components/domain/DashboardYieldCard';
import { DashboardWeatherCard } from '@/components/domain/DashboardWeatherCard';
import { DecisionBanner } from '@/components/domain/DecisionBanner';
import { FeedItemCard } from '@/components/domain/FeedItemCard';
import { PageHeader } from '@/components/layout/AppLayout';
import { Badge } from '@/components/ui/Badge';
import { ButtonLink } from '@/components/ui/Button';
import { Card, Section } from '@/components/ui/Card';
import { KeyValueList, KeyValueRow } from '@/components/ui/KeyValueRow';
import { SkeletonList } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { EmptyState, Notice } from '@/components/ui/states';
import { IconDroplet, IconLeaf, IconPlus } from '@/components/ui/icons';
import { useApiErrorMessage } from '@/hooks/useApiError';
import { useLanguage } from '@/i18n/LanguageContext';
import { translateMessageKey } from '@/i18n/messageKey';
import { feedForFarm } from '@/lib/feedScope';
import { formatDate, formatNumber } from '@/lib/format';

/**
 * The landing page (routes.md: "THE landing page").
 *
 * One request. `/dashboard` is contracted to be "one aggregation, zero
 * external calls", and this page honours that by rendering entirely from its
 * payload — no per-crop irrigation call, no per-farm weather call.
 */
export default function DashboardPage() {
  const { t } = useTranslation(['common', 'farm', 'crop']);
  const { user } = useAuth();
  const { language } = useLanguage();

  const query = useQuery({
    queryKey: queryKeys.dashboard(),
    queryFn: dashboardApi.get,
    staleTime: STALE_TIME.dashboard,
  });

  /*
   * The design greets the farmer by name and dates the page — "Good morning,
   * Ramesh · Thursday, 13 August". Both are local facts (the clock and the
   * signed-in account), so they need no data from the request and the heading
   * can render before the feed arrives rather than popping in after it.
   *
   * It stays a `PageHeader` because that is what moves focus to the title and
   * sets the document title on every navigation (accessibility.md). Styling the
   * greeting as a bare `<h1>` here would have quietly dropped both.
   */
  const greeting = t(`common:greeting.${timeOfDay()}`, { name: user?.name ?? '' });

  return (
    <>
      <PageHeader
        title={greeting}
        description={formatDate(new Date(), language, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })}
        actions={
          <>
            {/* History has no bottom tab, so its mobile entry lives here. */}
            <ButtonLink to="/history" variant="ghost">
              {t('common:nav.history')}
            </ButtonLink>
            <ButtonLink to="/scan" variant="secondary">
              {t('common:nav.scan')}
            </ButtonLink>
          </>
        }
      />

      <QueryBoundary
        query={query}
        loading={<SkeletonList count={4} />}
        loadingLabel={t('common:state.loading')}
      >
        {(data) => <DashboardContent data={data} />}
      </QueryBoundary>
    </>
  );
}

function DashboardContent({ data }: { data: DashboardResponse }) {
  const { t } = useTranslation(['common', 'farm', 'crop']);
  const queryClient = useQueryClient();
  const toast = useToast();
  const toMessage = useApiErrorMessage();
  const { activeFarmId, activeFarm, isLoading: farmsLoading } = useActiveFarm();

  /**
   * Acknowledge.
   *
   * Optimistic, because the row disappearing the instant it is tapped is the
   * whole point of a "done" button on a feed — and because the endpoint is
   * idempotent (a second ack is another 204), so a replay after a lost
   * response is harmless. On failure the previous snapshot is restored and the
   * farmer is told, rather than the item silently reappearing later.
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
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.dashboard(), context.previous);
      }
      toast.push(toMessage(error), 'error');
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      // The item also lives in the history list, which now shows it as acked.
      void queryClient.invalidateQueries({ queryKey: queryKeys.recommendations.all() });
    },
  });

  // The API's designed onboarding payload for an account with no farms —
  // not an empty array dressed up as one.
  if (data.onboarding) {
    return (
      <EmptyState
        title={translateMessageKey(t, data.onboarding.stepKey)}
        action={
          <ButtonLink to="/farms/new" leadingIcon={<IconPlus size={18} />}>
            {translateMessageKey(t, data.onboarding.ctaKey)}
          </ButtonLink>
        }
      />
    );
  }

  const pendingId = acknowledge.isPending ? acknowledge.variables?.id : undefined;

  // The farm list itself is a separate request from `/dashboard` (the
  // sidebar's global selection state, shared with every other farm-scoped
  // screen). `data.onboarding` above already proved at least one farm exists
  // for this account, so a still-null id here means that second request has
  // not resolved yet — a brief loading state, not an empty account.
  if (!activeFarmId || !activeFarm || farmsLoading) {
    return <SkeletonList count={4} />;
  }

  // Everything below is scoped to the farm currently selected in the
  // sidebar. `/dashboard` itself stays account-wide (rule 3: one aggregation,
  // no per-farm request) — the split happens here, in memory, over the
  // payload it already returned, using the `farmId`/`cropId` every feed item
  // and crop card already carries.
  const farmCropCards = data.cropCards.filter((card) => card.farmId === activeFarmId);
  const farmCropIds = new Set(farmCropCards.map((card) => card.cropId));
  const farmCropCodes = new Set(farmCropCards.map((card) => card.cropCode));

  /*
   * The same narrowing the farm and crop screens apply, from one place
   * (`lib/feedScope.ts`) — three surfaces disagreeing about whether an item
   * belongs to the selected farm is exactly the drift a shared helper prevents.
   */
  const farmFeed = feedForFarm(data.feed, {
    farmId: activeFarmId,
    cropIds: farmCropIds,
    cropCodes: farmCropCodes,
  });

  /*
   * The feed's first item is the day's decision and gets the banner; the rest
   * stay as cards beneath it.
   *
   * Splitting here rather than in a component keeps the ranking where it
   * belongs — the API already returns the feed in priority order
   * (`feedComposer.js`), so "most important" is its judgement, not the UI's.
   * Reordering client-side would put an agronomic decision in React.
   */
  const [lead, ...rest] = farmFeed;

  /*
   * The design's right-hand column opens with an "Attention" card. It is the
   * next-most-urgent item after the one in the band — not a separate concept,
   * so it comes off the same priority-ordered feed rather than being computed.
   */
  const [attention, ...remaining] = rest;

  const location = [activeFarm.location.district, activeFarm.location.state]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="space-y-5">
      <FreshnessTags status={data.systemStatus} />

      {lead ? (
        <DecisionBanner
          item={lead}
          onAcknowledge={(entry) => acknowledge.mutate(entry)}
          isAcknowledging={pendingId === lead.id}
        />
      ) : (
        <NeutralDecisionBand />
      )}

      {/*
        The design's `.split` — 1.65fr of evidence against 1fr of context. It
        collapses to one column below 1240px, where two columns would leave the
        crop tiles too narrow to carry a name and a status side by side.
      */}
      <div className="grid items-start gap-5 xl:grid-cols-[1.65fr_1fr]">
        <div className="flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            <DashboardWeatherCard farmId={activeFarmId} location={location} crops={farmCropCards} />
            <WaterSummaryCard cards={farmCropCards} />
            <DashboardMarketCard farmId={activeFarmId} cropCodes={[...farmCropCodes]} />
            {/*
              Account-wide rather than farm-scoped, unlike its three neighbours:
              the harvest estimate depends on each crop's own district and area,
              and a farmer planning a season thinks about the whole holding. It
              spans the row on wide screens so the range has room to be read at
              display scale.
            */}
            <DashboardYieldCard />
          </div>

          <Section
            title={t('farm:cropsHeading')}
            as="h2"
            action={
              <ButtonLink to={`/farms/${activeFarmId}`} variant="ghost" size="md">
                {t('common:nav.farms')}
              </ButtonLink>
            }
          >
            {farmCropCards.length === 0 ? (
              <EmptyState
                title={t('farm:cropsEmpty')}
                action={
                  <ButtonLink to={`/farms/${activeFarmId}`} leadingIcon={<IconPlus size={18} />}>
                    {t('farm:addCropCta')}
                  </ButtonLink>
                }
              />
            ) : (
              <div
                className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
                data-testid="dashboard-crops"
              >
                {farmCropCards.map((card) => (
                  <CropCardTile key={card.cropId} card={card} />
                ))}
              </div>
            )}
          </Section>

          {/*
            The rest of the feed sits under the crops, inside the wide column,
            rather than in a band beneath the whole split. Below the split it
            left a tall gap next to the taller right-hand column and read as a
            separate, orphaned section; here it continues the same column of
            evidence the crops are already in.
          */}
          {remaining.length > 0 && (
            <div className="grid gap-4 lg:grid-cols-2">
              {remaining.map((item) => (
                <FeedItemCard
                  key={item.id}
                  item={item}
                  onAcknowledge={(entry) => acknowledge.mutate(entry)}
                  isAcknowledging={pendingId === item.id}
                />
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-5">
          {attention && (
            <FeedItemCard
              item={attention}
              tone="attention"
              onAcknowledge={(entry) => acknowledge.mutate(entry)}
              isAcknowledging={pendingId === attention.id}
            />
          )}
          <HealthSummaryCard cards={farmCropCards} />
          <FarmGlanceCard farm={activeFarm} cropCount={farmCropCards.length} />
        </div>
      </div>

      <SystemStatus status={data.systemStatus} />
    </div>
  );
}

/**
 * Which part of the day it is, for the greeting.
 *
 * Local clock, deliberately: this is a courtesy, not a data point, and the
 * boundaries are the ordinary English ones. Kept module-private — a page file
 * that also exports a plain function breaks Fast Refresh.
 */
function timeOfDay(now: Date = new Date()): 'morning' | 'afternoon' | 'evening' {
  const hour = now.getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

/**
 * The freshness row the design puts beside the greeting — *Weather 40 min ago ·
 * Mandi 2 days old*.
 *
 * Rule 9 in one line: the farmer learns how old the numbers behind the page are
 * before reading the page. `systemStatus` is the API's own account of what it
 * could see, so nothing is inferred here.
 */
function FreshnessTags({ status }: { status: DashboardResponse['systemStatus'] }) {
  const { t } = useTranslation(['common', 'weather']);

  const TONE = {
    live: 'success',
    cached: 'warning',
    historical: 'earth',
    pending: 'neutral',
  } as const;

  return (
    <div className="flex flex-wrap gap-2" data-testid="freshness-tags">
      <Badge tone={TONE[status.weather]}>
        {t('weather:pageTitle')} · {t(`common:freshness.${status.weather}`)}
      </Badge>
      <Badge tone={TONE[status.market]}>
        {t('common:nav.market')} · {t(`common:freshness.${status.market}`)}
      </Badge>
    </div>
  );
}

/**
 * How many crops want water today.
 *
 * The design's dashboard shows a live weather card here. `/dashboard` is
 * contracted to be one aggregation with zero external calls, and its payload
 * carries no temperature or forecast — so rather than firing a second request
 * from the page (and undoing that contract on the 2G link this is built for),
 * the slot answers the same underlying question from data that *is* present:
 * the per-crop irrigation verdict the engine already decided.
 *
 * It is the design's composition with this system's honest content.
 */
function WaterSummaryCard({ cards }: { cards: CropCard[] }) {
  const { t } = useTranslation('common');

  const thirsty = cards.filter(
    (card) =>
      card.irrigationVerdict === 'IRRIGATE_TODAY' ||
      card.irrigationVerdict === 'IRRIGATE_IN_N_DAYS',
  );

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="kicker">{t('dashboard.waterTitle')}</span>
        <IconDroplet size={18} className="text-sky-700" />
      </div>
      <p className="mt-3.5 font-display text-[2.75rem] font-extrabold leading-none tracking-[-0.04em]">
        {thirsty.length}
      </p>
      <p className="mt-2 text-sm text-ink-500">
        {thirsty.length === 0
          ? t('dashboard.waterNone')
          : t('dashboard.waterNeed', { count: thirsty.length })}
      </p>
    </Card>
  );
}

/** Crops the health chain has flagged, straight off the card's `healthFlag`. */
function HealthSummaryCard({ cards }: { cards: CropCard[] }) {
  const { t } = useTranslation('common');

  const flagged = cards.filter((card) => card.healthFlag);

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <span className="kicker">{t('dashboard.healthTitle')}</span>
        <IconLeaf size={18} className="text-leaf-600" />
      </div>
      <p className="mt-3 text-sm text-ink-500">
        {flagged.length === 0
          ? t('dashboard.healthClear')
          : t('dashboard.healthFlagged', { count: flagged.length })}
      </p>
      <ButtonLink to="/scan" variant="secondary" fullWidth className="mt-4">
        {t('nav.scan')}
      </ButtonLink>
    </Card>
  );
}

/**
 * The design's "Farm at a glance" panel, scoped to the farm currently
 * selected in the sidebar.
 *
 * Every field here is a real property of the `Farm` record itself — the same
 * fields the farm's own detail screen shows — so nothing is fetched again to
 * build it. There is deliberately no "nearest mandi · N km" row: no mandi
 * coordinates exist anywhere in this system (`marketService.js` —
 * "Agmarknet publishes none"), and `FarmDetailPage` already resolved this
 * exact question by dropping the distance rather than inventing one; this
 * panel keeps that same answer instead of re-introducing the fabrication.
 */
function FarmGlanceCard({ farm, cropCount }: { farm: Farm; cropCount: number }) {
  const { t } = useTranslation(['common', 'agri']);
  const { language } = useLanguage();

  return (
    <Card className="p-5" data-testid="farm-glance">
      <span className="kicker">{farm.name}</span>
      <KeyValueList className="mt-2">
        <KeyValueRow
          label={t('dashboard.glanceArea')}
          value={`${formatNumber(farm.sizeValue, language)} ${t(`unit.${farm.sizeUnit}`)}`}
        />
        <KeyValueRow label={t('dashboard.glanceCrops')} value={cropCount} />
        <KeyValueRow label={t('dashboard.glanceSoil')} value={t(`agri:soil.${farm.soilType}`)} />
        <KeyValueRow
          label={t('dashboard.glanceWater')}
          value={t(`agri:irrigationMethod.${farm.irrigationMethod}`)}
        />
      </KeyValueList>
    </Card>
  );
}

/**
 * The neutral fallback for the top decision band, when this farm's feed is
 * empty — the everyday case for a newly-added farm, or one whose engines have
 * nothing urgent to say today. Sized and placed like the real
 * `DecisionBanner` rather than the small dashed `EmptyState`, so an ordinary
 * day never reads as a broken page (the reported bug this replaces).
 */
function NeutralDecisionBand() {
  const { t } = useTranslation('common');

  return (
    <section
      data-testid="decision-band-neutral"
      className="rounded-[18px] border border-leaf-500/25 bg-leaf-tint/50 px-5 py-6 sm:px-[30px] sm:py-7"
    >
      <span
        aria-hidden="true"
        className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/70 text-leaf-700"
      >
        <IconLeaf size={22} />
      </span>
      <h2 className="mt-3.5 max-w-3xl text-[1.5rem] leading-[1.1] text-ink-900 sm:text-[1.875rem]">
        {t('dashboard.todayNeutralTitle')}
      </h2>
      <p className="mt-2 max-w-[52ch] text-sm text-ink-700 sm:text-base">
        {t('dashboard.todayNeutralBody')}
      </p>
    </section>
  );
}

/**
 * What the platform itself can and cannot currently see.
 *
 * Shown rather than hidden: a farmer looking at a market card built on
 * archived prices, or at a dashboard whose weather has never been fetched,
 * is entitled to know (rule 9). `ml: 'down'` is reported honestly by the API
 * when the service is not reachable, and is not dressed up here.
 */
function SystemStatus({ status }: { status: DashboardResponse['systemStatus'] }) {
  const { t } = useTranslation(['common', 'weather']);

  const degraded =
    status.weather === 'pending' || status.market === 'pending' || status.market === 'historical';

  if (!degraded) return null;

  const parts: string[] = [];
  if (status.weather === 'pending')
    parts.push(`${t('weather:pageTitle')}: ${t('common:freshness.pending')}`);
  if (status.market === 'historical')
    parts.push(`${t('common:nav.market')}: ${t('common:freshness.historical')}`);
  if (status.market === 'pending')
    parts.push(`${t('common:nav.market')}: ${t('common:freshness.pending')}`);

  return (
    <Notice tone="info" data-testid="system-status">
      {parts.join(' · ')}
    </Notice>
  );
}
