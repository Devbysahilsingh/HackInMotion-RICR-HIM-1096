/**
 * The landing screen — "what should I do today".
 *
 * **One request.** `/dashboard` is contracted to be one aggregation with zero
 * external calls, and this screen honours that by rendering entirely from its
 * payload: no per-crop irrigation call, no per-farm weather call. Twelve crops
 * still cost one round trip, which is the difference between usable and not on
 * a rural connection.
 *
 * Order is by what changes behaviour: today's verdicts first, the crops they
 * are about second, the ways in to the other decisions third, and what the
 * platform itself cannot currently see last.
 *
 * This screen is also the only entry to "what should I plant?" and to the
 * community advisories — neither has a tab, and both would otherwise be
 * unreachable.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { queryKeys, STALE_TIME } from '@shared/client/queryKeys';
import type { DashboardResponse, FeedItem } from '@shared/types/api';

import { dashboardApi, recommendationsApi } from '../../api/endpoints';
import { QueryBoundary } from '../../components/QueryBoundary';
import { CropCard } from '../../components/domain/CropCard';
import { FeedItemCard } from '../../components/domain/FeedItemCard';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { SkeletonList } from '../../components/ui/Skeleton';
import { EmptyState, Notice } from '../../components/ui/states';
import { Text } from '../../components/ui/Text';
import {
  IconCheck,
  IconHistory,
  IconLeaf,
  IconPlus,
  IconSettings,
  IconUsers,
} from '../../components/ui/icons';
import { useApiErrorMessage } from '../../hooks/useApiError';
import type { HomeStackParamList, RootStackParamList } from '../../navigation/types';
import { PRESSED_OPACITY, TOUCH_TARGET, colors, radius, spacing } from '../../theme';
import { translateMessageKey } from '../../i18n/messageKey';

export function DashboardScreen() {
  const { t } = useTranslation(['common', 'mobile']);
  const navigation = useNavigation<NavigationProp<HomeStackParamList>>();

  const query = useQuery({
    queryKey: queryKeys.dashboard(),
    queryFn: dashboardApi.get,
    staleTime: STALE_TIME.dashboard,
  });

  return (
    <Screen
      onRefresh={() => void query.refetch()}
      refreshing={query.isRefetching}
      testID="dashboard-screen"
    >
      <View style={styles.header}>
        <Text variant="title" accessibilityRole="header" style={styles.headerTitle}>
          {t('common:greeting.title')}
        </Text>
        <View style={styles.headerActions}>
          <HeaderIconButton
            label={t('common:nav.history')}
            icon={<IconHistory size={24} color={colors.ink700} />}
            onPress={() => navigation.navigate('History')}
            testID="dashboard-history"
          />
          <HeaderIconButton
            label={t('common:nav.settings')}
            icon={<IconSettings size={24} color={colors.ink700} />}
            onPress={() => navigation.navigate('Settings')}
            testID="dashboard-settings"
          />
        </View>
      </View>

      <QueryBoundary
        query={query}
        loading={<SkeletonList count={4} />}
        loadingLabel={t('common:state.loading')}
      >
        {(data) => <DashboardContent data={data} />}
      </QueryBoundary>
    </Screen>
  );
}

/**
 * An icon-only control in the screen's own header bar.
 *
 * Local rather than a shared primitive: this screen draws its own header (the
 * navigator's is hidden), and `Button` is built around a text label — an icon
 * passed as its child would end up inside a `<Text>`, which Android renders
 * badly. The label still exists; it is spoken rather than drawn.
 */
function HeaderIconButton({
  label,
  icon,
  onPress,
  testID,
}: {
  label: string;
  icon: ReactNode;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [styles.iconButton, pressed && { opacity: PRESSED_OPACITY }]}
    >
      {icon}
    </Pressable>
  );
}

function DashboardContent({ data }: { data: DashboardResponse }) {
  const { t } = useTranslation(['common', 'farm', 'crop', 'mobile', 'cropRec', 'community']);
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const homeNavigation = useNavigation<NavigationProp<HomeStackParamList>>();
  const queryClient = useQueryClient();
  const toMessage = useApiErrorMessage();

  /**
   * Acknowledge.
   *
   * Optimistic, because the row disappearing the instant it is tapped is the
   * whole point of a "done" button on a feed — and because the endpoint is
   * idempotent (a second ack is another 204), so a replay after a lost response
   * is harmless. On failure the previous snapshot is restored and the farmer is
   * told, rather than the item silently reappearing later.
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

    onError: (_error, _item, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.dashboard(), context.previous);
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      // The item also lives in the history list, which now shows it as acked.
      void queryClient.invalidateQueries({ queryKey: queryKeys.recommendations.all() });
    },
  });

  // The API's designed onboarding payload for an account with no farms — not
  // an empty array dressed up as one.
  if (data.onboarding) {
    return (
      <EmptyState
        title={translateMessageKey(t, data.onboarding.stepKey)}
        icon={<IconLeaf size={32} color={colors.brand500} />}
        action={
          <Button
            onPress={() =>
              navigation.navigate('Main', {
                screen: 'FarmTab',
                params: { screen: 'FarmForm', params: {} },
              })
            }
            leadingIcon={<IconPlus size={18} color={colors.surface} />}
            testID="dashboard-onboarding-cta"
          >
            {translateMessageKey(t, data.onboarding.ctaKey)}
          </Button>
        }
        testID="dashboard-onboarding"
      />
    );
  }

  const pendingId = acknowledge.isPending ? acknowledge.variables?.id : undefined;

  return (
    <View style={styles.stack}>
      <View style={styles.section}>
        {data.feed.length === 0 ? (
          <EmptyState
            title={t('mobile:dashboard.feedEmptyTitle')}
            body={t('mobile:dashboard.feedEmptyBody')}
            icon={<IconCheck size={32} color={colors.brand500} />}
            testID="dashboard-feed-empty"
          />
        ) : (
          <View style={styles.list} testID="dashboard-feed">
            {data.feed.map((item) => (
              <FeedItemCard
                key={item.id}
                item={item}
                onAcknowledge={(entry) => acknowledge.mutate(entry)}
                isAcknowledging={pendingId === item.id}
              />
            ))}
          </View>
        )}

        {acknowledge.isError ? (
          <Notice tone="danger">
            <Text variant="small" color="ink700">
              {toMessage(acknowledge.error)}
            </Text>
          </Notice>
        ) : null}
      </View>

      <View style={styles.section}>
        <SectionHeader title={t('farm:cropsHeading')} />
        {data.cropCards.length === 0 ? (
          <EmptyState
            title={t('farm:cropsEmpty')}
            action={
              <Button
                onPress={() =>
                  navigation.navigate('Main', {
                    screen: 'FarmTab',
                    params: { screen: 'FarmList' },
                  })
                }
                leadingIcon={<IconPlus size={18} color={colors.surface} />}
              >
                {t('farm:addCropCta')}
              </Button>
            }
          />
        ) : (
          <View style={styles.list} testID="dashboard-crops">
            {data.cropCards.map((card) => (
              <CropCard key={card.cropId} card={card} />
            ))}
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Button
          variant="secondary"
          fullWidth
          onPress={() => homeNavigation.navigate('CropRecommendation', {})}
          leadingIcon={<IconLeaf size={20} color={colors.brand600} />}
          testID="dashboard-croprec"
        >
          {t('cropRec:pageTitle')}
        </Button>
        <Button
          variant="secondary"
          fullWidth
          onPress={() => homeNavigation.navigate('Community')}
          leadingIcon={<IconUsers size={20} color={colors.brand600} />}
          testID="dashboard-community"
        >
          {t('community:pageTitle')}
        </Button>
      </View>

      <SystemStatus status={data.systemStatus} />
    </View>
  );
}

/**
 * What the platform itself can and cannot currently see.
 *
 * Shown rather than hidden: a farmer looking at a market card built on archived
 * prices, or at a dashboard whose weather has never been fetched, is entitled
 * to know (rule 9).
 *
 * `systemStatus.ml` used to be hard-coded `'down'` in `feedService.js`, left
 * over from before Phase 3 shipped the service — so this notice appeared for
 * every farmer, permanently, whatever the service was doing. It is now derived
 * from configuration server-side: `down` only when an operator has pulled the
 * kill switch, `pending` when no service is wired up, `live` otherwise. What
 * is shown here is still exactly what the API said, never a nicer version of
 * it (rule 7).
 */
function SystemStatus({ status }: { status: DashboardResponse['systemStatus'] }) {
  const { t } = useTranslation(['common', 'weather', 'mobile']);

  const parts: string[] = [];

  if (status.weather === 'pending') {
    parts.push(`${t('weather:pageTitle')}: ${t('common:freshness.pending')}`);
  }
  if (status.market === 'pending') {
    parts.push(`${t('common:nav.market')}: ${t('common:freshness.pending')}`);
  }
  if (status.market === 'historical') {
    parts.push(`${t('common:nav.market')}: ${t('common:freshness.historical')}`);
  }
  if (status.ml === 'down') {
    parts.push(t('mobile:dashboard.mlDown'));
  }
  // Distinct from 'down': nothing has been deployed to reach, rather than a
  // service that exists and is refusing. Both mean the farmer cannot scan a
  // leaf right now, and both are worth saying.
  if (status.ml === 'pending') {
    parts.push(t('mobile:dashboard.mlPending'));
  }

  if (parts.length === 0) return null;

  return (
    <Notice tone="info" testID="system-status">
      <View style={styles.statusBody}>
        <Text variant="caption" color="ink500">
          {t('mobile:dashboard.systemStatusHeading')}
        </Text>
        {parts.map((part) => (
          <Text key={part} variant="small" color="ink700">
            {part}
          </Text>
        ))}
      </View>
    </Notice>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headerTitle: { flexShrink: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  iconButton: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
  },
  stack: { gap: spacing.xl },
  section: { gap: spacing.md },
  list: { gap: spacing.md },
  statusBody: { gap: spacing.xs },
});
