/**
 * One field: where it is, what is on it, and the way through to its weather.
 *
 * The weather block is an entry point rather than a forecast. `WeatherScreen`
 * in this same stack owns that content, and duplicating a strip of it here
 * would be two places to keep honest about the same cached snapshot.
 *
 * Deleting cascades — crops, photos, irrigation records and advice all go with
 * the field — so the confirmation says so in `farm:deleteConfirmBody` rather
 * than asking "are you sure?" about a consequence the farmer cannot see.
 */
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { isApiError } from '@shared/client/errors';
import { formatDate, formatNumber, localizedName } from '@shared/client/format';
import { queryKeys } from '@shared/client/queryKeys';
import { MAX_ACTIVE_CROPS_PER_FARM, type CropWithStage } from '@shared/types/api';

import { farmsApi } from '../../api/endpoints';
import { QueryBoundary } from '../../components/QueryBoundary';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Screen } from '../../components/ui/Screen';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { SkeletonCard } from '../../components/ui/Skeleton';
import { EmptyState, Notice } from '../../components/ui/states';
import { Text } from '../../components/ui/Text';
import {
  IconChevronRight,
  IconCloud,
  IconLocation,
  IconPlus,
  IconTrash,
} from '../../components/ui/icons';
import { useApiErrorMessage } from '../../hooks/useApiError';
import type { FarmStackParamList } from '../../navigation/types';
import { useLanguage } from '../../store/LanguageContext';
import { colors, spacing } from '../../theme';

type Props = NativeStackScreenProps<FarmStackParamList, 'FarmDetail'>;

export function FarmDetailScreen({ route, navigation }: Props) {
  const { farmId } = route.params;
  const { t } = useTranslation(['farm', 'crop', 'common', 'agri', 'errors']);
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const toMessage = useApiErrorMessage();

  const query = useQuery({
    queryKey: queryKeys.farms.detail(farmId),
    queryFn: () => farmsApi.get(farmId),
  });

  const remove = useMutation({
    mutationFn: () => farmsApi.remove(farmId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.farms.all() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() });
      navigation.navigate('FarmList');
    },
    onError: (error) => {
      // A failed delete is a modal answer to a modal question — the farmer is
      // still standing at the confirmation they just gave.
      Alert.alert(t('common:state.error'), toMessage(error));
    },
  });

  const confirmDelete = () => {
    Alert.alert(t('farm:deleteConfirmTitle'), t('farm:deleteConfirmBody'), [
      { text: t('common:action.cancel'), style: 'cancel' },
      {
        text: t('farm:deleteCta'),
        style: 'destructive',
        onPress: () => remove.mutate(),
      },
    ]);
  };

  // Ownership failures are 404 by design: a farm belonging to someone else is
  // indistinguishable from one that does not exist, and is shown as such.
  if (isApiError(query.error) && query.error.status === 404) {
    return (
      <Screen>
        <EmptyState
          title={t('errors:notFound')}
          action={
            <Button variant="secondary" onPress={() => navigation.navigate('FarmList')}>
              {t('common:action.back')}
            </Button>
          }
          testID="farm-not-found"
        />
      </Screen>
    );
  }

  return (
    <Screen onRefresh={() => void query.refetch()} refreshing={query.isRefetching}>
      <QueryBoundary query={query} loading={<SkeletonCard />}>
        {({ farm, crops }) => {
          const activeCrops = crops.filter((crop) => crop.status === 'active').length;
          const atCropLimit = activeCrops >= MAX_ACTIVE_CROPS_PER_FARM;

          return (
            <View style={styles.page}>
              <View style={styles.header}>
                <Text variant="title" accessibilityRole="header">
                  {farm.name}
                </Text>

                <View style={styles.location}>
                  <IconLocation size={15} color={colors.ink500} />
                  <Text variant="small" color="ink500" style={styles.flexText}>
                    {[farm.location.district, farm.location.state].filter(Boolean).join(', ')}
                  </Text>
                </View>

                <Text variant="caption" color="ink500">
                  {farm.location.source === 'gps'
                    ? t('farm:locationSourceGps')
                    : t('farm:locationSourceManual')}
                </Text>

                <View style={styles.badges}>
                  <Badge>
                    {`${formatNumber(farm.sizeValue, language)} ${t(`common:unit.${farm.sizeUnit}`)}`}
                  </Badge>
                  <Badge>{t(`agri:soil.${farm.soilType}`)}</Badge>
                  <Badge>{t(`agri:irrigationMethod.${farm.irrigationMethod}`)}</Badge>
                </View>

                <View style={styles.actions}>
                  <Button
                    variant="secondary"
                    onPress={() => navigation.navigate('FarmForm', { farmId: farm.id })}
                    style={styles.action}
                    testID="farm-edit"
                  >
                    {t('common:action.edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    onPress={confirmDelete}
                    loading={remove.isPending}
                    leadingIcon={<IconTrash size={18} color={colors.ink700} />}
                    style={styles.action}
                    testID="farm-delete"
                  >
                    {t('common:action.delete')}
                  </Button>
                </View>
              </View>

              <SectionHeader title={t('farm:weatherHeading')} />
              <Card
                onPress={() => navigation.navigate('Weather', { farmId: farm.id })}
                accessibilityLabel={t('farm:weatherHeading')}
                testID="farm-weather-entry"
              >
                <View style={styles.entryRow}>
                  <IconCloud size={22} color={colors.brand600} />
                  <Text variant="bodyStrong" style={styles.flexText}>
                    {t('common:action.viewAll')}
                  </Text>
                  <IconChevronRight size={20} color={colors.ink500} />
                </View>
              </Card>

              <SectionHeader
                title={t('farm:cropsHeading')}
                action={
                  atCropLimit ? undefined : (
                    <Button
                      onPress={() => navigation.navigate('CropForm', { farmId: farm.id })}
                      leadingIcon={<IconPlus size={18} color={colors.surface} />}
                      testID="crop-add"
                    >
                      {t('farm:addCropCta')}
                    </Button>
                  )
                }
              />

              {atCropLimit ? (
                <Notice tone="info" testID="crop-limit">
                  <Text variant="small" color="ink700">
                    {t('crop:limitHint', { max: MAX_ACTIVE_CROPS_PER_FARM })}
                  </Text>
                </Notice>
              ) : null}

              {crops.length === 0 ? (
                <EmptyState
                  title={t('farm:cropsEmpty')}
                  action={
                    <Button
                      onPress={() => navigation.navigate('CropForm', { farmId: farm.id })}
                      leadingIcon={<IconPlus size={18} color={colors.surface} />}
                    >
                      {t('farm:addCropCta')}
                    </Button>
                  }
                  testID="farm-crops-empty"
                />
              ) : (
                <View style={styles.list} testID="farm-crops">
                  {crops.map((crop) => (
                    <CropRow
                      key={crop.id}
                      crop={crop}
                      onPress={() => navigation.navigate('CropDetail', { cropId: crop.id })}
                    />
                  ))}
                </View>
              )}
            </View>
          );
        }}
      </QueryBoundary>
    </Screen>
  );
}

function CropRow({ crop, onPress }: { crop: CropWithStage; onPress: () => void }) {
  const { t } = useTranslation(['crop', 'common', 'agri']);
  const { language } = useLanguage();

  const name = localizedName(crop.registry.names, language);
  const title = name?.text ?? crop.freeTextLabel ?? crop.cropCode;

  return (
    <Card onPress={onPress} accessibilityLabel={title} testID="farm-crop-item">
      <View style={styles.entryRow}>
        <View style={styles.cropBody}>
          <Text variant="subheading" numberOfLines={1}>
            {title}
          </Text>

          {name?.isFallback ? (
            <Text variant="caption" color="ink500">
              {t('agri:nameHindiMissing')}
            </Text>
          ) : null}

          <Text variant="small" color="ink500">
            {formatDate(crop.sowingDate, language)}
          </Text>

          <View style={styles.badges}>
            <Badge>{t(`agri:cropStatus.${crop.status}`)}</Badge>
            {crop.stage.stage ? (
              <Badge tone="brand">{t(`agri:stage.${crop.stage.stage}`)}</Badge>
            ) : null}
          </View>
        </View>

        <IconChevronRight size={20} color={colors.ink500} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  page: { gap: spacing.lg },
  header: { gap: spacing.sm },
  location: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  flexText: { flex: 1 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.xs },
  action: { flex: 1 },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cropBody: { flex: 1, gap: spacing.sm },
  list: { gap: spacing.md },
});
