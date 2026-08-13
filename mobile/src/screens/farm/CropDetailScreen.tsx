/**
 * One crop: what it is, how far along it is, and what we do not know about it.
 *
 * This screen is deliberately honest before it is useful. The support level,
 * the missing Hindi name and the registry's own `dataGaps` are stated in the
 * header rather than discovered card by card — a crop outside the knowledge
 * base gets a field record and little else, and letting a farmer find that out
 * one empty panel at a time would waste their time (CLAUDE.md rule 9).
 *
 * The scan action jumps tabs rather than pushing a camera into this stack. The
 * scan flow owns its permission rationale, its capture guidance and its
 * retry-from-the-same-bytes recovery; a second entrance into the middle of it
 * would be a second copy of all three.
 *
 * ── OWNED BY ANOTHER AGENT ────────────────────────────────────────────────
 * The irrigation, fertilizer and market surfaces for this crop belong to the
 * decision-cards agent and are NOT built here. They attach below the stage
 * section, at the marker further down this file. Nothing in this file should
 * grow into them.
 * ──────────────────────────────────────────────────────────────────────────
 */
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { isApiError } from '@shared/client/errors';
import { formatDate, formatNumber, localizedName } from '@shared/client/format';
import { queryKeys } from '@shared/client/queryKeys';
import type { CropWithStage, RegistryCrop } from '@shared/types/api';

import { cropsApi } from '../../api/endpoints';
import { QueryBoundary } from '../../components/QueryBoundary';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Screen } from '../../components/ui/Screen';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { SkeletonCard } from '../../components/ui/Skeleton';
import { EmptyState, Notice } from '../../components/ui/states';
import { Text } from '../../components/ui/Text';
import { IconCamera, IconTrash } from '../../components/ui/icons';
import { useApiErrorMessage } from '../../hooks/useApiError';
import type { FarmStackParamList, MainTabsParamList } from '../../navigation/types';
import { useLanguage } from '../../store/LanguageContext';
import { colors, radius, spacing } from '../../theme';
import { CropDetailTabs } from './CropDetailTabs';

type Props = NativeStackScreenProps<FarmStackParamList, 'CropDetail'>;

export function CropDetailScreen({ route, navigation }: Props) {
  const { cropId, tab } = route.params;
  const { t } = useTranslation(['crop', 'common', 'agri', 'health', 'errors']);

  /*
   * The scan flow lives in a sibling tab, so the jump is made through the tab
   * navigator rather than this stack's own `navigation` — which knows only
   * about farms.
   */
  const tabs = useNavigation<NavigationProp<MainTabsParamList>>();

  const query = useQuery({
    queryKey: queryKeys.crops.detail(cropId),
    queryFn: () => cropsApi.get(cropId),
  });

  // Ownership failures are 404 by design: a crop belonging to someone else is
  // indistinguishable from one that does not exist, and is shown as such.
  if (isApiError(query.error) && query.error.status === 404) {
    return (
      <Screen>
        <EmptyState
          title={t('errors:notFound')}
          action={
            <Button variant="secondary" onPress={() => navigation.goBack()}>
              {t('common:action.back')}
            </Button>
          }
          testID="crop-not-found"
        />
      </Screen>
    );
  }

  return (
    <Screen onRefresh={() => void query.refetch()} refreshing={query.isRefetching}>
      <QueryBoundary query={query} loading={<SkeletonCard />}>
        {({ crop, registry }) => (
          <View style={styles.page}>
            <CropHeader crop={crop} registry={registry} />

            <Button
              size="lg"
              fullWidth
              onPress={() =>
                tabs.navigate('ScanTab', { screen: 'Camera', params: { cropId: crop.id } })
              }
              leadingIcon={<IconCamera size={20} color={colors.surface} />}
              testID="crop-scan"
            >
              {t('health:scanTitle')}
            </Button>

            <LifecycleActions crop={crop} navigation={navigation} />

            <StageSection crop={crop} registry={registry} />

            {/*
              ── DECISION CARDS ────────────────────────────────────────────
              The irrigation verdict, the photo-check history, the fertilizer
              schedule and the market signal for this crop live in
              `CropDetailTabs`, which owns their fetches and their four sets of
              loading/empty/error states. Only the visible tab fetches.

              `tab` arrives from a feed item that was about one of those four
              answers, so the crop opens on the one that was asked about.
              ──────────────────────────────────────────────────────────────
            */}
            <CropDetailTabs crop={crop} initialTab={tab} />
          </View>
        )}
      </QueryBoundary>
    </Screen>
  );
}

/**
 * The two things that end a crop's life on this screen.
 *
 * Harvesting is offered only from `active`, because that is the only place the
 * server's forward-only ladder (`planned → active → harvested`) allows it from:
 * a PATCH from `planned` is a 400, and a button that can only fail is worse
 * than no button. Both actions free the crop's land — the ledger stops counting
 * a harvested crop's area, and a deleted crop's area with it — so both
 * invalidate the farm detail query the crop form reads its available-acres
 * figure from, or the next crop would be refused ground that is already free.
 *
 * Deleting cascades (irrigation ledger, photo checks and their remote images,
 * recommendations), so the confirmation says so rather than asking "are you
 * sure?" about a consequence the farmer cannot see.
 */
function LifecycleActions({
  crop,
  navigation,
}: {
  crop: CropWithStage;
  navigation: Props['navigation'];
}) {
  const { t } = useTranslation(['crop', 'common']);
  const queryClient = useQueryClient();
  const toMessage = useApiErrorMessage();

  const invalidateLand = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.farms.detail(crop.farmId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.crops.forFarm(crop.farmId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
  };

  const harvest = useMutation({
    mutationFn: () => cropsApi.update(crop.id, { status: 'harvested' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.crops.detail(crop.id) });
      invalidateLand();
    },
    onError: (error) => Alert.alert(t('common:state.error'), toMessage(error)),
  });

  const remove = useMutation({
    mutationFn: () => cropsApi.remove(crop.id),
    onSuccess: () => {
      // The crop's own detail query is deliberately left alone: this screen is
      // still mounted and still observing it, so invalidating would fire one
      // more request for a document that no longer exists.
      invalidateLand();
      navigation.navigate('FarmDetail', { farmId: crop.farmId });
    },
    // A failed delete is a modal answer to a modal question — the farmer is
    // still standing at the confirmation they just gave.
    onError: (error) => Alert.alert(t('common:state.error'), toMessage(error)),
  });

  const confirmDelete = () => {
    Alert.alert(t('crop:deleteConfirmTitle'), t('crop:deleteConfirmBody'), [
      { text: t('common:action.cancel'), style: 'cancel' },
      {
        text: t('common:action.delete'),
        style: 'destructive',
        onPress: () => remove.mutate(),
      },
    ]);
  };

  return (
    <View style={styles.actions}>
      {crop.status === 'active' ? (
        <Button
          variant="secondary"
          onPress={() => harvest.mutate()}
          loading={harvest.isPending}
          style={styles.action}
          testID="crop-harvest"
        >
          {t('crop:markHarvested')}
        </Button>
      ) : null}

      <Button
        variant="ghost"
        onPress={confirmDelete}
        loading={remove.isPending}
        leadingIcon={<IconTrash size={18} color={colors.ink700} />}
        style={styles.action}
        testID="crop-delete"
      >
        {t('common:action.delete')}
      </Button>
    </View>
  );
}

function CropHeader({ crop, registry }: { crop: CropWithStage; registry: RegistryCrop | null }) {
  const { t } = useTranslation(['crop', 'common', 'agri']);
  const { language } = useLanguage();

  const name = localizedName(crop.registry.names, language);
  const title = name?.text ?? crop.freeTextLabel ?? crop.cropCode;

  // The server reads a unit-less area as acres; showing it any other way would
  // disagree with the ledger that counted it.
  const areaUnit = crop.areaUnit ?? 'acre';

  const subtitle = [
    formatDate(crop.sowingDate, language),
    crop.variety,
    crop.areaValue
      ? `${formatNumber(crop.areaValue, language)} ${t(`common:unit.${areaUnit}`)}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const hasDataGaps = Boolean(registry?.dataGaps && registry.dataGaps.length > 0);

  return (
    <View style={styles.header}>
      <Text variant="title" accessibilityRole="header">
        {title}
      </Text>

      {name?.isFallback ? (
        <Text variant="caption" color="ink500">
          {t('agri:nameHindiMissing')}
        </Text>
      ) : null}

      <Text variant="small" color="ink500">
        {subtitle}
      </Text>

      <View style={styles.badges}>
        <Badge>{t(`agri:cropStatus.${crop.status}`)}</Badge>
        {crop.stage.stage ? (
          <Badge tone="brand">{t(`agri:stage.${crop.stage.stage}`)}</Badge>
        ) : null}
        <Badge>{t(`agri:support.${crop.registry.supportLevel}`)}</Badge>
      </View>

      {crop.registry.supportLevel === 'UNSUPPORTED' ? (
        <Notice tone="warning" testID="crop-unsupported">
          <Text variant="small" color="ink700">
            {t('crop:unsupportedNotice')}
          </Text>
        </Notice>
      ) : null}

      {hasDataGaps ? (
        <Notice tone="info" testID="crop-data-gaps">
          <Text variant="small" color="ink700">
            {t('crop:dataGapsNotice')}
          </Text>
        </Notice>
      ) : null}
    </View>
  );
}

function StageSection({ crop, registry }: { crop: CropWithStage; registry: RegistryCrop | null }) {
  const { t } = useTranslation(['crop', 'common', 'agri']);
  const { language } = useLanguage();
  const { stage } = crop;

  const seasons = registry?.seasons ?? [];

  return (
    <View style={styles.section}>
      <SectionHeader title={t('crop:stageHeading')} />

      {stage.hasVerdict && stage.stage ? (
        <Card testID="crop-stage">
          <View style={styles.stageBody}>
            <View style={styles.badges}>
              <Badge tone="brand">{t(`agri:stage.${stage.stage}`)}</Badge>
              {stage.daysSinceSowing != null ? (
                <Text variant="small" color="ink500">
                  {t('crop:daysSinceSowing', { days: stage.daysSinceSowing })}
                </Text>
              ) : null}
            </View>

            {stage.daysSinceSowing != null && stage.totalStageDays != null ? (
              <StageTimeline
                daysSinceSowing={stage.daysSinceSowing}
                totalDays={stage.totalStageDays}
              />
            ) : null}

            {stage.kc != null ? (
              <Text variant="caption" color="ink500">
                {`${t('crop:kcLabel')} ${formatNumber(stage.kc, language, {
                  maximumFractionDigits: 2,
                })}`}
              </Text>
            ) : null}
          </View>
        </Card>
      ) : (
        <EmptyState title={t('crop:noStage')} testID="crop-no-stage" />
      )}

      {seasons.length > 0 ? (
        <>
          <SectionHeader title={t('crop:seasonsLabel')} />
          <View style={styles.badges}>
            {seasons.map((season) => (
              <Badge key={season}>{t(`agri:season.${season}`)}</Badge>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

/** Progress through the published crop calendar. Nothing is inferred here — */
/*  both numbers come from the stage engine's own output (StageResult).      */
function StageTimeline({
  daysSinceSowing,
  totalDays,
}: {
  daysSinceSowing: number;
  totalDays: number;
}) {
  const { t } = useTranslation('crop');
  const fraction = totalDays > 0 ? Math.min(1, Math.max(0, daysSinceSowing / totalDays)) : 0;
  const percent = Math.round(fraction * 100);

  return (
    <View
      style={styles.track}
      accessibilityRole="progressbar"
      accessibilityLabel={t('stageHeading')}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      testID="crop-stage-timeline"
    >
      <View style={[styles.fill, { width: `${percent}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { gap: spacing.lg },
  header: { gap: spacing.sm },
  section: { gap: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  stageBody: { gap: spacing.md },
  track: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.line,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.brand500 },
});
