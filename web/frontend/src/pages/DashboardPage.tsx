import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { dashboardApi, recommendationsApi } from '@/api/endpoints';
import { queryKeys, STALE_TIME } from '@/api/queryKeys';
import type { DashboardResponse, FeedItem } from '@/api/types';
import { QueryBoundary } from '@/components/QueryBoundary';
import { CropCardTile } from '@/components/domain/CropCardTile';
import { DecisionBanner } from '@/components/domain/DecisionBanner';
import { FarmSummaryStrip } from '@/components/domain/FarmSummaryStrip';
import { FeedItemCard } from '@/components/domain/FeedItemCard';
import { PageHeader } from '@/components/layout/AppLayout';
import { ButtonLink } from '@/components/ui/Button';
import { Section } from '@/components/ui/Card';
import { SkeletonList } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { EmptyState, Notice } from '@/components/ui/states';
import { IconPlus } from '@/components/ui/icons';
import { useApiErrorMessage } from '@/hooks/useApiError';
import { translateMessageKey } from '@/i18n/messageKey';

/**
 * The landing page (routes.md: "THE landing page").
 *
 * One request. `/dashboard` is contracted to be "one aggregation, zero
 * external calls", and this page honours that by rendering entirely from its
 * payload — no per-crop irrigation call, no per-farm weather call.
 */
export default function DashboardPage() {
  const { t } = useTranslation(['common', 'farm', 'crop']);

  const query = useQuery({
    queryKey: queryKeys.dashboard(),
    queryFn: dashboardApi.get,
    staleTime: STALE_TIME.dashboard,
  });

  return (
    <>
      <PageHeader
        title={t('common:nav.dashboard')}
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

  /*
   * The feed's first item is the day's decision and gets the banner; the rest
   * stay as cards beneath it.
   *
   * Splitting here rather than in a component keeps the ranking where it
   * belongs — the API already returns the feed in priority order
   * (`feedComposer.js`), so "most important" is its judgement, not the UI's.
   * Reordering client-side would put an agronomic decision in React.
   */
  const [lead, ...rest] = data.feed;

  return (
    <div className="space-y-8">
      <Section title={t('common:greeting.title')} as="h2">
        {data.feed.length === 0 ? (
          <EmptyState title={t('common:state.empty')} />
        ) : (
          <div className="space-y-4" data-testid="dashboard-feed">
            {lead && (
              <DecisionBanner
                item={lead}
                onAcknowledge={(entry) => acknowledge.mutate(entry)}
                isAcknowledging={pendingId === lead.id}
              />
            )}

            {rest.length > 0 && (
              <div className="grid gap-3 lg:grid-cols-2">
                {rest.map((item) => (
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
        )}
      </Section>

      <FarmSummaryStrip summary={data.farmSummary} />

      <Section
        title={t('farm:cropsHeading')}
        as="h2"
        action={
          <ButtonLink to="/farms" variant="ghost" size="md">
            {t('common:nav.farms')}
          </ButtonLink>
        }
      >
        {data.cropCards.length === 0 ? (
          <EmptyState
            title={t('farm:cropsEmpty')}
            action={
              <ButtonLink to="/farms" leadingIcon={<IconPlus size={18} />}>
                {t('farm:addCropCta')}
              </ButtonLink>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="dashboard-crops">
            {data.cropCards.map((card) => (
              <CropCardTile key={card.cropId} card={card} />
            ))}
          </div>
        )}
      </Section>

      <SystemStatus status={data.systemStatus} />
    </div>
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
