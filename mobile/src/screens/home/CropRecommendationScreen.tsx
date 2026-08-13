/**
 * "What should I plant?"
 *
 * Three questions, one request, one ranked answer. The engine is a pure
 * function over the registry and the farm — no external call at request time —
 * so the result is deterministic and its whole derivation is in the trace.
 *
 * What this is **not** is a yield or income forecast. It ranks published
 * suitability, every reason names the registry field it rests on, and crops
 * that were ruled out are listed with their reason rather than silently
 * vanishing.
 *
 * ## The limitations block is part of the answer, not a footnote
 *
 * `POST /crop-recommendation` **always** returns
 * `limitations: [{key: 'cropRec.limitationNoClimateNormals', …}]` today,
 * because the climate-normals table is deliberately empty (OD-7): temperature
 * suitability was not considered and rainfed water suitability could not be
 * assessed at all. So it is rendered *above* the ranking rather than under it.
 * A ranking that quietly ignored two of its documented factors, with the
 * caveat scrolled off the bottom, would be the dishonest version of this
 * screen.
 *
 * `evidenceRatio` says how much of the documented weight each crop's score
 * actually had data behind, and it is on every card for the same reason.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { RouteProp } from '@react-navigation/native';
import { useNavigation, useRoute, type NavigationProp } from '@react-navigation/native';
import { useMutation, useQuery } from '@tanstack/react-query';

import { formatNumber, localizedName } from '@shared/client/format';
import { queryKeys, STALE_TIME } from '@shared/client/queryKeys';
import { SEASONS, type CropRecItem, type CropRecResponse, type Season } from '@shared/types/api';

import { cropRecApi, farmsApi } from '../../api/endpoints';
import { QueryBoundary } from '../../components/QueryBoundary';
import { SourceList } from '../../components/domain/FertilizerGuidanceView';
import { SpeakButton, WhyTrace } from '../../components/domain/WhyTrace';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Screen } from '../../components/ui/Screen';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { Select } from '../../components/ui/Select';
import { SkeletonCard } from '../../components/ui/Skeleton';
import { EmptyState, Notice } from '../../components/ui/states';
import { Text } from '../../components/ui/Text';
import { IconPlus } from '../../components/ui/icons';
import { useApiErrorMessage } from '../../hooks/useApiError';
import { translateMessageKey } from '../../i18n/messageKey';
import type { HomeStackParamList, RootStackParamList } from '../../navigation/types';
import { useLanguage } from '../../store/LanguageContext';
import { colors, spacing } from '../../theme';

type Preference = 'food' | 'cash' | 'any';

const STEPS = ['farm', 'season', 'preference'] as const;
type Step = (typeof STEPS)[number];

export function CropRecommendationScreen() {
  const { t } = useTranslation(['cropRec', 'common', 'farm', 'agri']);
  const { language } = useLanguage();
  const route = useRoute<RouteProp<HomeStackParamList, 'CropRecommendation'>>();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();
  const toMessage = useApiErrorMessage();

  const [stepIndex, setStepIndex] = useState(0);
  const [farmId, setFarmId] = useState<string | undefined>(route.params?.farmId);
  const [season, setSeason] = useState<Season>();
  const [preference, setPreference] = useState<Preference>('any');
  const [result, setResult] = useState<CropRecResponse | null>(null);

  const farmsQuery = useQuery({
    queryKey: queryKeys.farms.list(),
    queryFn: farmsApi.list,
    staleTime: STALE_TIME.slowMoving,
  });

  const run = useMutation({
    mutationFn: () => cropRecApi.run({ farmId: farmId!, season: season!, preference }),
    onSuccess: setResult,
  });

  if (result) {
    return (
      <Screen testID="croprec-result-screen">
        <ResultView
          result={result}
          onRestart={() => {
            setResult(null);
            setStepIndex(0);
            run.reset();
          }}
        />
      </Screen>
    );
  }

  const step: Step = STEPS[stepIndex]!;
  const canAdvance =
    (step === 'farm' && Boolean(farmId)) ||
    (step === 'season' && Boolean(season)) ||
    step === 'preference';

  return (
    <Screen testID="croprec-screen">
      <SectionHeader title={t('cropRec:pageTitle')} description={t('cropRec:notAPrediction')} />
      <Text variant="caption" color="ink500">
        {t('cropRec:stepOf', { current: stepIndex + 1, total: STEPS.length })}
      </Text>

      <QueryBoundary
        query={farmsQuery}
        loading={<SkeletonCard />}
        isEmpty={(data) => data.farms.length === 0}
        empty={
          <EmptyState
            title={t('farm:listEmpty')}
            action={
              <Button
                onPress={() =>
                  navigation.navigate('Main', {
                    screen: 'FarmTab',
                    params: { screen: 'FarmForm', params: {} },
                  })
                }
                leadingIcon={<IconPlus size={18} color={colors.surface} />}
              >
                {t('farm:listEmptyCta')}
              </Button>
            }
          />
        }
      >
        {(data) => (
          <View style={styles.stack} testID="croprec-wizard">
            {run.isError ? (
              <Notice tone="danger">
                <Text variant="small" color="ink700">
                  {toMessage(run.error)}
                </Text>
              </Notice>
            ) : null}

            {step === 'farm' ? (
              <Select
                label={t('cropRec:farmStep')}
                placeholder={t('common:nav.farms')}
                value={farmId}
                onChange={setFarmId}
                options={data.farms.map((farm) => ({
                  value: farm.id,
                  label: farm.name,
                  description: `${farm.location.district}, ${farm.location.state} · ${formatNumber(farm.sizeValue, language)} ${t(`common:unit.${farm.sizeUnit}`)}`,
                }))}
                testID="croprec-farm"
              />
            ) : null}

            {step === 'season' ? (
              <Select
                label={t('cropRec:seasonStep')}
                placeholder={t('cropRec:seasonStep')}
                value={season}
                onChange={setSeason}
                options={SEASONS.map((value) => ({ value, label: t(`agri:season.${value}`) }))}
                testID="croprec-season"
              />
            ) : null}

            {step === 'preference' ? (
              <Select
                label={t('cropRec:preferenceStep')}
                placeholder={t('cropRec:preferenceAny')}
                value={preference}
                onChange={setPreference}
                options={[
                  { value: 'any', label: t('cropRec:preferenceAny') },
                  { value: 'food', label: t('cropRec:preferenceFood') },
                  { value: 'cash', label: t('cropRec:preferenceCash') },
                ]}
                testID="croprec-preference"
              />
            ) : null}

            <View style={styles.wizardActions}>
              <Button
                variant="secondary"
                disabled={stepIndex === 0}
                onPress={() => setStepIndex((current) => Math.max(0, current - 1))}
                style={styles.wizardButton}
                testID="croprec-back"
              >
                {t('common:action.back')}
              </Button>

              {stepIndex < STEPS.length - 1 ? (
                <Button
                  disabled={!canAdvance}
                  onPress={() => setStepIndex((current) => current + 1)}
                  style={styles.wizardButton}
                  testID="croprec-next"
                >
                  {t('common:action.next')}
                </Button>
              ) : (
                <Button
                  disabled={!farmId || !season}
                  loading={run.isPending}
                  onPress={() => run.mutate()}
                  style={styles.wizardButton}
                  testID="croprec-run"
                >
                  {t('cropRec:runCta')}
                </Button>
              )}
            </View>
          </View>
        )}
      </QueryBoundary>
    </Screen>
  );
}

function ResultView({ result, onRestart }: { result: CropRecResponse; onRestart: () => void }) {
  const { t } = useTranslation(['cropRec', 'common']);
  const { language } = useLanguage();

  return (
    <View style={styles.stack} testID="croprec-result">
      <SectionHeader title={t('cropRec:resultHeading')} description={t('cropRec:notAPrediction')} />

      {/*
        Above the ranking, not below it. This block is present on every response
        the platform can currently produce, and it names two factors the score
        could not use.
      */}
      {result.limitations.length > 0 ? (
        <Notice tone="warning" testID="croprec-limitations">
          <View style={styles.limitations}>
            <Text variant="bodyStrong" color="ink700">
              {t('cropRec:limitationsHeading')}
            </Text>
            {result.limitations.map((limitation, index) => (
              <Text key={`${limitation.key}-${index}`} variant="small" color="ink700">
                {translateMessageKey(t, limitation.key, limitation.data)}
              </Text>
            ))}
          </View>
        </Notice>
      ) : null}

      {result.recommendations.length === 0 ? (
        <EmptyState title={t('cropRec:resultEmpty')} />
      ) : (
        <View style={styles.list}>
          {result.recommendations.map((item, index) => (
            <RecommendationCard key={item.cropCode} item={item} rank={index + 1} />
          ))}
        </View>
      )}

      {/* Excluded crops carry their reason: never a silent disappearance. */}
      {result.excluded.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader title={t('cropRec:excludedHeading')} />
          {result.excluded.map((entry) => (
            <Card key={entry.cropCode}>
              <View style={styles.excluded}>
                <Text variant="bodyStrong">
                  {localizedName(entry.names, language)?.text ?? entry.cropCode}
                </Text>
                <Text variant="small" color="ink500">
                  {translateMessageKey(t, entry.reasonKey, entry.data)}
                </Text>
              </View>
            </Card>
          ))}
        </View>
      ) : null}

      <WhyTrace trace={result.trace} />

      <Button variant="secondary" fullWidth onPress={onRestart} testID="croprec-restart">
        {t('cropRec:startOver')}
      </Button>
    </View>
  );
}

function RecommendationCard({ item, rank }: { item: CropRecItem; rank: number }) {
  const { t } = useTranslation(['cropRec', 'common', 'agri']);
  const { language } = useLanguage();

  const name = localizedName(item.names, language)?.text ?? item.cropCode;
  const spoken = [
    name,
    ...item.reasons.map((reason) => translateMessageKey(t, reason.key, reason.data)),
  ].join('. ');

  return (
    <Card testID="croprec-item">
      <View style={styles.stack}>
        <View style={styles.cardHead}>
          <View style={styles.cardTitle}>
            <Text variant="caption" color="ink500">
              {formatNumber(rank, language)}
            </Text>
            <Text variant="heading" style={styles.flexText}>
              {name}
            </Text>
          </View>
          <SpeakButton text={spoken} />
        </View>

        <View style={styles.chips}>
          <Badge tone="brand">
            {`${t('cropRec:scoreLabel')}: ${formatNumber(item.score * 100, language, { maximumFractionDigits: 0 })}`}
          </Badge>
          <Badge>
            {t('cropRec:evidenceLabel', {
              pct: formatNumber(item.evidenceRatio * 100, language, { maximumFractionDigits: 0 }),
            })}
          </Badge>
          <Badge>{t(`agri:support.${item.supportLevel}`)}</Badge>
        </View>

        {item.reasons.length > 0 ? (
          <View style={styles.section}>
            <Text variant="bodyStrong" accessibilityRole="header">
              {t('cropRec:reasonsHeading')}
            </Text>
            {item.reasons.map((reason) => (
              <Text key={reason.key} variant="small" color="ink700">
                {translateMessageKey(t, reason.key, reason.data)}
              </Text>
            ))}
          </View>
        ) : null}

        {item.cautions.length > 0 ? (
          <View style={styles.section}>
            <Text variant="bodyStrong" accessibilityRole="header">
              {t('cropRec:cautionsHeading')}
            </Text>
            {item.cautions.map((caution, index) => (
              <Text key={`${caution.key}-${index}`} variant="small" color="ink700">
                {translateMessageKey(t, caution.key, caution.data)}
              </Text>
            ))}
          </View>
        ) : null}

        {item.sources.length > 0 ? (
          <View style={styles.section}>
            <Text variant="bodyStrong" accessibilityRole="header">
              {t('cropRec:sourcesHeading')}
            </Text>
            <SourceList sources={item.sources} />
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  section: { gap: spacing.xs },
  list: { gap: spacing.md },
  limitations: { gap: spacing.xs },
  wizardActions: { flexDirection: 'row', gap: spacing.md },
  wizardButton: { flex: 1 },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardTitle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flexText: { flexShrink: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  excluded: { gap: spacing.xs },
});
