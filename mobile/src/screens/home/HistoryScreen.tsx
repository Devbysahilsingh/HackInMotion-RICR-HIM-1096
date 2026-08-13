/**
 * Photo-check history — the record of what this farmer sent and what came back.
 *
 * ## Only what the summary carries
 *
 * `GET /crop-health/logs` returns the *summary* projection
 * (`presentLog(..., {summary: true})`): six analysis fields and no more —
 * source, source label, disease code, confidence, severity and whether the
 * chain escalated. There is no recommendation, no freshness block and no
 * escalation path in a row, so none is rendered here. Reaching for a field the
 * list does not send would produce a blank that reads as "no severity" rather
 * than "not on this screen".
 *
 * Two of the six are deliberately not shown. `confidence` is a bare number
 * whose meaning is a *band*, and `health:confidenceNotProbability` exists
 * precisely because showing it raw invites reading it as a probability;
 * `escalated` is a fact about the pipeline, not about the crop. Both are on the
 * detail screen, in context.
 *
 * ## Names
 *
 * A row must say "Tomato" and "Late blight", never `TOMATO_LATE_BLIGHT`. The
 * summary carries neither name: crop names live in the registry (public,
 * cached seven days, prefetched at login) and disease names live in that same
 * registry's `diseases[].names`. The crop code is recovered from the disease
 * code's own prefix, exactly as the web's `DiseaseName` does — the registry
 * roster is `CHILLI`, `COTTON`, `MAIZE`, `POTATO`, `RICE`, `TOMATO`, and every
 * disease code is `<CROP>_<CONDITION>`. When there is no disease code there is
 * nothing to derive from, and the row simply omits the crop rather than
 * guessing at one.
 */
import { useCallback } from 'react';
import { FlatList, Image, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import { formatDateTime, localizedName } from '@shared/client/format';
import { queryKeys, STALE_TIME } from '@shared/client/queryKeys';
import type { HealthLogSummary, RegistryCrop, SeverityLevel } from '@shared/types/api';

import { healthApi, registryApi } from '../../api/endpoints';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { IconChevronRight } from '../../components/ui/icons';
import { Screen } from '../../components/ui/Screen';
import { SkeletonList } from '../../components/ui/Skeleton';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/states';
import { Text } from '../../components/ui/Text';
import { titleCaseCode, useCropNames } from '../../hooks/useCropNames';
import { translateMessageKey } from '../../i18n/messageKey';
import { useLanguage } from '../../store/LanguageContext';
import type { HomeStackParamList } from '../../navigation/types';
import { colors, radius, spacing } from '../../theme';

const PAGE_SIZE = 20;

/**
 * Sits under the `health` prefix so the ordinary
 * `invalidateQueries(queryKeys.health.all())` after a new analysis drops it
 * too, without the shared key registry needing an infinite-scroll variant that
 * only this surface uses.
 */
const HISTORY_KEY = [...queryKeys.health.all(), 'logs', 'infinite'] as const;

type Navigation = NativeStackNavigationProp<HomeStackParamList>;

export function HistoryScreen() {
  const { t } = useTranslation(['common', 'health', 'mobile']);
  const navigation = useNavigation<Navigation>();

  const query = useInfiniteQuery({
    queryKey: HISTORY_KEY,
    queryFn: ({ pageParam }) => healthApi.logs({ page: pageParam, limit: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((count, page) => count + page.data.logs.length, 0);
      const total = lastPage.meta.total;
      // A missing total must not dead-end the list: a full page is read as
      // "there may be more", an under-full one as the end.
      if (total != null) return loaded < total ? allPages.length + 1 : undefined;
      return lastPage.data.logs.length === PAGE_SIZE ? allPages.length + 1 : undefined;
    },
  });

  const { data, error, isPending, isFetching, isFetchingNextPage, hasNextPage, refetch } = query;
  const logs = data?.pages.flatMap((page) => page.data.logs) ?? [];

  const renderItem = useCallback(
    ({ item }: { item: HealthLogSummary }) => (
      <HistoryRow
        log={item}
        onPress={() => navigation.navigate('HistoryDetail', { logId: item.id })}
      />
    ),
    [navigation],
  );

  if (isPending) {
    return (
      <Screen edges={['left', 'right']}>
        <LoadingState skeleton={<SkeletonList />} label={t('common:state.loading')} />
      </Screen>
    );
  }

  // Nothing cached and the fetch failed — the only case where an error page is
  // more useful than stale rows.
  if (error && logs.length === 0) {
    return (
      <Screen edges={['left', 'right']}>
        <ErrorState error={error} onRetry={() => void refetch()} testID="history-error" />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} edges={['left', 'right']} testID="history-screen">
      {error ? (
        // Cached rows are worth more than an error page; they are just not
        // fresh, and saying so is the honest form of that (ADR-008).
        <Text variant="caption" color="ink500">
          {t('common:state.showingCached')}
        </Text>
      ) : null}

      <FlatList
        data={logs}
        keyExtractor={(log) => log.id}
        renderItem={renderItem}
        // The list owns the scroll (`Screen scroll={false}`), so it needs the
        // bounded height a flex child gets — without it the rows run off the
        // bottom instead of scrolling.
        style={styles.fill}
        contentContainerStyle={styles.list}
        refreshing={isFetching && !isFetchingNextPage}
        onRefresh={() => void refetch()}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) void query.fetchNextPage();
        }}
        ListEmptyComponent={
          <EmptyState
            title={t('mobile:history.emptyTitle')}
            body={t('mobile:history.emptyBody')}
            testID="history-empty"
          />
        }
        ListFooterComponent={
          isFetchingNextPage ? <LoadingState label={t('common:state.loading')} /> : null
        }
        testID="history-list"
      />
    </Screen>
  );
}

function HistoryRow({ log, onPress }: { log: HealthLogSummary; onPress: () => void }) {
  const { t } = useTranslation(['common', 'health']);
  const { language } = useLanguage();
  const cropName = useCropNames();

  const cropCode = cropCodeOf(log.analysis.diseaseCode);
  const crop = cropCode ? cropName(cropCode) : null;
  const disease = useDiseaseName(log.analysis.diseaseCode, cropCode);
  const when = formatDateTime(log.createdAt, language);
  const sourceLabel = log.analysis.sourceLabelKey
    ? translateMessageKey(t, log.analysis.sourceLabelKey)
    : null;

  return (
    <Card
      onPress={onPress}
      padded={false}
      accessibilityLabel={[disease, crop, when].filter(Boolean).join('. ')}
      testID="history-row"
    >
      <View style={styles.row}>
        {log.imageUrl ? (
          <Image
            source={{ uri: log.imageUrl }}
            style={styles.thumb}
            accessibilityLabel={t('health:photoAlt')}
          />
        ) : null}

        <View style={styles.rowBody}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {disease}
          </Text>
          {crop ? (
            <Text variant="caption" color="ink500">
              {crop}
            </Text>
          ) : null}
          <Text variant="caption" color="ink500">
            {when}
          </Text>
          <View style={styles.tags}>
            {sourceLabel ? <Badge tone="brand">{sourceLabel}</Badge> : null}
            {log.analysis.severityAssessment ? (
              <Badge tone={log.analysis.severityAssessment === 'SEVERE' ? 'danger' : 'neutral'}>
                {t(severityKey(log.analysis.severityAssessment))}
              </Badge>
            ) : null}
          </View>
        </View>

        <IconChevronRight size={20} color={colors.ink500} />
      </View>
    </Card>
  );
}

/**
 * A disease's display name, from the registry document the login prefetch has
 * usually already put in the cache.
 *
 * `retry: false` because a code the registry does not carry is not an error
 * worth a banner — the code's own readable form is a usable fallback, and an
 * invented Hindi name would be worse than an English one (CLAUDE.md rule 8).
 */
function useDiseaseName(diseaseCode: string | null, cropCode: string | null): string {
  const { t } = useTranslation('health');
  const { language } = useLanguage();

  const { data } = useQuery({
    queryKey: queryKeys.registry.crop(cropCode ?? ''),
    queryFn: () => registryApi.get(cropCode ?? ''),
    enabled: Boolean(cropCode) && Boolean(diseaseCode) && diseaseCode !== 'UNKNOWN',
    staleTime: STALE_TIME.registry,
    retry: false,
  });

  if (!diseaseCode || diseaseCode === 'UNKNOWN') return t('diseaseUnknownName');

  const registry = data?.crop as RegistryCrop | undefined;
  const entry = registry?.diseases?.find((disease) => disease.code === diseaseCode);
  return localizedName(entry?.names ?? null, language)?.text ?? titleCaseCode(diseaseCode);
}

/** `TOMATO_LATE_BLIGHT` → `TOMATO`. Null when there is nothing to derive from. */
function cropCodeOf(diseaseCode: string | null): string | null {
  if (!diseaseCode || diseaseCode === 'UNKNOWN') return null;
  const prefix = diseaseCode.split('_')[0];
  return prefix && prefix !== diseaseCode ? prefix : null;
}

/** `SEVERE` → `health:severitySevere`, matching the key spelling. */
const severityKey = (level: SeverityLevel): string =>
  `health:severity${level
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')}`;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { gap: spacing.md, paddingBottom: spacing.xxl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.canvas,
  },
  rowBody: { flex: 1, gap: 2 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
});
