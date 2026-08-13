/**
 * One recommendation, in full.
 *
 * ## Why this screen refetches nothing of its own
 *
 * **There is no `GET /recommendations/:id`.** `backend/src/routes/dashboard.js`
 * exposes exactly two reads — the live feed inside `/dashboard`, and the paged
 * `/recommendations` history — plus the `:id/ack` write. So this screen finds
 * its item in those two payloads rather than inventing an endpoint, and both
 * are already in the cache on the common path (the farmer just tapped the item
 * on one of them).
 *
 * The honest consequence: an item older than the first page of history cannot
 * be found, and the screen says that rather than spinning. Paging backwards to
 * hunt for it would be many round trips on a connection that cannot spare them,
 * for a row the farmer can reach from the history list itself.
 */
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { RouteProp } from '@react-navigation/native';
import { useRoute } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { formatDateTime, formatPercent } from '@shared/client/format';
import { queryKeys, STALE_TIME } from '@shared/client/queryKeys';
import type { FeedItem } from '@shared/types/api';

import { dashboardApi, recommendationsApi } from '../../api/endpoints';
import { FeedItemCard } from '../../components/domain/FeedItemCard';
import { Card } from '../../components/ui/Card';
import { Screen } from '../../components/ui/Screen';
import { SkeletonList } from '../../components/ui/Skeleton';
import { EmptyState, ErrorState, LoadingState, Notice } from '../../components/ui/states';
import { Text } from '../../components/ui/Text';
import { IconHistory } from '../../components/ui/icons';
import { useApiErrorMessage } from '../../hooks/useApiError';
import type { HomeStackParamList } from '../../navigation/types';
import { useLanguage } from '../../store/LanguageContext';
import { colors, spacing } from '../../theme';

const HISTORY_PAGE = 1;

export function RecommendationDetailScreen() {
  const { t } = useTranslation(['common', 'mobile', 'health']);
  const { language } = useLanguage();
  const route = useRoute<RouteProp<HomeStackParamList, 'RecommendationDetail'>>();
  const queryClient = useQueryClient();
  const toMessage = useApiErrorMessage();

  const { recommendationId } = route.params;

  const dashboardQuery = useQuery({
    queryKey: queryKeys.dashboard(),
    queryFn: dashboardApi.get,
    staleTime: STALE_TIME.dashboard,
  });

  const historyQuery = useQuery({
    queryKey: queryKeys.recommendations.history(HISTORY_PAGE),
    queryFn: () => recommendationsApi.history({ page: HISTORY_PAGE }),
    staleTime: STALE_TIME.interactive,
  });

  const acknowledge = useMutation({
    mutationFn: (item: FeedItem) => recommendationsApi.acknowledge(item.id),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.recommendations.all() });
    },
  });

  const loading = dashboardQuery.isPending || historyQuery.isPending;
  const failed = dashboardQuery.isError && historyQuery.isError;

  const item = findItem(
    recommendationId,
    dashboardQuery.data?.feed,
    historyQuery.data?.data.recommendations,
  );

  return (
    <Screen
      onRefresh={() => {
        void dashboardQuery.refetch();
        void historyQuery.refetch();
      }}
      refreshing={dashboardQuery.isRefetching || historyQuery.isRefetching}
      testID="recommendation-detail"
    >
      {loading ? (
        <LoadingState skeleton={<SkeletonList count={2} />} />
      ) : failed ? (
        <ErrorState
          error={dashboardQuery.error ?? historyQuery.error}
          onRetry={() => {
            void dashboardQuery.refetch();
            void historyQuery.refetch();
          }}
        />
      ) : !item ? (
        <EmptyState
          title={t('mobile:recommendation.notFoundTitle')}
          body={t('mobile:recommendation.notFoundBody')}
          icon={<IconHistory size={32} color={colors.brand500} />}
          testID="recommendation-missing"
        />
      ) : (
        <View style={styles.stack}>
          <FeedItemCard
            item={item}
            onAcknowledge={(entry) => acknowledge.mutate(entry)}
            isAcknowledging={acknowledge.isPending}
          />

          {acknowledge.isError ? (
            <Notice tone="danger">
              <Text variant="small" color="ink700">
                {toMessage(acknowledge.error)}
              </Text>
            </Notice>
          ) : null}

          <Card>
            <View style={styles.meta}>
              <MetaRow
                label={t('mobile:recommendation.createdAt')}
                value={formatDateTime(item.createdAt, language)}
              />
              <MetaRow
                label={t('mobile:recommendation.validUntil')}
                value={formatDateTime(item.validUntil, language)}
              />
              {item.acknowledgedAt ? (
                <MetaRow
                  label={t('mobile:recommendation.acknowledgedAt')}
                  value={formatDateTime(item.acknowledgedAt, language)}
                />
              ) : null}

              {/*
                Confidence rides on the live feed only — the history projection
                drops it (`recommendationsRouter.get('/')`). Shown when present,
                and labelled as a band rather than a measured probability.
              */}
              {item.confidence != null ? (
                <>
                  <MetaRow
                    label={t('health:confidenceHeading')}
                    value={formatPercent(item.confidence * 100, language, 0)}
                  />
                  <Text variant="caption" color="ink500">
                    {t('health:confidenceNotProbability')}
                  </Text>
                </>
              ) : null}
            </View>
          </Card>
        </View>
      )}
    </Screen>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <Text variant="small" color="ink500" style={styles.flexText}>
        {label}
      </Text>
      <Text variant="small" color="ink900">
        {value}
      </Text>
    </View>
  );
}

/**
 * The live feed wins over history: it is the only projection carrying
 * `confidence`, and it is the one the farmer was just looking at. A history row
 * is widened with an explicit null rather than left short of the field.
 */
function findItem(
  id: string,
  feed: FeedItem[] | undefined,
  history: Omit<FeedItem, 'confidence'>[] | undefined,
): FeedItem | null {
  const live = feed?.find((entry) => entry.id === id);
  if (live) return live;

  const archived = history?.find((entry) => entry.id === id);
  return archived ? { ...archived, confidence: null } : null;
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  meta: { gap: spacing.sm },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  flexText: { flexShrink: 1 },
});
