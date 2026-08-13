/**
 * Step one of the hero flow: which crop is this photograph of?
 *
 * The question cannot be skipped — `cropId` is required by
 * `POST /crop-health/analyze`, and it is what narrows the disease knowledge
 * base from every condition we know to the ones this crop can actually get.
 * But it can be answered *for* the farmer: a smallholder with one crop in the
 * ground should not have to tell us which one, so a single crop arrives
 * pre-selected and the screen becomes one tap to the camera.
 *
 * The list is fed from `/dashboard` rather than from `/farms` + N × `/crops`.
 * One request instead of up to eleven matters on the 2G connection this
 * product is designed for, and `cropCards` already carries the bilingual names
 * this screen needs.
 */
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { queryKeys, STALE_TIME } from '@shared/client/queryKeys';
import { localizedName } from '@shared/client/format';

import { dashboardApi } from '../../api/endpoints';
import { QueryBoundary } from '../../components/QueryBoundary';
import { ChoiceChip } from '../../components/domain/AnalysisResultView';
import { Button } from '../../components/ui/Button';
import { Screen } from '../../components/ui/Screen';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { EmptyState } from '../../components/ui/states';
import { IconCamera, IconLeaf, IconPlus } from '../../components/ui/icons';
import { Text } from '../../components/ui/Text';
import { useLanguage } from '../../store/LanguageContext';
import { colors, spacing } from '../../theme';
import type { MainTabsParamList, ScanStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<ScanStackParamList, 'CropPick'>;

export function CropPickScreen({ navigation }: Props) {
  const { t } = useTranslation(['mobile', 'health', 'common', 'crop']);
  const { language } = useLanguage();

  const [cropId, setCropId] = useState<string | null>(null);

  const dashboardQuery = useQuery({
    queryKey: queryKeys.dashboard(),
    queryFn: dashboardApi.get,
    staleTime: STALE_TIME.dashboard,
  });

  const crops = useMemo(() => dashboardQuery.data?.cropCards ?? [], [dashboardQuery.data]);

  // Pre-select rather than auto-navigate: skipping the screen entirely would
  // also skip the guided-questions route that lives on it, which is the only
  // way forward for a farmer whose camera is refused.
  useEffect(() => {
    const only = crops.length === 1 ? crops[0] : undefined;
    if (only && cropId === null) setCropId(only.cropId);
  }, [cropId, crops]);

  const goToFarms = () => {
    navigation
      .getParent<BottomTabNavigationProp<MainTabsParamList>>()
      ?.navigate('FarmTab', { screen: 'FarmList' });
  };

  return (
    <Screen testID="crop-pick">
      <SectionHeader
        title={t('mobile:scan.pickCropTitle')}
        description={t('mobile:scan.pickCropBody')}
      />

      <QueryBoundary
        query={dashboardQuery}
        isEmpty={() => crops.length === 0}
        loadingLabel={t('common:state.loading')}
        empty={
          <EmptyState
            title={t('mobile:scan.noCropsTitle')}
            body={t('mobile:scan.noCropsBody')}
            testID="scan-no-crops"
            action={
              <Button
                onPress={goToFarms}
                leadingIcon={<IconPlus size={20} color={colors.surface} />}
              >
                {t('mobile:scan.noCropsCta')}
              </Button>
            }
          />
        }
      >
        {() => (
          <View style={styles.body}>
            <Text variant="small" color="ink700">
              {t('health:scanCropLabel')}
            </Text>

            <View style={styles.list}>
              {crops.map((crop) => (
                <ChoiceChip
                  key={crop.cropId}
                  label={localizedName(crop.names, language)?.text ?? crop.cropCode}
                  selected={crop.cropId === cropId}
                  onPress={() => setCropId(crop.cropId)}
                  testID={`crop-option-${crop.cropId}`}
                />
              ))}
            </View>

            <Button
              size="lg"
              fullWidth
              disabled={!cropId}
              leadingIcon={<IconCamera size={22} color={colors.surface} />}
              onPress={() => {
                if (cropId) navigation.navigate('Camera', { cropId });
              }}
              testID="scan-open-camera"
            >
              {t('mobile:scan.startCameraCta')}
            </Button>

            {/*
              The no-photo route. It is not a fallback for a broken camera: a
              farmer standing in a dark shed at dusk has answers even when the
              lens has nothing to work with.
            */}
            <Button
              variant="secondary"
              fullWidth
              disabled={!cropId}
              leadingIcon={<IconLeaf size={20} color={colors.brand600} />}
              onPress={() => {
                if (cropId) navigation.navigate('SymptomChecklist', { cropId });
              }}
              testID="scan-symptom-check"
            >
              {t('health:symptomCheckCta')}
            </Button>
          </View>
        )}
      </QueryBoundary>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg },
  list: { gap: spacing.sm },
});
